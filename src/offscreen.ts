/**
 * Offscreen Document — Audio Capture & Transcription.
 *
 * Pipeline per chunk:
 *   MicVAD (Voice Activity Detection) → Groq Whisper (transcription) → SentenceBuffer
 *   → TRANSCRIPTION_SEGMENT messages to background service worker.
 */

import { transcribeAudioChunk } from './api/groq';
import { DEFAULT_WHISPER_MODEL } from './constants';
import type { StoredSettings } from './types/settings';
import type {
  BackgroundRequestMessage,
  OffscreenRequestMessage
} from './types/messages';
import { SentenceBuffer } from './utils/sentenceBuffer';
import { debugLog, debugWarn, debugError } from './utils/debug';
import { MicVAD, utils } from '@ricky0123/vad-web';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChromeTabCaptureAudioConstraints = MediaTrackConstraints & {
  mandatory: {
    chromeMediaSource: 'tab';
    chromeMediaSourceId: string;
  };
};

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let activeStream: MediaStream | null = null;
let audioPassthrough: AudioContext | null = null;
let myvad: MicVAD | null = null;
let isRecording = false;

let cachedSettings: StoredSettings | null = null;
let recordingSessionId = 0;
let processingQueue = Promise.resolve();

const sentenceBuffer = new SentenceBuffer();
const whisperPromptBuffer: string[] = [];

// ---------------------------------------------------------------------------
// Message listener
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
      return true;
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

  try {
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

    // Route captured audio back to speakers so the user still hears it.
    audioPassthrough = new AudioContext();
    const source = audioPassthrough.createMediaStreamSource(stream);
    source.connect(audioPassthrough.destination);
    debugLog('Offscreen', 'Audio passthrough connected to speakers');

    // Override getStream/pauseStream so VAD uses our tabCapture stream
    // instead of calling getUserMedia (which would fail in offscreen context).
    const vadOptions = {
      getStream: async () => activeStream!,
      pauseStream: async () => {
        /* stream lifecycle managed by stopRecording */
      },
      model: 'v5' as const,
      baseAssetPath: chrome.runtime.getURL(''),
      onnxWASMBasePath: chrome.runtime.getURL(''),
      workletURL: chrome.runtime.getURL('vad.worklet.bundle.min.js'),
      // VAD v0.0.30 uses ms-based parameters (frame-based ones are ignored).
      // Aggressive optimization for very fast dialogue segments.
      positiveSpeechThreshold: 0.8,
      negativeSpeechThreshold: 0.45,
      minSpeechMs: 150,
      preSpeechPadMs: 100,
      redemptionMs: 200,
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

        // Convert Float32Array to WAV blob for Whisper
        try {
          const wavBuffer = utils.encodeWAV(audio);
          const blob = new Blob([wavBuffer], { type: 'audio/wav' });

          processingQueue = processingQueue
            .then(() => processAudioChunk(blob, sessionId))
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

async function stopRecording() {
  debugLog('Offscreen', 'Stopping recording…');

  isRecording = false;
  recordingSessionId += 1;

  if (myvad) {
    myvad.destroy();
    myvad = null;
  }

  const remaining = sentenceBuffer.drain();
  for (const sentence of remaining) {
    await sendSegment(sentence);
  }

  await cleanupMediaResources();
  sentenceBuffer.reset();
  whisperPromptBuffer.length = 0;

  // Send an end message just in case we stopped while speaking
  chrome.runtime
    .sendMessage({ target: 'background', type: 'VAD_SPEECH_END' })
    .catch(() => undefined);

  debugLog('Offscreen', 'Recording stopped');
}

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

function isCurrentSession(sessionId: number) {
  return isRecording && sessionId === recordingSessionId;
}

// ---------------------------------------------------------------------------
// Audio chunk processing pipeline
// ---------------------------------------------------------------------------

async function processAudioChunk(blob: Blob, sessionId: number) {
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
    const whisperPrompt =
      whisperPromptBuffer.length > 0
        ? whisperPromptBuffer.slice(-3).join(' ')
        : undefined;

    const startMs = performance.now();
    const transcription = await transcribeAudioChunk(
      blob,
      cachedSettings.groqApiKey,
      whisperModel,
      whisperLanguage,
      whisperPrompt
    );
    const durationMs = performance.now() - startMs;

    if (!transcription || !isCurrentSession(sessionId)) {
      return;
    }

    whisperPromptBuffer.push(transcription);
    if (whisperPromptBuffer.length > 5) {
      whisperPromptBuffer.shift();
    }

    const sentences = sentenceBuffer.flush(transcription);

    for (const sentence of sentences) {
      if (!isCurrentSession(sessionId)) break;
      debugLog('Offscreen', `Sending segment: "${sentence.substring(0, 60)}…" (${Math.round(durationMs)}ms)`);
      const msg: BackgroundRequestMessage = {
        target: 'background',
        type: 'TRANSCRIPTION_SEGMENT',
        text: sentence,
        durationMs
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
  }
}

async function sendSegment(text: string): Promise<void> {
  debugLog('Offscreen', `Sending segment: "${text.substring(0, 60)}…"`);
  const msg: BackgroundRequestMessage = {
    target: 'background',
    type: 'TRANSCRIPTION_SEGMENT',
    text
  };
  await chrome.runtime.sendMessage(msg).catch(() => undefined);
}

async function notifyPipelineError(message: string) {
  debugError('Offscreen', `Pipeline error: ${message}`);
  const backgroundMessage: BackgroundRequestMessage = {
    target: 'background',
    type: 'PIPELINE_ERROR',
    message
  };
  await chrome.runtime.sendMessage(backgroundMessage).catch(() => undefined);
}
