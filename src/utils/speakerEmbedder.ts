/**
 * speakerEmbedder — Extracts speaker embeddings via the bundled
 * WeSpeaker ResNet34-LM int8 ONNX model running on onnxruntime-web (WASM).
 *
 * Used by the offscreen document only. The session is created lazily on
 * first use and must be disposed via `disposeSpeakerEmbedder()` when the
 * recording session stops.
 */

import * as ort from 'onnxruntime-web';
import { MIN_EMBEDDING_AUDIO_MS, SPEAKER_MODEL_FILENAME } from '../constants';
import { computeFbank } from './fbank';
import { debugLog, debugWarn } from './debug';

const AUDIO_SAMPLE_RATE = 16000;
const MIN_EMBEDDING_SAMPLES =
  (MIN_EMBEDDING_AUDIO_MS / 1000) * AUDIO_SAMPLE_RATE;

let sessionPromise: Promise<ort.InferenceSession> | null = null;
let isInitializing = false;

/** Creates (or reuses) the ONNX inference session for the speaker model. */
function getSession(): Promise<ort.InferenceSession> {
  if (sessionPromise) {
    return sessionPromise;
  }

  if (isInitializing) {
    // Wait for the ongoing initialization to complete.
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (sessionPromise) {
          clearInterval(checkInterval);
          sessionPromise.then(resolve).catch(reject);
        } else if (!isInitializing) {
          // Initialization failed, try again.
          clearInterval(checkInterval);
          getSession().then(resolve).catch(reject);
        }
      }, 10);
    });
  }

  isInitializing = true;
  ort.env.wasm.wasmPaths = chrome.runtime.getURL('');
  sessionPromise = ort.InferenceSession.create(
    chrome.runtime.getURL(SPEAKER_MODEL_FILENAME),
    { executionProviders: ['wasm'] }
  )
    .then((session) => {
      debugLog('SpeakerEmbedder', 'ONNX session created');
      isInitializing = false;
      return session;
    })
    .catch((error) => {
      isInitializing = false;
      sessionPromise = null;
      throw error;
    });

  return sessionPromise;
}

/** Eagerly initializes the model so the first chunk is not delayed. */
export function preloadSpeakerEmbedder(): void {
  getSession().catch((error) =>
    debugWarn('SpeakerEmbedder', 'Preload failed', error)
  );
}

/**
 * Computes an L2-normalized 256-d speaker embedding for an audio chunk.
 *
 * @param audio - Mono PCM samples in [-1, 1] at 16 kHz (VAD output).
 * @returns Embedding vector, or `null` when the chunk is too short for a
 *          reliable embedding (caller should inherit the previous speaker).
 */
export async function extractSpeakerEmbedding(
  audio: Float32Array
): Promise<Float32Array | null> {
  if (audio.length < MIN_EMBEDDING_SAMPLES) {
    return null;
  }

  const fbank = computeFbank(audio);
  if (!fbank) {
    return null;
  }

  const session = await getSession();
  const input = new ort.Tensor('float32', fbank.features, [
    1,
    fbank.numFrames,
    fbank.numBins
  ]);

  if (!session.inputNames.length) {
    debugWarn('SpeakerEmbedder', 'ONNX session has no input names');
    return null;
  }
  if (!session.outputNames.length) {
    debugWarn('SpeakerEmbedder', 'ONNX session has no output names');
    return null;
  }

  const startMs = performance.now();
  const outputs = await session.run({ [session.inputNames[0]]: input });
  const raw = outputs[session.outputNames[0]].data as Float32Array;
  debugLog(
    'SpeakerEmbedder',
    `Embedding extracted in ${Math.round(performance.now() - startMs)}ms`
  );

  // L2-normalize so downstream cosine similarity is a plain dot product.
  let norm = 0;
  for (let i = 0; i < raw.length; i++) {
    norm += raw[i] * raw[i];
  }
  norm = Math.sqrt(norm);
  if (norm === 0) {
    return null;
  }

  const embedding = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    embedding[i] = raw[i] / norm;
  }
  return embedding;
}

/** Releases the ONNX session. Safe to call multiple times. */
export async function disposeSpeakerEmbedder(): Promise<void> {
  if (!sessionPromise) return;
  const pending = sessionPromise;
  sessionPromise = null;
  try {
    const session = await pending;
    await session.release();
    debugLog('SpeakerEmbedder', 'ONNX session released');
  } catch {
    // Session failed to initialize; nothing to release.
  }
}
