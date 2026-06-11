/**
 * Offscreen Document — Handles Audio Capture, Voice Activity Detection (VAD), and Transcription.
 *
 * In Manifest V3, we use an offscreen document because service workers cannot access
 * the DOM-based getUserMedia API or run the ONNX-based VAD worklets.
 *
 * Pipeline per chunk:
 *   MicVAD (VAD) → Encode to WAV → Groq Whisper (ASR) → SentenceBuffer (splitting)
 *   → Send TRANSCRIPTION_SEGMENT messages to background service worker.
 */

import { transcribeAudioChunk } from './api/groq';
import { DEFAULT_WHISPER_MODEL } from './constants';
import type { StoredSettings } from './types/settings';
import type {
  BackgroundRequestMessage,
  OffscreenRequestMessage
} from './types/messages';
import { SentenceBuffer } from './utils/sentenceBuffer';
import {
  extractSpeakerEmbedding,
  disposeSpeakerEmbedder,
  preloadSpeakerEmbedder
} from './utils/speakerEmbedder';
import { SpeakerClustering } from './utils/speakerClustering';
import { debugLog, debugWarn, debugError } from './utils/debug';
import { MicVAD, utils } from '@ricky0123/vad-web';

// ---------------------------------------------------------------------------
// Types and Constraints
// ---------------------------------------------------------------------------

/** Custom constraints for chrome.tabCapture stream detection. */
type ChromeTabCaptureAudioConstraints = MediaTrackConstraints & {
  mandatory: {
    chromeMediaSource: 'tab';
    chromeMediaSourceId: string;
  };
};

// ---------------------------------------------------------------------------
// Module-level State
// ---------------------------------------------------------------------------

let activeStream: MediaStream | null = null;
let audioPassthrough: AudioContext | null = null;
let myvad: MicVAD | null = null;
let isRecording = false;

let cachedSettings: StoredSettings | null = null;
let recordingSessionId = 0; // Guard to prevent late callbacks from impacting new sessions
let processingQueue = Promise.resolve(); // Ensures sequential processing of audio chunks

const sentenceBuffer = new SentenceBuffer();
const whisperPromptBuffer: string[] = []; // Context buffer for Whisper to maintain coherence

const speakerClustering = new SpeakerClustering();
/** Speaker tag owning the text currently held in the sentence buffer. */
let bufferSpeakerId: number | undefined;

/** Whether diarization is enabled for the cached settings. */
function isSpeakerDetectionEnabled(): boolean {
  if (!cachedSettings) {
    return true; // Default to enabled if settings not loaded yet
  }
  return cachedSettings.speakerDetection !== false;
}

// ---------------------------------------------------------------------------
// Message listener: Handles control signals from Background.
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    const request = message as OffscreenRequestMessage;

    if (request.target !== 'offscreen') {
      return;
    }

    debugLog('Offscreen', `Received message: ${request.type}`);

    if (request.type === 'START_RECORDING') {
      cachedSettings = request.settings;
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
      return true; // Keep channel open for async response
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
// Recording Lifecycle: Management of Tab Capture, Passthrough, and VAD.
// ---------------------------------------------------------------------------

/**
 * Initializes the audio capture stream and sets up the VAD pipeline.
 */
async function startRecording(streamId: string) {
  if (isRecording) {
    debugWarn(
      'Offscreen',
      'Already recording, stopping previous session first'
    );
    await stopRecording();
  }

  const sessionId = ++recordingSessionId;
  debugLog('Offscreen', `Starting recording session #${sessionId}`);

  speakerClustering.reset();
  bufferSpeakerId = undefined;
  if (isSpeakerDetectionEnabled()) {
    preloadSpeakerEmbedder();
  }

  try {
    // 1. Capture the tab's audio stream via streamId from background
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

    // 2. Route captured audio back to speakers (Passthrough) so the user can hear the original audio.
    audioPassthrough = new AudioContext();
    const source = audioPassthrough.createMediaStreamSource(stream);
    source.connect(audioPassthrough.destination);
    debugLog('Offscreen', 'Audio passthrough connected to speakers');

    // 3. Configure the Voice Activity Detection (VAD) options.
    // Optimized for dialogue: 300ms silence detection and high sensitivity.
    const vadOptions = {
      getStream: async () => activeStream!,
      pauseStream: async () => {
        /* stream lifecycle managed by stopRecording */
      },
      model: 'v5' as const,
      baseAssetPath: chrome.runtime.getURL(''),
      onnxWASMBasePath: chrome.runtime.getURL(''),
      workletURL: chrome.runtime.getURL('vad.worklet.bundle.min.js'),
      positiveSpeechThreshold: 0.8,
      negativeSpeechThreshold: 0.45,
      minSpeechMs: 150,
      preSpeechPadMs: 100,
      redemptionMs: 300, // Wait for 300ms of silence before concluding a segment
      submitUserSpeechOnPause: true,
      onVADMisfire: () => {
        debugLog('VAD', 'VAD misfire detected');
      },
      onSpeechStart: () => {
        debugLog('VAD', 'Speech started');
        if (isCurrentSession(sessionId)) {
          chrome.runtime
            .sendMessage({ target: 'background', type: 'VAD_SPEECH_START' })
            .catch(() => undefined);
        }
      },
      onSpeechEnd: (audio: Float32Array) => {
        debugLog('VAD', 'Speech ended');
        if (!isCurrentSession(sessionId)) return;

        chrome.runtime
          .sendMessage({ target: 'background', type: 'VAD_SPEECH_END' })
          .catch(() => undefined);

        // Convert the raw VAD audio buffer (Float32Array) to a WAV blob for the Groq API.
        try {
          const wavBuffer = utils.encodeWAV(audio);
          const blob = new Blob([wavBuffer], { type: 'audio/wav' });

          // Queue the chunk for sequential transcription processing.
          processingQueue = processingQueue
            .then(() => processAudioChunk(blob, audio, sessionId))
            .catch((error) => {
              debugError(
                'Offscreen',
                'Failed to process queued audio chunk:',
                error
              );
            });
        } catch (e) {
          debugError('Offscreen', 'WAV conversion failed', e);
        }
      }
    };

    // 4. Create and start the VAD instance.
    myvad = await MicVAD.new(vadOptions);
    myvad.start();
    debugLog('Offscreen', 'Recording started (ML VAD mode)');
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

/**
 * Stops the recording sessions and cleans up all active resources.
 */
async function stopRecording() {
  debugLog('Offscreen', 'Stopping recording…');

  isRecording = false;
  recordingSessionId += 1;

  if (myvad) {
    myvad.destroy();
    myvad = null;
  }

  // Final flush of any partially recorded sentences.
  const remaining = sentenceBuffer.drain();
  for (const sentence of remaining) {
    await sendSegment(sentence, bufferSpeakerId);
  }

  await cleanupMediaResources();
  sentenceBuffer.reset();
  whisperPromptBuffer.length = 0;
  speakerClustering.reset();
  bufferSpeakerId = undefined;
  await disposeSpeakerEmbedder();

  // Clear VAD status in the UI if we stopped while speaking.
  chrome.runtime
    .sendMessage({ target: 'background', type: 'VAD_SPEECH_END' })
    .catch(() => undefined);

  debugLog('Offscreen', 'Recording stopped');
}

/**
 * Releases system resources: AudioContext and MediaStream tracks.
 */
async function cleanupMediaResources() {
  if (audioPassthrough) {
    await audioPassthrough.close().catch(() => undefined);
    audioPassthrough = null;
  }
  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
  }
  activeStream = null;
}

/**
 * Helper to check if a specific callback still belongs to the active session.
 */
function isCurrentSession(sessionId: number) {
  return isRecording && sessionId === recordingSessionId;
}

// ---------------------------------------------------------------------------
// Audio Chunk Processing: Transcription & Segmentation.
// ---------------------------------------------------------------------------

/**
 * Sends an audio blob to Groq Whisper for transcription and dispatches sentences.
 * The speaker embedding is computed concurrently with the transcription call.
 */
async function processAudioChunk(
  blob: Blob,
  audio: Float32Array,
  sessionId: number
) {
  if (!isCurrentSession(sessionId)) {
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

    const whisperModel = cachedSettings.whisperModel || DEFAULT_WHISPER_MODEL;
    const whisperLanguage =
      cachedSettings.sourceLanguage && cachedSettings.sourceLanguage !== 'auto'
        ? cachedSettings.sourceLanguage
        : undefined;

    // Provide recent transcription history to Whisper as a prompt for dynamic adaptation.
    const whisperPrompt =
      whisperPromptBuffer.length > 0
        ? whisperPromptBuffer.slice(-3).join(' ')
        : undefined;

    const speakerEnabled = isSpeakerDetectionEnabled();
    const embeddingPromise: Promise<Float32Array | null> = speakerEnabled
      ? extractSpeakerEmbedding(audio).catch((error) => {
          debugWarn('Offscreen', 'Speaker embedding failed', error);
          return null;
        })
      : Promise.resolve(null);

    const startMs = performance.now();
    const [transcription, embedding] = await Promise.all([
      transcribeAudioChunk(
        blob,
        cachedSettings.groqApiKey,
        whisperModel,
        whisperLanguage,
        whisperPrompt
      ),
      embeddingPromise
    ]);
    const durationMs = performance.now() - startMs;

    if (!transcription || !isCurrentSession(sessionId)) {
      return;
    }

    const speakerId = speakerEnabled
      ? speakerClustering.assign(embedding)
      : undefined;

    // Speaker turn change: flush buffered text under the previous speaker
    // so sentences from different speakers are never merged.
    if (
      speakerEnabled &&
      bufferSpeakerId !== undefined &&
      speakerId !== bufferSpeakerId
    ) {
      const carryover = sentenceBuffer.drain();
      for (const sentence of carryover) {
        if (!isCurrentSession(sessionId)) break;
        await sendSegment(sentence, bufferSpeakerId);
      }
    }
    bufferSpeakerId = speakerId;

    // Update the Whisper context buffer.
    whisperPromptBuffer.push(transcription);
    if (whisperPromptBuffer.length > 5) {
      whisperPromptBuffer.shift();
    }

    // Segment the raw transcription into individual sentences.
    const sentences = sentenceBuffer.flush(transcription);

    for (const sentence of sentences) {
      if (!isCurrentSession(sessionId)) break;
      debugLog(
        'Offscreen',
        `Sending segment: "${sentence.substring(0, 60)}…" (${Math.round(durationMs)}ms)`
      );

      // Notify background about the new transcription segment.
      const msg: BackgroundRequestMessage = {
        target: 'background',
        type: 'TRANSCRIPTION_SEGMENT',
        text: sentence,
        durationMs,
        speakerId
      };
      await chrome.runtime.sendMessage(msg).catch(() => undefined);
    }
  } catch (error) {
    debugError('Offscreen', 'Pipeline error during chunk processing:', error);
    await notifyPipelineError(
      error instanceof Error
        ? error.message
        : 'Unknown error in transcription pipeline'
    );
  } finally {
    // Optional: add specific cleanup here if needed.
  }
}

/**
 * Sends a raw text segment directly to the background service worker.
 */
async function sendSegment(text: string, speakerId?: number): Promise<void> {
  debugLog('Offscreen', `Sending segment: "${text.substring(0, 60)}…"`);
  const msg: BackgroundRequestMessage = {
    target: 'background',
    type: 'TRANSCRIPTION_SEGMENT',
    text,
    speakerId
  };
  await chrome.runtime.sendMessage(msg).catch(() => undefined);
}

/**
 * Reports pipeline errors back to the background for UI manifestation.
 */
async function notifyPipelineError(message: string) {
  debugError('Offscreen', `Pipeline error: ${message}`);
  const backgroundMessage: BackgroundRequestMessage = {
    target: 'background',
    type: 'PIPELINE_ERROR',
    message
  };
  await chrome.runtime.sendMessage(backgroundMessage).catch(() => undefined);
}
