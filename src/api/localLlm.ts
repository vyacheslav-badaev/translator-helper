import { pipeline, env } from '@huggingface/transformers';
import type {
  TextGenerationPipeline,
  ProgressInfo
} from '@huggingface/transformers';
import { LOCAL_TRANSLATION_MODEL } from '../constants';
import { debugWarn } from '../utils/debug';

export type LocalLlmModelStatus =
  | 'not_cached'
  | 'downloading'
  | 'warming_up'
  | 'cached'
  | 'loaded'
  | 'error';

const MODEL_ID = LOCAL_TRANSLATION_MODEL.repoId;

/** Upper bound on generated tokens per segment; translations are short. */
const MAX_NEW_TOKENS = 256;

/**
 * Qwen3 is a hybrid reasoning model. Thinking is disabled through the chat
 * template so translations arrive immediately instead of after a reasoning
 * block, which would blow the real-time latency budget.
 */
const CHAT_TEMPLATE_KWARGS = { enable_thinking: false } as const;

/** Matches a leading reasoning block, emitted if the template ignores the flag. */
const THINK_BLOCK_PATTERN = /^\s*<think>[\s\S]*?<\/think>\s*/;

/** Labels the model prepends despite being told to answer with the translation only. */
const OUTPUT_LABEL_PATTERN =
  /^\s*(?:translation|translated text|output|answer|перевод)\s*:\s*/i;

/** Quote characters the model wraps whole answers in, as open/close pairs. */
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['«', '»'],
  ['“', '”']
];

function stripWrappingQuotes(text: string): string {
  for (const [open, close] of QUOTE_PAIRS) {
    if (text.length > open.length + close.length) {
      if (text.startsWith(open) && text.endsWith(close)) {
        return text.slice(open.length, -close.length).trim();
      }
    }
  }
  return text;
}

/**
 * Reduces a raw generation down to the translated sentence.
 *
 * Every segment holds a single sentence, so any line after the first is
 * commentary the model was instructed not to produce and is safe to drop.
 */
function sanitizeTranslation(raw: string): string {
  const withoutThinking = raw.replace(THINK_BLOCK_PATTERN, '');
  const firstLine =
    withoutThinking.split('\n').find((line) => line.trim().length > 0) ?? '';
  const withoutLabel = firstLine.trim().replace(OUTPUT_LABEL_PATTERN, '');
  return stripWrappingQuotes(withoutLabel.trim());
}

/** Collapses a string to a single readable line for log output. */
function forLog(text: string, limit = 200): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit)}…` : collapsed;
}

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

class LocalLlmSession {
  private pipe: TextGenerationPipeline | null = null;
  private status: LocalLlmModelStatus = 'not_cached';
  private error: string | null = null;

  getStatus(): LocalLlmModelStatus {
    return this.status;
  }

  getError(): string | null {
    return this.error;
  }

  async downloadAndCache(
    onProgress: (percent: number, phase: 'download' | 'warmup') => void
  ): Promise<void> {
    configureEnv();
    this.status = 'downloading';
    this.error = null;

    try {
      this.pipe = (await (
        pipeline as (
          task: string,
          model: string,
          opts: object
        ) => Promise<unknown>
      )('text-generation', MODEL_ID, {
        device: 'webgpu',
        dtype: 'q4f16',
        progress_callback: this.createAggregateProgress(onProgress)
      })) as TextGenerationPipeline;

      this.status = 'warming_up';
      await this.warmup(onProgress);

      this.status = 'cached';
    } catch (err) {
      this.status = 'error';
      this.error =
        err instanceof Error
          ? err.message
          : 'Unknown error during model download';
      throw err;
    }
  }

  /**
   * Adapts the library's aggregate `progress_total` events to the extension's
   * progress channel. Per-file `progress` events are ignored: the Hugging Face
   * CDN omits `Content-Length` from CORS-exposed headers, so per-file totals
   * are unreliable and cannot be summed into a meaningful percentage.
   */
  private createAggregateProgress(
    onProgress: (percent: number, phase: 'download' | 'warmup') => void
  ): (info: ProgressInfo) => void {
    let lastPercent = 0;
    return (info: ProgressInfo) => {
      if (info.status !== 'progress_total') return;
      const percent = Math.round(info.progress);
      if (!Number.isFinite(percent)) return;
      // Clamp monotonically: newly discovered files can briefly lower the ratio.
      lastPercent = Math.max(lastPercent, Math.min(percent, 100));
      onProgress(lastPercent, 'download');
    };
  }

  private async warmup(
    onProgress: (percent: number, phase: 'download' | 'warmup') => void
  ): Promise<void> {
    if (!this.pipe) return;
    onProgress(0, 'warmup');
    await (this.pipe as TextGenerationPipeline)(
      [{ role: 'user', content: 'Hi' }],
      {
        max_new_tokens: 1,
        do_sample: false,
        tokenizer_encode_kwargs: CHAT_TEMPLATE_KWARGS
      }
    );
    onProgress(100, 'warmup');
  }

  async loadFromCache(
    onProgress?: (percent: number, phase: 'download' | 'warmup') => void
  ): Promise<void> {
    if (this.pipe) {
      this.status = 'loaded';
      return;
    }
    configureEnv();
    try {
      this.pipe = (await (
        pipeline as (
          task: string,
          model: string,
          opts: object
        ) => Promise<unknown>
      )('text-generation', MODEL_ID, {
        device: 'webgpu',
        dtype: 'q4f16',
        progress_callback: onProgress
          ? this.createAggregateProgress(onProgress)
          : undefined
      })) as TextGenerationPipeline;
      this.status = 'loaded';
    } catch (err) {
      this.status = 'error';
      this.error =
        err instanceof Error ? err.message : 'Unknown error loading model';
      throw err;
    }
  }

  async translate(text: string, systemPrompt: string): Promise<string> {
    if (!this.pipe) {
      throw new Error('Local LLM not loaded. Call loadFromCache() first.');
    }

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: text }
    ];

    const output = await (this.pipe as TextGenerationPipeline)(messages, {
      max_new_tokens: MAX_NEW_TOKENS,
      do_sample: false,
      tokenizer_encode_kwargs: CHAT_TEMPLATE_KWARGS
    });

    const generated = Array.isArray(output) ? output[0] : output;
    const generatedText = (
      generated as { generated_text: Array<{ role: string; content: string }> }
    ).generated_text;
    const lastMessage = generatedText[generatedText.length - 1];
    const raw = lastMessage?.content ?? '';
    const translation = sanitizeTranslation(raw);

    // A sub-1B model occasionally answers with nothing usable or echoes the
    // input verbatim. That is expected rather than exceptional, so the segment
    // is dropped with a warning instead of surfacing as a pipeline error.
    const isEcho =
      translation.toLowerCase() === text.trim().toLowerCase();
    if (!translation || isEcho) {
      debugWarn(
        'LocalLLM',
        `Discarded ${isEcho ? 'echoed' : 'empty'} translation of "${forLog(text, 80)}" — raw output: "${forLog(raw)}"`
      );
      return '';
    }

    return translation;
  }

  async unload(): Promise<void> {
    if (this.pipe) {
      await this.pipe.dispose();
      this.pipe = null;
    }
    this.status = 'cached';
  }
}

export const localLlm = new LocalLlmSession();
