/**
 * Offscreen Document — Audio Capture & Transcription.
 *
 * This script runs inside the offscreen document (offscreen.html).
 * It is the only place where WebRTC / getUserMedia / MediaRecorder / AudioContext
 * can be used, because MV3 service workers have no DOM access.
 *
 * Pipeline per chunk:
 *   MediaRecorder blob → Groq Whisper (transcription) → SentenceBuffer
 *   → TRANSCRIPTION_SEGMENT messages to background service worker.
 *
 * Translation is handled by the background service worker (TranslationQueue).
 *
 * Audio chunking uses VAD (Voice Activity Detection) via AnalyserNode:
 *   - Polls RMS volume every VAD_POLL_INTERVAL_MS.
 *   - On silence ≥ SILENCE_DURATION_MS and chunk ≥ MIN_CHUNK_MS → flush.
 *   - On chunk ≥ MAX_CHUNK_MS → force flush (safety cap for long monologues).
 */

import { transcribeAudioChunk } from './api/groq';
import {
  DEFAULT_WHISPER_MODEL,
  MAX_CHUNK_MS,
  MIN_CHUNK_MS,
  SILENCE_DURATION_MS,
  SILENCE_VOLUME_THRESHOLD,
  VAD_POLL_INTERVAL_MS
} from './constants';
import type { StoredSettings } from './types/settings';
import type {
  BackgroundRequestMessage,
  OffscreenRequestMessage
} from './types/messages';
import { SentenceBuffer } from './utils/sentenceBuffer';
import { debugLog, debugWarn, debugError } from './utils/debug';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Extended audio constraints required by Chrome's tab capture.
 * The `mandatory` block is Chrome-specific and not part of the W3C spec.
 */
type ChromeTabCaptureAudioConstraints = MediaTrackConstraints & {
  mandatory: {
    chromeMediaSource: 'tab';
    chromeMediaSourceId: string;
  };
};

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let mediaRecorder: MediaRecorder | null = null;
let activeStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let analyserNode: AnalyserNode | null = null;
let vadIntervalId: ReturnType<typeof setInterval> | null = null;
let isRecording = false;

/** Settings received from the service worker at recording start. */
let cachedSettings: StoredSettings | null = null;

/**
 * Monotonically increasing session counter.
 * Each new recording gets a unique sessionId; stale callbacks check this
 * to discard results that belong to an already-stopped session.
 */
let recordingSessionId = 0;

/** Sequential promise chain that serialises chunk processing (prevents parallel API calls). */
let processingQueue = Promise.resolve();

/** Timestamp (ms) when the current chunk started accumulating. */
let chunkStartTime = 0;

/** Timestamp (ms) when continuous silence began (0 = not silent). */
let silenceStartTime = 0;

/** Whether the audio level is currently below the silence threshold. */
let isSilent = false;

/** Sentence buffer that accumulates Whisper fragments into complete sentences. */
const sentenceBuffer = new SentenceBuffer();

/** Rolling buffer of recent transcriptions passed as Whisper prompt for continuity. */
const whisperPromptBuffer: string[] = [];

// ---------------------------------------------------------------------------
// Message listener (from background service worker)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    const request = message as OffscreenRequestMessage;

    // Ignore messages not targeted at us.
    if (request.target !== 'offscreen') {
      return;
    }

    debugLog('Offscreen', `Received message: ${request.type}`);

    if (request.type === 'START_RECORDING') {
      cachedSettings = request.settings;
      debugLog(
        'Offscreen',
        `Settings received: groq=${cachedSettings.groqApiKey ? 'set' : 'missing'}, whisper=${cachedSettings.whisperModel || 'default'}`
      );
      void startRecording(request.streamId)
        .then(() => sendResponse({ status: 'recording started' }))
        .catch((error) => {
          sendResponse({
            status: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'Failed to start recording'
          });
        });
      return true; // keep message channel open for async response
    }

    if (request.type === 'STOP_RECORDING') {
      void stopRecording().then(() =>
        sendResponse({ status: 'recording stopped' })
      );
      return true;
    }
  }
);

// ---------------------------------------------------------------------------
// Recording lifecycle
// ---------------------------------------------------------------------------

/**
 * Starts audio capture from the given tab stream.
 * Sets up MediaRecorder (continuous mode), AudioContext with AnalyserNode for
 * VAD, and a polling interval that triggers chunk flushes on silence or max duration.
 */
async function startRecording(streamId: string) {
  // If already recording (e.g. rapid toggle), stop first.
  if (isRecording) {
    debugWarn(
      'Offscreen',
      'Already recording, stopping previous session first'
    );
    await stopRecording();
  }

  const sessionId = ++recordingSessionId;
  debugLog('Offscreen', `Starting recording session #${sessionId}`);

  try {
    // Obtain the tab audio stream using the streamId from background.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      } as ChromeTabCaptureAudioConstraints
    });

    activeStream = stream;
    isRecording = true;

    // Create AudioContext and connect source to destination (playback)
    // so the user can still hear the tab audio after capture.
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(audioContext.destination);

    // Set up AnalyserNode for RMS-based voice activity detection.
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 2048;
    source.connect(analyserNode);

    // MediaRecorder uses stop/start cycles so each chunk is a complete
    // valid WebM file with proper headers (required by Groq Whisper API).
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus'
    });
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size <= 0 || !isCurrentSession(sessionId)) {
        return;
      }

      debugLog(
        'Offscreen',
        `Chunk received: ${(event.data.size / 1024).toFixed(1)} KB`
      );

      // Enqueue chunk processing to prevent parallel API calls.
      processingQueue = processingQueue
        .then(() => processAudioChunk(event.data, sessionId))
        .catch((error) => {
          debugError(
            'Offscreen',
            'Failed to process queued audio chunk:',
            error
          );
        });
    };

    // When a stop/start flush cycle completes, restart recording immediately.
    mediaRecorder.onstop = () => {
      if (isRecording && isCurrentSession(sessionId) && mediaRecorder) {
        mediaRecorder.start();
        chunkStartTime = Date.now();
        isSilent = false;
        silenceStartTime = 0;
        debugLog('Offscreen', 'MediaRecorder restarted after flush');
      }
    };

    // Start the first recording segment.
    mediaRecorder.start();
    chunkStartTime = Date.now();
    silenceStartTime = 0;
    isSilent = false;

    // Start VAD polling loop.
    vadIntervalId = setInterval(() => {
      if (!isCurrentSession(sessionId)) {
        return;
      }
      pollVAD();
    }, VAD_POLL_INTERVAL_MS);

    debugLog('Offscreen', 'Recording started (VAD mode)');
  } catch (error) {
    isRecording = false;
    await cleanupMediaResources();
    debugError('Offscreen', 'Failed to start recording:', error);
    await notifyPipelineError(
      error instanceof Error ? error.message : 'Failed to start recording'
    );
    throw error;
  }
}

/** Stops recording, clears VAD interval, cleans up all media resources. */
async function stopRecording() {
  debugLog('Offscreen', 'Stopping recording…');

  isRecording = false;
  recordingSessionId += 1; // invalidate all pending callbacks

  // Stop VAD polling.
  if (vadIntervalId !== null) {
    clearInterval(vadIntervalId);
    vadIntervalId = null;
  }

  // Stop the MediaRecorder (triggers final ondataavailable if active).
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  // Drain any remaining text in the sentence buffer before cleanup.
  const remaining = sentenceBuffer.drain();
  for (const sentence of remaining) {
    await sendSegment(sentence);
  }

  await cleanupMediaResources();
  sentenceBuffer.reset();
  whisperPromptBuffer.length = 0;

  debugLog('Offscreen', 'Recording stopped');
}

// ---------------------------------------------------------------------------
// VAD (Voice Activity Detection)
// ---------------------------------------------------------------------------

/**
 * Called every VAD_POLL_INTERVAL_MS.
 * Computes RMS of the current audio buffer and decides whether to flush a chunk.
 */
function pollVAD() {
  if (!analyserNode || !mediaRecorder || mediaRecorder.state !== 'recording') {
    return;
  }

  // Read time-domain audio samples from the AnalyserNode.
  const bufferLength = analyserNode.fftSize;
  const dataArray = new Float32Array(bufferLength);
  analyserNode.getFloatTimeDomainData(dataArray);

  // Compute RMS (Root Mean Square) — a measure of audio "loudness".
  let sumSquares = 0;
  for (let i = 0; i < bufferLength; i++) {
    sumSquares += dataArray[i] * dataArray[i];
  }
  const rms = Math.sqrt(sumSquares / bufferLength);

  const now = Date.now();
  const chunkDuration = now - chunkStartTime;

  // Check if current audio level is below the silence threshold.
  if (rms < SILENCE_VOLUME_THRESHOLD) {
    if (!isSilent) {
      isSilent = true;
      silenceStartTime = now;
      debugLog(
        'VAD',
        `Silence detected (RMS=${rms.toFixed(4)}), chunk duration=${chunkDuration}ms`
      );
    }

    const silenceDuration = now - silenceStartTime;

    // Flush if silence is long enough AND chunk meets minimum length.
    if (
      silenceDuration >= SILENCE_DURATION_MS &&
      chunkDuration >= MIN_CHUNK_MS
    ) {
      debugLog(
        'VAD',
        `Flushing chunk on silence (silence=${silenceDuration}ms, chunk=${chunkDuration}ms)`
      );
      requestChunkFlush();
      return;
    }
  } else {
    isSilent = false;
    silenceStartTime = 0;
  }

  // Safety cap: flush if chunk exceeded maximum duration (long monologue).
  if (chunkDuration >= MAX_CHUNK_MS) {
    debugLog(
      'VAD',
      `Flushing chunk on max duration (chunk=${chunkDuration}ms)`
    );
    requestChunkFlush();
  }
}

/**
 * Flushes the current audio chunk by stopping the MediaRecorder.
 * This produces a complete, valid WebM file with proper headers.
 * The onstop handler automatically restarts recording.
 */
function requestChunkFlush() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    debugLog('Offscreen', 'Flushing chunk (stop/start cycle)');
    mediaRecorder.stop();
    // Restart happens in the onstop handler.
  }
}

// ---------------------------------------------------------------------------
// Resource cleanup
// ---------------------------------------------------------------------------

/** Releases all media resources: stream tracks, AudioContext, references. */
async function cleanupMediaResources() {
  debugLog('Offscreen', 'Cleaning up media resources…');

  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
  }
  activeStream = null;
  mediaRecorder = null;
  analyserNode = null;

  if (audioContext) {
    await audioContext.close().catch(() => undefined);
  }
  audioContext = null;

  debugLog('Offscreen', 'Media resources cleaned up');
}

// ---------------------------------------------------------------------------
// Session guard
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the given sessionId matches the current active session.
 * Used by async callbacks to discard stale results after a stop/restart.
 */
function isCurrentSession(sessionId: number) {
  return isRecording && sessionId === recordingSessionId;
}

// ---------------------------------------------------------------------------
// Audio chunk processing pipeline
// ---------------------------------------------------------------------------

/**
 * Processes a single audio chunk:
 *   1. Transcribe via Groq Whisper (with language hint + prompt continuity)
 *   2. Feed into SentenceBuffer
 *   3. Send complete sentences as TRANSCRIPTION_SEGMENT to background
 */
async function processAudioChunk(blob: Blob, sessionId: number) {
  if (!isCurrentSession(sessionId)) {
    debugWarn('Offscreen', `Skipping stale chunk (session #${sessionId})`);
    return;
  }

  debugLog(
    'Offscreen',
    `Processing chunk (${(blob.size / 1024).toFixed(1)} KB)…`
  );

  try {
    if (!cachedSettings?.groqApiKey) {
      await notifyPipelineError('Groq API key not available');
      return;
    }

    // 1. Transcribe audio → text with language hint and prompt continuity.
    const whisperModel = cachedSettings.whisperModel || DEFAULT_WHISPER_MODEL;
    const whisperPrompt =
      whisperPromptBuffer.length > 0
        ? whisperPromptBuffer.slice(-3).join(' ')
        : undefined;

    const transcription = await transcribeAudioChunk(
      blob,
      cachedSettings.groqApiKey,
      whisperModel,
      'en',
      whisperPrompt
    );
    if (!transcription || !isCurrentSession(sessionId)) {
      return;
    }

    // Update Whisper prompt buffer for continuity.
    whisperPromptBuffer.push(transcription);
    if (whisperPromptBuffer.length > 5) {
      whisperPromptBuffer.shift();
    }

    // 2. Feed into sentence buffer → emit complete sentences.
    const sentences = sentenceBuffer.flush(transcription);

    // 3. Send each sentence as a segment to background.
    for (const sentence of sentences) {
      if (!isCurrentSession(sessionId)) break;
      await sendSegment(sentence);
    }
  } catch (error) {
    debugError('Offscreen', 'Pipeline error during chunk processing:', error);
    await notifyPipelineError(
      error instanceof Error
        ? error.message
        : 'Unknown error in transcription pipeline'
    );
  }
}

// ---------------------------------------------------------------------------
// Messaging helpers
// ---------------------------------------------------------------------------

/** Sends a transcription segment to the background for display and translation. */
async function sendSegment(text: string): Promise<void> {
  debugLog('Offscreen', `Sending segment: "${text.substring(0, 60)}…"`);
  const msg: BackgroundRequestMessage = {
    target: 'background',
    type: 'TRANSCRIPTION_SEGMENT',
    text
  };
  await chrome.runtime.sendMessage(msg).catch(() => undefined);
}

/** Sends a pipeline error to the background worker for user-visible feedback. */
async function notifyPipelineError(message: string) {
  debugError('Offscreen', `Pipeline error: ${message}`);
  const backgroundMessage: BackgroundRequestMessage = {
    target: 'background',
    type: 'PIPELINE_ERROR',
    message
  };
  await chrome.runtime.sendMessage(backgroundMessage).catch(() => undefined);
}
