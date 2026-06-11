/**
 * TranslationQueue — Manages a rate-limited and batched translation pipeline using Gemini API.
 *
 * This class ensures that performance is optimized for paid-tier API keys by:
 * 1. Batching multiple transcription segments into a single API request (up to BATCH_SIZE).
 * 2. Maintaining a minimum delay (MIN_DELAY_MS) between consecutive requests.
 * 3. Implementing exponential backoff and model fallbacks for resilience.
 *
 * It uses a persistent context buffer to provide the LLM with previous dialogue context,
 * which significantly improves translation consistency for long-running sessions.
 */

import { translateText as translateTextGemini } from '../api/gemini';
import { translateText as translateTextGroq } from '../api/groq';
import { TRANSLATION_MODELS, parseModelId } from '../constants';
import { debugLog, debugWarn, debugError } from './debug';

/** Maximum number of segments allowed in a single batch. */
const BATCH_SIZE = 5;

/** Minimum delay between Gemini API calls to respect rate limits (optimized for paid tier). */
const MIN_DELAY_MS = 500;

/** Initial delay for exponential backoff on rate-limit errors (429). */
const INITIAL_BACKOFF_MS = 5000;

/** Maximum allowed backoff delay. */
const MAX_BACKOFF_MS = 60000;

/** Internal representation of a queued transcription fragment. */
interface QueueItem {
  segmentId: number;
  text: string;
}

/** Callback signature for delivering translated text associated with a segment ID. */
type TranslationCallback = (segmentId: number, translatedText: string) => void;

/** Callback for reporting critical translation errors. */
type ErrorCallback = (message: string) => void;

export class TranslationQueue {
  private queue: QueueItem[] = [];
  private isProcessing = false;
  private backoffMs = INITIAL_BACKOFF_MS;
  private lastCallTime = 0;
  private sessionId = 0; // Incremented on clear() to invalidate stale process loops

  private geminiApiKey = '';
  private groqApiKey = '';
  private prompt = '';
  private model = '';
  private fallbackModels: string[] = []; // List of compatible models to try on failure
  private currentFallbackIndex = 0;
  private contextBuffer: string[] = []; // Historical context for the LLM

  private onTranslation: TranslationCallback;
  private onError: ErrorCallback;
  private onBatchComplete?: (durationMs: number, batchSize: number) => void;

  /**
   * @param onTranslation Dispatched when a segment is successfully translated.
   * @param onError Dispatched on critical API failure.
   * @param onBatchComplete Dispatched for performance tracking (telemetry).
   */
  constructor(
    onTranslation: TranslationCallback,
    onError: ErrorCallback,
    onBatchComplete?: (durationMs: number, batchSize: number) => void
  ) {
    this.onTranslation = onTranslation;
    this.onError = onError;
    this.onBatchComplete = onBatchComplete;
  }

  /** Current count of segments waiting for translation. */
  public get queueLength(): number {
    return this.queue.length;
  }

  /**
   * Configures the queue with active API settings.
   * Builds a per-provider fallback chain based on the selected model.
   */
  configure(
    geminiApiKey: string,
    groqApiKey: string,
    prompt: string,
    model: string
  ): void {
    this.geminiApiKey = geminiApiKey;
    this.groqApiKey = groqApiKey;
    this.prompt = prompt;
    this.model = model;
    this.currentFallbackIndex = 0;

    const { provider, model: rawModel } = parseModelId(model);

    if (provider === 'groq') {
      const allGroq = TRANSLATION_MODELS.filter(
        (m) => m.provider === 'groq'
      ).map((m) => m.id);
      this.fallbackModels = [model, ...allGroq.filter((m) => m !== model)];
    } else if (rawModel.includes('flash')) {
      const allFlash = TRANSLATION_MODELS.filter(
        (m) => m.provider === 'gemini' && m.id.includes('flash')
      ).map((m) => m.id);
      this.fallbackModels = [model, ...allFlash.filter((m) => m !== model)];
    } else {
      this.fallbackModels = [model];
    }

    debugLog(
      'TranslationQueue',
      `Configured: model=${model}, fallbacks=${this.fallbackModels.length}`
    );
  }

  /**
   * Adds a new transcription segment to the queue and triggers the processing loop.
   */
  enqueue(segmentId: number, text: string): void {
    this.queue.push({ segmentId, text });
    debugLog(
      'TranslationQueue',
      `Enqueued segment #${segmentId} (queue size: ${this.queue.length})`
    );
    void this.processLoop();
  }

  /**
   * Clears the queue, resets history, and increments the session ID to stop the current loop.
   */
  clear(): void {
    this.sessionId++;
    this.queue = [];
    this.contextBuffer = [];
    this.isProcessing = false;
    this.backoffMs = INITIAL_BACKOFF_MS;
  }

  /**
   * Core processing loop that handles batching and rate-limiting.
   */
  private async processLoop(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    const loopSession = this.sessionId;

    while (this.queue.length > 0 && loopSession === this.sessionId) {
      // 1. Minimum delay guard for rate-limiting.
      const elapsed = Date.now() - this.lastCallTime;
      if (elapsed < MIN_DELAY_MS) {
        await this.sleep(MIN_DELAY_MS - elapsed);
        if (loopSession !== this.sessionId) break;
      }

      // 2. Extract a batch of segments.
      const batch = this.queue.splice(0, BATCH_SIZE);
      debugLog(
        'TranslationQueue',
        `Processing batch of ${batch.length} segment(s)`
      );

      try {
        const currentModelToUse =
          this.fallbackModels[this.currentFallbackIndex] || this.model;

        const { provider, model: rawModelId } = parseModelId(currentModelToUse);
        const apiKey =
          provider === 'groq' ? this.groqApiKey : this.geminiApiKey;
        const translateFn =
          provider === 'groq' ? translateTextGroq : translateTextGemini;

        if (batch.length === 1) {
          // Optimization: single segment processing for lower latency when traffic is low.
          const startMs = performance.now();
          const result = await translateFn(
            batch[0].text,
            apiKey,
            this.prompt,
            rawModelId,
            this.contextBuffer.length > 0 ? [...this.contextBuffer] : undefined
          );
          const durationMs = performance.now() - startMs;

          this.handleSuccess();

          if (result) {
            this.updateContextAndNotify(
              batch[0].segmentId,
              batch[0].text,
              result
            );
            this.onBatchComplete?.(durationMs, 1);
          }
        } else {
          // Batch processing: packs multiple segments into one prompt for reduced token usage
          // and better contextual awareness across related sentences.
          const numberedInput = batch
            .map((item, i) => `[${i + 1}] ${item.text}`)
            .join('\n');

          const batchPrompt =
            this.prompt +
            '\n\nTranslate each numbered segment below. Return ONLY the translations in the same numbered format [1], [2], etc.';

          const startMs = performance.now();
          const result = await translateFn(
            numberedInput,
            apiKey,
            batchPrompt,
            rawModelId,
            this.contextBuffer.length > 0 ? [...this.contextBuffer] : undefined
          );
          const durationMs = performance.now() - startMs;

          this.handleSuccess();

          if (result) {
            const translations = this.parseBatchResult(result, batch.length);
            let successCount = 0;
            for (let i = 0; i < batch.length; i++) {
              const translated = translations[i] || null;
              if (!translated) {
                debugWarn(
                  'TranslationQueue',
                  `Batch parse failed for segment #${batch[i].segmentId}`
                );
                continue;
              }
              this.updateContextAndNotify(
                batch[i].segmentId,
                batch[i].text,
                translated
              );
              successCount++;
            }
            if (successCount > 0) {
              this.onBatchComplete?.(durationMs, successCount);
            }
          }
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        await this.handleError(batch, errMsg, loopSession);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Internal helper to reset backoff state on successful API call.
   * The active fallback model is intentionally preserved: once a working
   * model is found, subsequent batches keep using it instead of reverting
   * to a potentially rate-limited primary on every success.
   */
  private handleSuccess() {
    this.lastCallTime = Date.now();
    this.backoffMs = INITIAL_BACKOFF_MS;
  }

  /** Internal helper to manage context buffer and notify subscribers. */
  private updateContextAndNotify(
    id: number,
    original: string,
    translated: string
  ) {
    this.contextBuffer.push(original);
    if (this.contextBuffer.length > 10) this.contextBuffer.shift();
    this.onTranslation(id, translated);
  }

  /**
   * Handles API errors with model fallbacks and exponential backoff.
   */
  private async handleError(
    batch: QueueItem[],
    errMsg: string,
    loopSession: number
  ) {
    debugWarn('TranslationQueue', `Attempt failed: ${errMsg}`);

    // Try redundant models if available.
    if (this.currentFallbackIndex < this.fallbackModels.length - 1) {
      this.currentFallbackIndex++;
      this.queue.unshift(...batch); // Retry immediately with the next model
      return;
    }

    // Handle rate-limiting (429) or transient server errors (5xx).
    if (this.isRetryable(errMsg)) {
      debugWarn('TranslationQueue', `Retrying in ${this.backoffMs}ms`);
      this.queue.unshift(...batch);
      await this.sleep(this.backoffMs);
      if (loopSession !== this.sessionId) return; // session changed during sleep
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      this.currentFallbackIndex = 0;
    } else {
      debugError('TranslationQueue', `Critical translation error: ${errMsg}`);
      this.onError(errMsg);
    }
  }

  private isRetryable(msg: string): boolean {
    const codes = ['429', '503', '500', 'rate'];
    const normalized = msg.toLowerCase();
    return codes.some((code) => normalized.includes(code));
  }

  /**
   * Parses the batched response from the LLM based on the numbered format.
   */
  private parseBatchResult(result: string, expectedCount: number): string[] {
    const translations: string[] = [];
    for (let i = 1; i <= expectedCount; i++) {
      const pattern = new RegExp(
        `\\[${i}\\]\\s*(.+?)(?=\\[${i + 1}\\]|$)`,
        's'
      );
      const match = result.match(pattern);
      translations.push(match ? match[1].trim() : '');
    }
    return translations;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
