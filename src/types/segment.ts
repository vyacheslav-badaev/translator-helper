/**
 * A single transcript segment that flows through the pipeline.
 * Created when a sentence is emitted from the sentence buffer,
 * then updated when a translation arrives from the Gemini queue.
 */
export interface TranscriptSegment {
  /** Unique identifier (monotonic counter). */
  id: number;
  /** Original transcribed text (English). */
  originalText: string;
  /** Translated text (Russian), null while pending. */
  translatedText: string | null;
  /** Whether Gemini translation is currently in-flight. */
  isTranslating: boolean;
  /** Unix timestamp (ms) when the segment was created. */
  timestamp: number;
  /** 1-based speaker tag assigned by diarization; undefined when disabled. */
  speakerId?: number;
}
