/**
 * Shared constants used across all extension contexts
 * (background service worker, offscreen document, content script, popup).
 */

/** Default system prompt sent to Gemini when user has not set a custom one. */
export const DEFAULT_SYSTEM_PROMPT =
  'You are a real-time translator. Translate the text to Russian. Output ONLY the translated text without any other comments, quotes, or markdown.';

/** How long (ms) an error toast stays visible before auto-dismissing. */
export const ERROR_TIMEOUT_MS = 5000;

/** Groq Whisper transcription REST endpoint (file-based, not streaming). */
export const GROQ_TRANSCRIPTION_URL =
  'https://api.groq.com/openai/v1/audio/transcriptions';

// ---------------------------------------------------------------------------
// Gemini translation model
// ---------------------------------------------------------------------------

/** Default Gemini model used for translation requests. */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/** Available Gemini models for the user to choose from in settings. */
export const GEMINI_MODELS = [
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    description: 'Fast and stable'
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash Lite',
    description: 'Lowest latency and cost'
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    description: 'Highest quality reasoning'
  },
  {
    id: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash (Preview)',
    description: 'Next-gen fast model (preview)'
  },
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro (Preview)',
    description: 'Next-gen flagship (preview)'
  }
] as const;

// ---------------------------------------------------------------------------
// Whisper transcription model
// ---------------------------------------------------------------------------

/** Default Whisper model used for transcription via Groq. */
export const DEFAULT_WHISPER_MODEL = 'whisper-large-v3';

/** Available Whisper models for the user to choose from in settings. */
export const WHISPER_MODELS = [
  {
    id: 'whisper-large-v3',
    label: 'Whisper Large v3',
    description: 'High accuracy'
  },
  {
    id: 'whisper-large-v3-turbo',
    label: 'Whisper Large v3 Turbo',
    description: '216× real-time speed'
  }
] as const;

// ---------------------------------------------------------------------------
// VAD-based smart chunking
// Instead of fixed-interval chunks, audio is split at natural speech pauses
// detected via RMS volume analysis through Web Audio API AnalyserNode.
// ---------------------------------------------------------------------------

/** How often (ms) the VAD polls the AnalyserNode for RMS volume. */
export const VAD_POLL_INTERVAL_MS = 100;

/** RMS value below this threshold is considered silence (range 0–1). */
export const SILENCE_VOLUME_THRESHOLD = 0.05;

/** Continuous silence duration (ms) required to trigger a chunk flush. */
export const SILENCE_DURATION_MS = 2000;

/** Minimum chunk duration (ms) — prevents sending micro-fragments. */
export const MIN_CHUNK_MS = 3000;

/** Maximum chunk duration (ms) — forces a flush even without silence. */
export const MAX_CHUNK_MS = 10000;

// ---------------------------------------------------------------------------
// Auto-shutdown on inactivity
// ---------------------------------------------------------------------------

/** Duration (ms) of no new segments before translation auto-stops. Default: 5 minutes. */
export const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
