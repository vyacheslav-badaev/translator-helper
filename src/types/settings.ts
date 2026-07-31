/**
 * Shape of extension settings persisted in chrome.storage.local.
 * All fields are stored in local storage for cross-context access
 * (service worker, popup, offscreen document) and persistence across restarts.
 */
import type { LocalWhisperModelId } from '../constants';

export type StoredSettings = {
  groqApiKey?: string;
  geminiApiKey?: string;
  systemPrompt?: string;
  whisperModel?: string;
  /** @deprecated Use translationModel. Kept for reading legacy stored values during migration. */
  geminiModel?: string;
  translationModel?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  /** Enables local speaker diarization (embedding model in offscreen). */
  speakerDetection?: boolean;
  /** True when the local translation model files have been downloaded and cached. */
  localLlmModelCached?: boolean;
  /** Speech-to-text provider: cloud Groq Whisper or local browser Whisper. */
  asrProvider?: 'groq' | 'local';
  /** Local Whisper model variant to use when asrProvider is 'local'. */
  localWhisperModel?: LocalWhisperModelId;
};
