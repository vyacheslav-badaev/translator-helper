/**
 * SentenceBuffer — accumulates raw Whisper transcription fragments
 * and emits complete sentences.
 *
 * Splitting strategy:
 *   1. Append each Whisper result to an internal buffer.
 *   2. Split on sentence-ending punctuation (. ! ?) followed by a space or end-of-string.
 *   3. If a fragment has no sentence-ending punctuation but exceeds
 *      MAX_FRAGMENT_WORDS, emit it as-is (safety cap for long unpunctuated speech).
 *   4. Leftover text stays in the buffer for the next append.
 */

import { debugLog } from './debug';

/** Minimum number of words before we emit a sentence even without punctuation. */
const MAX_FRAGMENT_WORDS = 25;

/** 
 * Regex that splits on sentence-ending punctuation followed by whitespace or EOL,
 * but ignores common abbreviations like Mr., Dr., e.g., etc. using negative lookbehinds. 
 */
const SENTENCE_BOUNDARY = /(?<=[.!?])(?<!\b(?:Mr|Mrs|Ms|Dr|Prof|Rev|St|Sgt|Capt|Gen|Sen|Rep|Gov|Fig|Eq|vs|e\.g|i\.e)\.)\s+(?=[A-ZА-ЯЁ])/;

export class SentenceBuffer {
  private buffer = '';

  /**
   * Appends raw transcription text and returns any complete sentences
   * that can be extracted from the buffer.
   */
  flush(text: string): string[] {
    this.buffer += (this.buffer ? ' ' : '') + text.trim();

    const sentences: string[] = [];
    const parts = this.buffer.split(SENTENCE_BOUNDARY);

    // All parts except the last are complete sentences.
    for (let i = 0; i < parts.length - 1; i++) {
      const sentence = parts[i].trim();
      if (sentence) {
        sentences.push(sentence);
      }
    }

    // The last part may be incomplete — keep it in the buffer.
    const remainder = parts[parts.length - 1].trim();

    // Safety: if the remainder is very long (no punctuation), emit it anyway.
    const wordCount = remainder.split(/\s+/).length;
    if (wordCount >= MAX_FRAGMENT_WORDS) {
      debugLog('SentenceBuffer', `Forcing flush of long fragment (${wordCount} words)`);
      sentences.push(remainder);
      this.buffer = '';
    } else {
      this.buffer = remainder;
    }

    if (sentences.length > 0) {
      debugLog('SentenceBuffer', `Emitted ${sentences.length} sentence(s), buffer="${this.buffer.substring(0, 40)}…"`);
    }

    return sentences;
  }

  /**
   * Forces any remaining buffered text out as a sentence.
   * Call this when recording stops to avoid losing trailing text.
   */
  drain(): string[] {
    const text = this.buffer.trim();
    this.buffer = '';
    return text ? [text] : [];
  }

  /** Clears the buffer without emitting. */
  reset(): void {
    this.buffer = '';
  }
}
