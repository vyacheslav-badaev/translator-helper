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

/**
 * System prompt for the local model, deliberately separate from the
 * user-editable one above. The cloud wording is long and leaves room for
 * interpretation, which makes a sub-1B model emit commentary instead of a bare
 * translation, so this variant is short and strictly imperative.
 */
export const LOCAL_SYSTEM_PROMPT =
  'You are a translation engine. Translate the user message from {{source}} into {{target}}. Reply with the translation and nothing else: no explanations, no notes, no labels, no quotes, and never repeat the original text.';

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

export type TranslationModelProvider = 'gemini' | 'groq' | 'local';

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
  },
  // --- Local ---
  {
    id: 'local:qwen3-0.6b',
    provider: 'local',
    label: 'Local: Qwen3 0.6B',
    description: 'Offline · no API key · ~570 MB · requires WebGPU'
  }
];

/**
 * The only local translation model, referenced by the offscreen runtime and UI.
 *
 * Replacements must keep the ONNX weights either below ~1 GB in a single file
 * or split into external `.onnx_data` shards. Larger single-file protobufs are
 * parsed entirely inside the 32-bit ONNX Runtime WASM heap, which aborts with
 * `std::bad_alloc` while creating the inference session.
 */
export const LOCAL_TRANSLATION_MODEL = {
  /** Registry ID used in settings and `parseModelId`. */
  id: 'local:qwen3-0.6b',
  /** Hugging Face repository providing the ONNX weights. */
  repoId: 'onnx-community/Qwen3-0.6B-ONNX',
  label: 'Qwen3 0.6B',
  downloadSizeLabel: '~570 MB'
} as const;

/**
 * Local model IDs from earlier releases, mapped to the current one. Their
 * cached weights are unusable, so migration also resets the cache flag.
 */
export const LEGACY_LOCAL_MODEL_IDS = [
  'local:gemma-4-e2b',
  'local:qwen3-1.7b'
] as const;

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
  let provider: TranslationModelProvider = 'gemini';
  if (prefix === 'groq') provider = 'groq';
  else if (prefix === 'local') provider = 'local';
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
// Local Whisper (browser-side ASR)
// ---------------------------------------------------------------------------

/** Default ASR provider for new installations. */
export const DEFAULT_ASR_PROVIDER = 'groq' as const;

/** Available ASR provider options shown in Settings. */
export const ASR_PROVIDERS = [
  { id: 'groq', label: 'Groq (cloud)', description: 'Fast, requires API key' },
  {
    id: 'local',
    label: 'Local Whisper',
    description: 'Free, runs in browser · no API key'
  }
] as const;

/**
 * Available local Whisper variants. IDs must point at repositories that ship
 * ONNX exports; the upstream `openai/*` repositories hold PyTorch weights only.
 */
export const LOCAL_WHISPER_MODELS = [
  {
    id: 'onnx-community/whisper-tiny',
    label: 'Whisper Tiny',
    description: '~97 MB · fastest · lower accuracy'
  },
  {
    id: 'onnx-community/whisper-base',
    label: 'Whisper Base',
    description: '~147 MB · good balance of speed and accuracy'
  }
] as const;

/** Hugging Face repository ID of a local Whisper variant. */
export type LocalWhisperModelId = (typeof LOCAL_WHISPER_MODELS)[number]['id'];

/** Default local Whisper model when asrProvider is 'local'. */
export const DEFAULT_LOCAL_WHISPER_MODEL: LocalWhisperModelId =
  'onnx-community/whisper-base';

/** Whisper repository IDs from earlier releases, mapped to their ONNX mirror. */
const LEGACY_LOCAL_WHISPER_MODEL_IDS: Record<string, LocalWhisperModelId> = {
  'openai/whisper-tiny': 'onnx-community/whisper-tiny',
  'openai/whisper-base': 'onnx-community/whisper-base'
};

/** Normalizes a persisted Whisper model ID, migrating retired repositories. */
export function resolveLocalWhisperModel(value: unknown): LocalWhisperModelId {
  if (typeof value !== 'string') return DEFAULT_LOCAL_WHISPER_MODEL;
  const migrated = LEGACY_LOCAL_WHISPER_MODEL_IDS[value];
  if (migrated) return migrated;
  const known = LOCAL_WHISPER_MODELS.find((model) => model.id === value);
  return known ? known.id : DEFAULT_LOCAL_WHISPER_MODEL;
}

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
