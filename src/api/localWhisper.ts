import { pipeline, env } from '@huggingface/transformers';
import type {
  AutomaticSpeechRecognitionPipeline,
  ProgressInfo
} from '@huggingface/transformers';
import { DEFAULT_LOCAL_WHISPER_MODEL } from '../constants';
import type { LocalWhisperModelId } from '../constants';

export type LocalWhisperStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Per-file precision for the Whisper encoder/decoder session pair.
 *
 * The decoder must not use the `q8` default: ONNX Runtime 1.25+ rewrites its
 * quantized token embedding into MatMulNBits and aborts because these exports
 * carry no scale tensor for it (onnxruntime#28306). The `q4` export uses
 * MatMulNBits natively and loads, while the encoder is unaffected and stays on
 * the much smaller `q8`.
 */
const WHISPER_DTYPE = {
  encoder_model: 'q8',
  decoder_model_merged: 'q4'
} as const;

function configureEnv() {
  const wasm = env.backends?.onnx?.wasm;
  if (wasm) {
    // Use the isolated copy of transformers' own ORT build (see vite.config.ts);
    // the extension root holds a different onnxruntime-web version.
    wasm.wasmPaths = chrome.runtime.getURL('transformers/');
  }
  env.allowRemoteModels = true;
  env.allowLocalModels = false;
}

class LocalWhisperSession {
  private pipe: AutomaticSpeechRecognitionPipeline | null = null;
  private status: LocalWhisperStatus = 'idle';
  private currentModelId: LocalWhisperModelId | null = null;
  private error: string | null = null;

  getStatus(): LocalWhisperStatus {
    return this.status;
  }

  getError(): string | null {
    return this.error;
  }

  async loadModel(
    modelId: LocalWhisperModelId = DEFAULT_LOCAL_WHISPER_MODEL,
    onProgress?: (info: ProgressInfo) => void
  ): Promise<void> {
    if (this.pipe && this.currentModelId === modelId) {
      return;
    }

    if (this.pipe) {
      await this.unload();
    }

    configureEnv();
    this.status = 'loading';
    this.error = null;

    try {
      this.pipe = (await (
        pipeline as (
          task: string,
          model: string,
          opts: object
        ) => Promise<unknown>
      )('automatic-speech-recognition', modelId, {
        device: 'wasm',
        dtype: WHISPER_DTYPE,
        progress_callback: onProgress
      })) as AutomaticSpeechRecognitionPipeline;
      this.currentModelId = modelId;
      this.status = 'ready';
    } catch (err) {
      this.status = 'error';
      this.error =
        err instanceof Error
          ? err.message
          : 'Unknown error loading Whisper model';
      throw err;
    }
  }

  async transcribe(audio: Float32Array, language?: string): Promise<string> {
    if (!this.pipe) {
      throw new Error('Local Whisper not loaded. Call loadModel() first.');
    }

    const options: Record<string, unknown> = {
      return_timestamps: false
    };

    if (language && language !== 'auto') {
      options.language = language;
    }

    const result = await this.pipe(audio, options);

    if (Array.isArray(result)) {
      return (result as Array<{ text: string }>)[0]?.text?.trim() ?? '';
    }

    return (result as { text: string }).text?.trim() ?? '';
  }

  async unload(): Promise<void> {
    if (this.pipe) {
      await this.pipe.dispose();
      this.pipe = null;
    }
    this.currentModelId = null;
    this.status = 'idle';
  }
}

export const localWhisper = new LocalWhisperSession();
