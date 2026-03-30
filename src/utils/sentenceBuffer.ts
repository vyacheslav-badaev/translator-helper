/**
 * SentenceBuffer — Accumulates raw audio transcription fragments and reconstructs full sentences.
 *
 * Problem: Whisper results often cut mid-sentence or provide short fragments.
 * Solution: This class buffers fragments and uses a regex-based strategy to detect 
 * stable sentence boundaries before emitting them for translation.
 *
 * Splitting strategy:
 *   1. Append each Whisper fragment to an internal string buffer.
 *   2. Split on punctuation (. ! ?) followed by a space and an uppercase letter (English/Russian).
 *   3. Protect common abbreviations (Mr., Dr., etc.) from causing false splits.
 *   4. Safety Flush: If a fragment reaches MAX_FRAGMENT_WORDS without punctuation, 
 *      emit it as-is to ensure real-time responsiveness.
 */

import { debugLog } from './debug';

/** Prevents infinite buffering in case of long speech without punctuation. */
const MAX_FRAGMENT_WORDS = 25;

/** 
 * Regex optimized for English and Russian sentence boundaries.
 * Uses negative lookbehind to avoid splitting on common abbreviations.
 */
const SENTENCE_BOUNDARY = /(?<=[.!?])(?<!\b(?:Mr|Mrs|Ms|Dr|Prof|Rev|St|Sgt|Capt|Gen|Sen|Rep|Gov|Fig|Eq|vs|e\.g|i\.e)\.)\s+(?=[A-ZА-ЯЁ])/;

export class SentenceBuffer {
  private buffer = '';

  /**
   * Appends new transcription text and returns an array of stable sentences.
   * Internal buffer keeps the trailing incomplete fragment.
   */
  flush(text: string): string[] {
    this.buffer += (this.buffer ? ' ' : '') + text.trim();

    const sentences: string[] = [];
    const parts = this.buffer.split(SENTENCE_BOUNDARY);

    // All parts except the last one are considered completed sentences.
    for (let i = 0; i < parts.length - 1; i++) {
      const sentence = parts[i].trim();
      if (sentence) {
        sentences.push(sentence);
      }
    }

    // The last part is buffered for further accumulation.
    const remainder = parts[parts.length - 1].trim();

    // Force flush if the dialogue is too long without punctuation.
    const wordCount = remainder.split(/\s+/).length;
    if (wordCount >= MAX_FRAGMENT_WORDS) {
      debugLog('SentenceBuffer', `Forcing flush of long fragment (${wordCount} words)`);
      sentences.push(remainder);
      this.buffer = '';
    } else {
      this.buffer = remainder;
    }

    if (sentences.length > 0) {
      debugLog('SentenceBuffer', `Emitted ${sentences.length} sentence(s), remaining buffer: "${this.buffer.substring(0, 40)}…"`);
    }

    return sentences;
  }

  /**
   * Returns all remaining text in the buffer. Use this when the audio stream ends.
   */
  drain(): string[] {
    const text = this.buffer.trim();
    this.buffer = '';
    return text ? [text] : [];
  }

  /** Resets state entirely. */
  reset(): void {
    this.buffer = '';
  }
}
