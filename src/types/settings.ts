/**
 * Shape of extension settings persisted in chrome.storage.local.
 * All fields are stored in local storage for cross-context access
 * (service worker, popup, offscreen document) and persistence across restarts.
 */
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
};
