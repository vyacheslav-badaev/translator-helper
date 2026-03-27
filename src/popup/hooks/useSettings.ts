/**
 * useSettings — Manages all popup settings state.
 *
 * Loads persisted values from `chrome.storage.local` on mount, exposes
 * individual setters for each field, and auto-saves changes after an
 * 800 ms debounce. Call `flushSettings()` to persist immediately
 * (e.g. before starting translation).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { debugLog } from '../../utils/debug';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_WHISPER_MODEL,
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_TARGET_LANGUAGE
} from '../../constants';
import { loadSettings, saveSettings } from '../../storage/settings';
import type { StoredSettings } from '../../types/settings';

/** Read-only snapshot of every settings field. */
export interface SettingsState {
  groqKey: string;
  geminiKey: string;
  prompt: string;
  whisperModel: string;
  geminiModel: string;
  sourceLanguage: string;
  targetLanguage: string;
  showKeys: boolean;
}

/** Setters and imperative actions exposed by the hook. */
export interface SettingsActions {
  setGroqKey: (v: string) => void;
  setGeminiKey: (v: string) => void;
  setPrompt: (v: string) => void;
  setWhisperModel: (v: string) => void;
  setGeminiModel: (v: string) => void;
  setSourceLanguage: (v: string) => void;
  setTargetLanguage: (v: string) => void;
  setShowKeys: (v: boolean) => void;
  flushSettings: () => Promise<void>;
}

/** Combined return type: state + actions + derived flags. */
export interface UseSettingsReturn extends SettingsState, SettingsActions {
  /** True when both Groq and Gemini API keys are non-empty. */
  keysPresent: boolean;
}

export function useSettings(): UseSettingsReturn {
  const [groqKey, setGroqKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [prompt, setPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [whisperModel, setWhisperModel] = useState(DEFAULT_WHISPER_MODEL);
  const [geminiModel, setGeminiModel] = useState(DEFAULT_GEMINI_MODEL);
  const [sourceLanguage, setSourceLanguage] = useState(DEFAULT_SOURCE_LANGUAGE);
  const [targetLanguage, setTargetLanguage] = useState(DEFAULT_TARGET_LANGUAGE);
  const [showKeys, setShowKeys] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(false);

  const keysPresent = !!(groqKey && geminiKey);

  /** Build a StoredSettings object from current state, with optional overrides. */
  const buildSettingsObject = useCallback(
    (overrides?: Partial<StoredSettings>): StoredSettings => ({
      groqApiKey: groqKey,
      geminiApiKey: geminiKey,
      systemPrompt: prompt,
      whisperModel,
      geminiModel,
      sourceLanguage,
      targetLanguage,
      ...overrides
    }),
    [
      groqKey,
      geminiKey,
      prompt,
      whisperModel,
      geminiModel,
      sourceLanguage,
      targetLanguage
    ]
  );

  /**
   * Immediately persist current settings to chrome.storage.local.
   * Cancels any pending debounced save. Accepts optional field overrides
   * that are merged before writing (useful for resumeSession).
   */
  const flushSettings = useCallback(
    async (overrides?: Partial<StoredSettings>) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      debugLog('Settings', 'Flushing settings to storage');
      await saveSettings(buildSettingsObject(overrides));
    },
    [buildSettingsObject]
  );

  // Debounced auto-save: triggers 800ms after last change.
  const debouncedSave = useCallback(() => {
    if (!loaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveSettings(buildSettingsObject());
    }, 800);
  }, [buildSettingsObject]);

  useEffect(() => {
    debouncedSave();
  }, [debouncedSave]);

  // Load initial settings on mount.
  useEffect(() => {
    void (async () => {
      const settings = await loadSettings();
      debugLog('Settings', 'Loaded initial settings', settings);
      if (settings.groqApiKey) setGroqKey(settings.groqApiKey);
      if (settings.geminiApiKey) setGeminiKey(settings.geminiApiKey);
      if (settings.systemPrompt) setPrompt(settings.systemPrompt);
      if (settings.whisperModel) setWhisperModel(settings.whisperModel);
      if (settings.geminiModel) setGeminiModel(settings.geminiModel);
      if (settings.sourceLanguage) setSourceLanguage(settings.sourceLanguage);
      if (settings.targetLanguage) setTargetLanguage(settings.targetLanguage);
      loaded.current = true;
    })();
  }, []);

  return {
    groqKey,
    geminiKey,
    prompt,
    whisperModel,
    geminiModel,
    sourceLanguage,
    targetLanguage,
    showKeys,
    keysPresent,
    setGroqKey,
    setGeminiKey,
    setPrompt,
    setWhisperModel,
    setGeminiModel,
    setSourceLanguage,
    setTargetLanguage,
    setShowKeys,
    flushSettings
  };
}
