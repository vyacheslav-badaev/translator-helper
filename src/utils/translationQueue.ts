/**
 * TranslationQueue — rate-limited, batched translation queue.
 *
 * Segments are enqueued with their IDs and original text.
 * The queue drains automatically, batching up to BATCH_SIZE segments
 * into a single Gemini API call. A minimum delay between calls
 * prevents hitting rate limits.
 *
 * On success, the provided callback delivers translated text per segment ID.
 * On 429 (rate limit), the queue pauses and retries with exponential backoff.
 */

import { translateText } from '../api/gemini';
import { debugLog, debugWarn, debugError } from './debug';

/** How many segments to batch into one Gemini call. */
const BATCH_SIZE = 3;

/** Minimum delay (ms) between consecutive Gemini API calls. */
const MIN_DELAY_MS = 2500;

/** Initial backoff (ms) on 429 rate-limit errors. */
const INITIAL_BACKOFF_MS = 5000;

/** Maximum backoff (ms). */
const MAX_BACKOFF_MS = 60000;

interface QueueItem {
  segmentId: number;
  text: string;
}

type TranslationCallback = (segmentId: number, translatedText: string) => void;
type ErrorCallback = (message: string) => void;

export class TranslationQueue {
  private queue: QueueItem[] = [];
  private isProcessing = false;
  private backoffMs = INITIAL_BACKOFF_MS;
  private lastCallTime = 0;
  private sessionId = 0;

  private apiKey = '';
  private prompt = '';
  private model = '';
  private contextBuffer: string[] = [];

  private onTranslation: TranslationCallback;
  private onError: ErrorCallback;

  constructor(onTranslation: TranslationCallback, onError: ErrorCallback) {
    this.onTranslation = onTranslation;
    this.onError = onError;
  }

  /** Update API settings (called when recording starts). */
  configure(apiKey: string, prompt: string, model: string): void {
    this.apiKey = apiKey;
    this.prompt = prompt;
    this.model = model;
  }

  /** Add a segment to the translation queue. */
  enqueue(segmentId: number, text: string): void {
    this.queue.push({ segmentId, text });
    debugLog(
      'TranslationQueue',
      `Enqueued segment #${segmentId} (queue size: ${this.queue.length})`
    );
    void this.processLoop();
  }

  /** Clear the queue and abort any in-flight processing. */
  clear(): void {
    this.sessionId++; // invalidate any sleeping/in-flight loop
    this.queue = [];
    this.contextBuffer = [];
    this.isProcessing = false;
    this.backoffMs = INITIAL_BACKOFF_MS;
  }

  private async processLoop(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    const loopSession = this.sessionId;

    while (this.queue.length > 0 && loopSession === this.sessionId) {
      // Rate limit: ensure minimum delay between calls.
      const elapsed = Date.now() - this.lastCallTime;
      if (elapsed < MIN_DELAY_MS) {
        await this.sleep(MIN_DELAY_MS - elapsed);
        if (loopSession !== this.sessionId) break; // aborted during sleep
      }

      // Take a batch from the queue.
      const batch = this.queue.splice(0, BATCH_SIZE);
      debugLog(
        'TranslationQueue',
        `Processing batch of ${batch.length} segment(s)`
      );

      try {
        if (batch.length === 1) {
          // Single segment — direct translation.
          const result = await translateText(
            batch[0].text,
            this.apiKey,
            this.prompt,
            this.model,
            this.contextBuffer.length > 0 ? [...this.contextBuffer] : undefined
          );

          this.lastCallTime = Date.now();
          this.backoffMs = INITIAL_BACKOFF_MS; // reset backoff on success

          if (result) {
            this.contextBuffer.push(batch[0].text);
            if (this.contextBuffer.length > 5) this.contextBuffer.shift();
            this.onTranslation(batch[0].segmentId, result);
          }
        } else {
          // Multiple segments — batch translation.
          const numberedInput = batch
            .map((item, i) => `[${i + 1}] ${item.text}`)
            .join('\n');

          const batchPrompt =
            this.prompt +
            '\n\nTranslate each numbered segment below. Return ONLY the translations in the same numbered format [1], [2], etc.';

          const result = await translateText(
            numberedInput,
            this.apiKey,
            batchPrompt,
            this.model,
            this.contextBuffer.length > 0 ? [...this.contextBuffer] : undefined
          );

          this.lastCallTime = Date.now();
          this.backoffMs = INITIAL_BACKOFF_MS;

          if (result) {
            // Parse numbered results.
            const translations = this.parseBatchResult(result, batch.length);
            for (let i = 0; i < batch.length; i++) {
              const translated = translations[i] || null;
              if (!translated) {
                debugWarn(
                  'TranslationQueue',
                  `Batch parse failed for segment #${batch[i].segmentId}, skipping`
                );
                continue;
              }
              this.contextBuffer.push(batch[i].text);
              if (this.contextBuffer.length > 5) this.contextBuffer.shift();
              this.onTranslation(batch[i].segmentId, translated);
            }
          }
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);

        // Check for rate limit (429).
        if (errMsg.includes('429') || errMsg.toLowerCase().includes('rate')) {
          debugWarn(
            'TranslationQueue',
            `Rate limited, backing off ${this.backoffMs}ms`
          );
          // Put items back at the front of the queue.
          this.queue.unshift(...batch);
          await this.sleep(this.backoffMs);
          if (loopSession !== this.sessionId) break; // aborted during backoff
          this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
        } else {
          debugError('TranslationQueue', `Translation failed: ${errMsg}`);
          this.onError(errMsg);
        }
      }
    }

    this.isProcessing = false;
  }

  /**
   * Parses a numbered batch result like:
   *   [1] Привет
   *   [2] Мир
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
