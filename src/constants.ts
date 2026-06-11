/**
 * Shared constants used across all extension contexts
 * (background service worker, offscreen document, content script, popup).
 */

export const SOURCE_LANGUAGES = [
  { id: 'auto', label: 'Auto-Detect' },
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Spanish' },
  { id: 'de', label: 'German' },
  { id: 'fr', label: 'French' },
  { id: 'it', label: 'Italian' },
  { id: 'ru', label: 'Russian' }
];

export const TARGET_LANGUAGES = [
  { id: 'ru', label: 'Russian' },
  { id: 'uk', label: 'Ukrainian' },
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Spanish' },
  { id: 'de', label: 'German' },
  { id: 'fr', label: 'French' }
];

export const DEFAULT_SOURCE_LANGUAGE = 'auto';
export const DEFAULT_TARGET_LANGUAGE = 'ru';

/** Default system prompt sent to Gemini when user has not set a custom one. */
export const DEFAULT_SYSTEM_PROMPT =
  'You are a professional real-time translator. Translate the following text from {{source}} to {{target}}. Output ONLY the translated text without any other comments, quotes, or markdown formatting. Keep the translated text smooth and natural.';

/** How long (ms) an error toast stays visible before auto-dismissing. */
export const ERROR_TIMEOUT_MS = 5000;

/** Groq Whisper transcription REST endpoint (file-based, not streaming). */
export const GROQ_TRANSCRIPTION_URL =
  'https://api.groq.com/openai/v1/audio/transcriptions';

/** Groq Chat Completions REST endpoint (OpenAI-compatible). */
export const GROQ_CHAT_COMPLETIONS_URL =
  'https://api.groq.com/openai/v1/chat/completions';

// ---------------------------------------------------------------------------
// Translation model registry (multi-provider)
// ---------------------------------------------------------------------------

export type TranslationModelProvider = 'gemini' | 'groq';

export interface TranslationModel {
  id: string;
  provider: TranslationModelProvider;
  label: string;
  description: string;
}

/** Unified list of all available translation models across providers. */
export const TRANSLATION_MODELS: TranslationModel[] = [
  // --- Groq ---
  {
    id: 'groq:qwen/qwen3-32b',
    provider: 'groq',
    label: 'Groq: Qwen3 32B',
    description: 'Best multilingual quality, ~662 TPS'
  },
  {
    id: 'groq:llama-3.3-70b-versatile',
    provider: 'groq',
    label: 'Groq: Llama 3.3 70B Versatile',
    description: 'Highest quality, ~394 TPS'
  },
  {
    id: 'groq:llama-3.1-8b-instant',
    provider: 'groq',
    label: 'Groq: Llama 3.1 8B Instant',
    description: 'Lowest latency, ~840 TPS'
  },
  {
    id: 'groq:openai/gpt-oss-20b',
    provider: 'groq',
    label: 'Groq: GPT-OSS 20B',
    description: 'Balanced speed and quality'
  },
  // --- Gemini ---
  {
    id: 'gemini:gemini-2.5-flash',
    provider: 'gemini',
    label: 'Gemini 2.5 Flash',
    description: 'Fast and stable'
  },
  {
    id: 'gemini:gemini-2.5-flash-lite',
    provider: 'gemini',
    label: 'Gemini 2.5 Flash Lite',
    description: 'Lowest latency and cost'
  },
  {
    id: 'gemini:gemini-2.5-pro',
    provider: 'gemini',
    label: 'Gemini 2.5 Pro',
    description: 'Highest quality reasoning'
  },
  {
    id: 'gemini:gemini-3-flash-preview',
    provider: 'gemini',
    label: 'Gemini 3 Flash (Preview)',
    description: 'Next-gen fast model (preview)'
  },
  {
    id: 'gemini:gemini-3.1-pro-preview',
    provider: 'gemini',
    label: 'Gemini 3.1 Pro (Preview)',
    description: 'Next-gen flagship (preview)'
  }
];

/** Default translation model for new installations. */
export const DEFAULT_TRANSLATION_MODEL = 'groq:qwen/qwen3-32b';

/**
 * Parses a prefixed model ID into its provider and raw model name.
 * Unprefixed IDs (legacy) default to the Gemini provider.
 */
export function parseModelId(id: string): {
  provider: TranslationModelProvider;
  model: string;
} {
  const colonIndex = id.indexOf(':');
  if (colonIndex === -1) {
    return { provider: 'gemini', model: id };
  }
  const prefix = id.slice(0, colonIndex);
  const model = id.slice(colonIndex + 1);
  const provider: TranslationModelProvider =
    prefix === 'groq' ? 'groq' : 'gemini';
  return { provider, model };
}

// ---------------------------------------------------------------------------
// Gemini translation model (kept for migration compatibility)
// ---------------------------------------------------------------------------

/** @deprecated Use DEFAULT_TRANSLATION_MODEL. Kept for migration of existing settings. */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/** @deprecated Use TRANSLATION_MODELS. Kept for any remaining direct references. */
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
// Auto-shutdown on inactivity
// ---------------------------------------------------------------------------

/** Duration (ms) of no new segments before translation auto-stops. Default: 5 minutes. */
export const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Speaker diarization (local WeSpeaker ResNet34-LM embeddings)
// ---------------------------------------------------------------------------

/** Bundled int8 ONNX speaker-embedding model filename (in extension root). */
export const SPEAKER_MODEL_FILENAME = 'wespeaker_resnet34_lm_q8.onnx';

/** Maximum number of distinct speakers tracked within a session. */
export const MAX_SPEAKERS = 6;

/**
 * Cosine similarity threshold for assigning a chunk to an existing speaker.
 * Below this value a new speaker centroid is created (until MAX_SPEAKERS).
 */
export const SPEAKER_SIMILARITY_THRESHOLD = 0.4;

/**
 * Minimum audio duration (ms) required for a reliable speaker embedding.
 * Shorter chunks inherit the previously assigned speaker.
 */
export const MIN_EMBEDDING_AUDIO_MS = 1000;

/** Default label prefix for unnamed speakers (e.g. "Speaker 1"). */
export const DEFAULT_SPEAKER_LABEL_PREFIX = 'Speaker';

/** Whether speaker detection is enabled by default for new installations. */
export const DEFAULT_SPEAKER_DETECTION = true;

/** Maximum length of a user-provided speaker name. */
export const MAX_SPEAKER_NAME_LENGTH = 24;
