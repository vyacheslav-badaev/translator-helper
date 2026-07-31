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
  DEFAULT_TRANSLATION_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_WHISPER_MODEL,
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_TARGET_LANGUAGE,
  DEFAULT_SPEAKER_DETECTION,
  DEFAULT_ASR_PROVIDER,
  DEFAULT_LOCAL_WHISPER_MODEL
} from '../../constants';
import type { LocalWhisperModelId } from '../../constants';
import { loadSettings, saveSettings } from '../../storage/settings';
import type { StoredSettings } from '../../types/settings';
import type { HardwareCheckResult } from '../../utils/hardwareCheck';

/** Read-only snapshot of every settings field. */
export interface SettingsState {
  groqKey: string;
  geminiKey: string;
  prompt: string;
  whisperModel: string;
  translationModel: string;
  sourceLanguage: string;
  targetLanguage: string;
  speakerDetection: boolean;
  showKeys: boolean;
  asrProvider: 'groq' | 'local';
  localWhisperModel: LocalWhisperModelId;
  localLlmModelCached: boolean;
  localLlmDownloadPercent: number | null;
  localLlmDownloadPhase: 'download' | 'warmup' | null;
  localLlmHardwareResult: HardwareCheckResult | null;
  localLlmDownloadError: string | null;
}

/** Setters and imperative actions exposed by the hook. */
export interface SettingsActions {
  setGroqKey: (value: string) => void;
  setGeminiKey: (value: string) => void;
  setPrompt: (value: string) => void;
  setWhisperModel: (value: string) => void;
  setTranslationModel: (value: string) => void;
  setSourceLanguage: (value: string) => void;
  setTargetLanguage: (value: string) => void;
  setSpeakerDetection: (value: boolean) => void;
  setShowKeys: (isVisible: boolean) => void;
  setAsrProvider: (value: 'groq' | 'local') => void;
  setLocalWhisperModel: (value: LocalWhisperModelId) => void;
  flushSettings: () => Promise<void>;
}

/** Combined return type: state + actions + derived flags. */
export interface UseSettingsReturn extends SettingsState, SettingsActions {
  /** True when keys/models required for the selected providers are present. */
  keysPresent: boolean;
}

export function useSettings(): UseSettingsReturn {
  const [groqKey, setGroqKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [prompt, setPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [whisperModel, setWhisperModel] = useState(DEFAULT_WHISPER_MODEL);
  const [translationModel, setTranslationModel] = useState(
    DEFAULT_TRANSLATION_MODEL
  );
  const [sourceLanguage, setSourceLanguage] = useState(DEFAULT_SOURCE_LANGUAGE);
  const [targetLanguage, setTargetLanguage] = useState(DEFAULT_TARGET_LANGUAGE);
  const [speakerDetection, setSpeakerDetection] = useState(
    DEFAULT_SPEAKER_DETECTION
  );
  const [showKeys, setShowKeys] = useState(false);
  const [asrProvider, setAsrProvider] = useState<'groq' | 'local'>(
    DEFAULT_ASR_PROVIDER
  );
  const [localWhisperModel, setLocalWhisperModel] = useState<LocalWhisperModelId>(
    DEFAULT_LOCAL_WHISPER_MODEL
  );
  const [localLlmModelCached, setLocalLlmModelCached] = useState(false);
  const [localLlmDownloadPercent, setLocalLlmDownloadPercent] = useState<
    number | null
  >(null);
  const [localLlmDownloadPhase, setLocalLlmDownloadPhase] = useState<
    'download' | 'warmup' | null
  >(null);
  const [localLlmHardwareResult, setLocalLlmHardwareResult] =
    useState<HardwareCheckResult | null>(null);
  const [localLlmDownloadError, setLocalLlmDownloadError] = useState<
    string | null
  >(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(false);

  const needsGroqKey =
    asrProvider === 'groq' || translationModel.startsWith('groq:');
  const needsGeminiKey = translationModel.startsWith('gemini:');
  const needsLocalLlm = translationModel.startsWith('local:');
  const keysPresent = !!(
    (!needsGroqKey || groqKey) &&
    (!needsGeminiKey || geminiKey) &&
    (!needsLocalLlm || localLlmModelCached)
  );

  /** Build a StoredSettings object from current state, with optional overrides. */
  const buildSettingsObject = useCallback(
    (overrides?: Partial<StoredSettings>): StoredSettings => ({
      groqApiKey: groqKey,
      geminiApiKey: geminiKey,
      systemPrompt: prompt,
      whisperModel,
      translationModel,
      sourceLanguage,
      targetLanguage,
      speakerDetection,
      asrProvider,
      localWhisperModel,
      localLlmModelCached,
      ...overrides
    }),
    [
      groqKey,
      geminiKey,
      prompt,
      whisperModel,
      translationModel,
      sourceLanguage,
      targetLanguage,
      speakerDetection,
      asrProvider,
      localWhisperModel,
      localLlmModelCached
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
      if (settings.translationModel)
        setTranslationModel(settings.translationModel);
      if (settings.sourceLanguage) setSourceLanguage(settings.sourceLanguage);
      if (settings.targetLanguage) setTargetLanguage(settings.targetLanguage);
      if (typeof settings.speakerDetection === 'boolean')
        setSpeakerDetection(settings.speakerDetection);
      if (settings.asrProvider) setAsrProvider(settings.asrProvider);
      if (settings.localWhisperModel)
        setLocalWhisperModel(settings.localWhisperModel);
      if (typeof settings.localLlmModelCached === 'boolean')
        setLocalLlmModelCached(settings.localLlmModelCached);
      loaded.current = true;
    })();

    const runtimeListener = (message: {
      type: string;
      percent?: number;
      phase?: 'download' | 'warmup';
      message?: string;
      result?: HardwareCheckResult;
    }) => {
      if (message.type === 'LOCAL_LLM_PROGRESS') {
        setLocalLlmDownloadError(null);
        setLocalLlmDownloadPercent(message.percent ?? null);
        setLocalLlmDownloadPhase(message.phase ?? null);
      } else if (message.type === 'LOCAL_LLM_READY') {
        setLocalLlmModelCached(true);
        setLocalLlmDownloadPercent(null);
        setLocalLlmDownloadPhase(null);
        setLocalLlmDownloadError(null);
      } else if (message.type === 'LOCAL_LLM_DOWNLOAD_FAILED') {
        setLocalLlmDownloadPercent(null);
        setLocalLlmDownloadPhase(null);
        setLocalLlmDownloadError(message.message ?? 'Download failed');
      } else if (message.type === 'LOCAL_LLM_HARDWARE_RESULT' && message.result) {
        setLocalLlmHardwareResult(message.result);
      }
    };
    chrome.runtime.onMessage.addListener(runtimeListener);
    return () => chrome.runtime.onMessage.removeListener(runtimeListener);
  }, []);

  return {
    groqKey,
    geminiKey,
    prompt,
    whisperModel,
    translationModel,
    sourceLanguage,
    targetLanguage,
    speakerDetection,
    showKeys,
    keysPresent,
    asrProvider,
    localWhisperModel,
    localLlmModelCached,
    localLlmDownloadPercent,
    localLlmDownloadPhase,
    localLlmHardwareResult,
    localLlmDownloadError,
    setGroqKey,
    setGeminiKey,
    setPrompt,
    setWhisperModel,
    setTranslationModel,
    setSourceLanguage,
    setTargetLanguage,
    setSpeakerDetection,
    setShowKeys,
    setAsrProvider,
    setLocalWhisperModel,
    flushSettings
  };
}
