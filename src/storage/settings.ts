/**
 * Settings persistence helpers.
 *
 * Storage strategy:
 * All settings (including API keys) are stored in chrome.storage.local.
 * This ensures they are accessible from every extension context
 * (service worker, popup, offscreen document) and persist across
 * browser restarts and extension reloads.
 */

import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_TRANSLATION_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_WHISPER_MODEL,
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_TARGET_LANGUAGE,
  DEFAULT_SPEAKER_DETECTION
} from '../constants';
import type { StoredSettings } from '../types/settings';
import { debugLog, debugWarn } from '../utils/debug';

/** All settings fields stored in chrome.storage.local. */
const ALL_FIELDS: Array<keyof StoredSettings> = [
  'groqApiKey',
  'geminiApiKey',
  'systemPrompt',
  'whisperModel',
  'geminiModel',
  'translationModel',
  'sourceLanguage',
  'targetLanguage',
  'speakerDetection'
];

/**
 * Loads all settings from chrome.storage.local.
 */
export async function loadSettings(): Promise<StoredSettings> {
  debugLog('Settings', 'Loading settings from storage…');

  // Guard: chrome.storage may become undefined during extension context teardown
  // (e.g. service worker shutdown while async operations are still in-flight).
  if (!chrome?.storage?.local) {
    debugWarn(
      'Settings',
      'chrome.storage unavailable (context may be closing)'
    );
    return {
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      whisperModel: DEFAULT_WHISPER_MODEL,
      geminiModel: DEFAULT_GEMINI_MODEL,
      translationModel: DEFAULT_TRANSLATION_MODEL,
      speakerDetection: DEFAULT_SPEAKER_DETECTION
    };
  }

  const values = await chrome.storage.local.get(ALL_FIELDS);

  const groqApiKey =
    typeof values.groqApiKey === 'string' ? values.groqApiKey : undefined;

  const geminiApiKey =
    typeof values.geminiApiKey === 'string' ? values.geminiApiKey : undefined;

  const systemPrompt =
    typeof values.systemPrompt === 'string'
      ? values.systemPrompt
      : DEFAULT_SYSTEM_PROMPT;

  const whisperModel =
    typeof values.whisperModel === 'string'
      ? values.whisperModel
      : DEFAULT_WHISPER_MODEL;

  const geminiModel =
    typeof values.geminiModel === 'string' ? values.geminiModel : undefined;

  // Resolve translationModel with migration: if not set, migrate from legacy geminiModel.
  let translationModel: string;
  if (typeof values.translationModel === 'string' && values.translationModel) {
    translationModel = values.translationModel;
  } else if (geminiModel) {
    translationModel = `gemini:${geminiModel}`;
    debugLog(
      'Settings',
      `Migrated geminiModel → translationModel: ${translationModel}`
    );
  } else {
    translationModel = DEFAULT_TRANSLATION_MODEL;
  }

  if (!groqApiKey) debugWarn('Settings', 'Groq API key is missing');
  if (!geminiApiKey) debugWarn('Settings', 'Gemini API key is missing');
  debugLog('Settings', 'Settings loaded', {
    hasGroqKey: !!groqApiKey,
    hasGeminiKey: !!geminiApiKey,
    promptLength: systemPrompt.length,
    whisperModel,
    translationModel
  });

  const sourceLanguage =
    typeof values.sourceLanguage === 'string'
      ? values.sourceLanguage
      : DEFAULT_SOURCE_LANGUAGE;

  const targetLanguage =
    typeof values.targetLanguage === 'string'
      ? values.targetLanguage
      : DEFAULT_TARGET_LANGUAGE;

  const speakerDetection =
    typeof values.speakerDetection === 'boolean'
      ? values.speakerDetection
      : DEFAULT_SPEAKER_DETECTION;

  return {
    groqApiKey,
    geminiApiKey,
    systemPrompt,
    whisperModel,
    geminiModel,
    translationModel,
    sourceLanguage,
    targetLanguage,
    speakerDetection
  };
}

/**
 * Persists all settings to chrome.storage.local.
 */
export async function saveSettings(settings: StoredSettings) {
  debugLog('Settings', 'Saving settings…');

  if (!chrome?.storage?.local) {
    debugWarn('Settings', 'chrome.storage unavailable, cannot save');
    return;
  }

  await chrome.storage.local.set({
    groqApiKey: settings.groqApiKey || '',
    geminiApiKey: settings.geminiApiKey || '',
    systemPrompt: settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    whisperModel: settings.whisperModel || DEFAULT_WHISPER_MODEL,
    translationModel: settings.translationModel || DEFAULT_TRANSLATION_MODEL,
    sourceLanguage: settings.sourceLanguage || DEFAULT_SOURCE_LANGUAGE,
    targetLanguage: settings.targetLanguage || DEFAULT_TARGET_LANGUAGE,
    speakerDetection: settings.speakerDetection ?? DEFAULT_SPEAKER_DETECTION
  });

  debugLog('Settings', 'Settings saved successfully');
}
