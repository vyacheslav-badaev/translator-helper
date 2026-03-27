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
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_WHISPER_MODEL
} from '../constants';
import type { StoredSettings } from '../types/settings';
import { debugLog, debugWarn } from '../utils/debug';

/** All settings fields stored in chrome.storage.local. */
const ALL_FIELDS: Array<keyof StoredSettings> = [
  'groqApiKey',
  'geminiApiKey',
  'systemPrompt',
  'whisperModel',
  'geminiModel'
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
      geminiModel: DEFAULT_GEMINI_MODEL
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
    typeof values.geminiModel === 'string'
      ? values.geminiModel
      : DEFAULT_GEMINI_MODEL;

  if (!groqApiKey) debugWarn('Settings', 'Groq API key is missing');
  if (!geminiApiKey) debugWarn('Settings', 'Gemini API key is missing');
  debugLog('Settings', 'Settings loaded', {
    hasGroqKey: !!groqApiKey,
    hasGeminiKey: !!geminiApiKey,
    promptLength: systemPrompt.length,
    whisperModel,
    geminiModel
  });

  return { groqApiKey, geminiApiKey, systemPrompt, whisperModel, geminiModel };
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
    geminiModel: settings.geminiModel || DEFAULT_GEMINI_MODEL
  });

  debugLog('Settings', 'Settings saved successfully');
}
