/**
 * SettingsTab — Primary popup tab containing all user-configurable options.
 *
 * Renders the Start/Stop button, collapsible API key inputs, language
 * and model dropdowns, and the system prompt textarea. All changes are
 * propagated upward via callback props and auto-saved by `useSettings`.
 */

import {
  TRANSLATION_MODELS,
  WHISPER_MODELS,
  SOURCE_LANGUAGES,
  TARGET_LANGUAGES,
  ASR_PROVIDERS,
  LOCAL_WHISPER_MODELS,
  LOCAL_TRANSLATION_MODEL
} from '../../constants';
import type { LocalWhisperModelId } from '../../constants';
import type { HardwareCheckResult } from '../../utils/hardwareCheck';

interface SettingsTabProps {
  isActive: boolean;
  keysPresent: boolean;
  showKeys: boolean;
  groqKey: string;
  geminiKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  whisperModel: string;
  translationModel: string;
  prompt: string;
  speakerDetection: boolean;
  asrProvider: 'groq' | 'local';
  localWhisperModel: LocalWhisperModelId;
  localLlmModelCached: boolean;
  localLlmDownloadPercent: number | null;
  localLlmDownloadPhase: 'download' | 'warmup' | null;
  localLlmHardwareResult: HardwareCheckResult | null;
  localLlmDownloadError: string | null;
  onToggleTranslation: () => void;
  onShowKeysChange: (isVisible: boolean) => void;
  onGroqKeyChange: (value: string) => void;
  onGeminiKeyChange: (value: string) => void;
  onSourceLanguageChange: (value: string) => void;
  onTargetLanguageChange: (value: string) => void;
  onWhisperModelChange: (value: string) => void;
  onTranslationModelChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onSpeakerDetectionChange: (value: boolean) => void;
  onAsrProviderChange: (value: 'groq' | 'local') => void;
  onLocalWhisperModelChange: (value: LocalWhisperModelId) => void;
  onCheckHardware: () => void;
  onDownloadLocalModel: () => void;
}

function startButtonTitle(opts: {
  isActive: boolean;
  keysPresent: boolean;
  isDownloading: boolean;
  needsLocalLlm: boolean;
  localLlmModelCached: boolean;
}): string | undefined {
  if (opts.isActive) return undefined;
  if (opts.isDownloading) return 'Wait for the local model download to finish';
  if (opts.needsLocalLlm && !opts.localLlmModelCached) {
    return 'Download the local model first';
  }
  if (!opts.keysPresent) return 'Add required API keys first';
  return undefined;
}

export function SettingsTab({
  isActive,
  keysPresent,
  showKeys,
  groqKey,
  geminiKey,
  sourceLanguage,
  targetLanguage,
  whisperModel,
  translationModel,
  prompt,
  speakerDetection,
  asrProvider,
  localWhisperModel,
  localLlmModelCached,
  localLlmDownloadPercent,
  localLlmDownloadPhase,
  localLlmHardwareResult,
  localLlmDownloadError,
  onToggleTranslation,
  onShowKeysChange,
  onGroqKeyChange,
  onGeminiKeyChange,
  onSourceLanguageChange,
  onTargetLanguageChange,
  onWhisperModelChange,
  onTranslationModelChange,
  onPromptChange,
  onSpeakerDetectionChange,
  onAsrProviderChange,
  onLocalWhisperModelChange,
  onCheckHardware,
  onDownloadLocalModel
}: SettingsTabProps) {
  const isLocalLlm = translationModel.startsWith('local:');
  const isLocalAsr = asrProvider === 'local';
  const isDownloading = localLlmDownloadPercent !== null;
  const startDisabled =
    (!keysPresent && !isActive) || (isDownloading && !isActive);

  return (
    <>
      {/* Start / Stop — primary action at the top */}
      <button
        onClick={onToggleTranslation}
        disabled={startDisabled}
        title={startButtonTitle({
          isActive,
          keysPresent,
          isDownloading,
          needsLocalLlm: isLocalLlm,
          localLlmModelCached
        })}
        className={`w-full mb-1 py-2.5 px-4 rounded-lg font-bold text-white transition-colors flex items-center justify-center shadow shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
          isActive
            ? 'bg-red-500 hover:bg-red-600'
            : 'bg-green-500 hover:bg-green-600'
        }`}
      >
        {isActive ? 'Stop Translation' : 'Start Translation'}
      </button>
      <p className="text-[10px] text-gray-400 text-center mb-4 shrink-0">
        <kbd className="bg-gray-200 px-1 py-0.5 rounded text-gray-600 text-[10px]">
          Ctrl/Cmd+Shift+L
        </kbd>{' '}
        hotkey
      </p>

      {/* Settings block */}
      <div className="flex-1 space-y-3">
        {/* API Keys — collapsible */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => onShowKeysChange(!showKeys)}
            className="w-full flex items-center justify-between px-3 py-2 bg-gray-100 hover:bg-gray-150 text-sm font-semibold text-gray-700 cursor-pointer"
          >
            <span>API Keys</span>
            <span className="flex items-center gap-2">
              {keysPresent ? (
                <span className="text-green-500 text-xs">✓ set</span>
              ) : (
                <span className="text-red-400 text-xs">missing</span>
              )}
              <span className="text-gray-400 text-xs">
                {showKeys ? '▲' : '▼'}
              </span>
            </span>
          </button>
          {showKeys && (
            <div className="p-3 space-y-2 bg-white">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-0.5 block">
                  Groq API Key
                </label>
                <input
                  type="password"
                  placeholder="gsk_..."
                  className="w-full px-2.5 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={groqKey}
                  onChange={(e) => onGroqKeyChange(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-0.5 block">
                  Gemini API Key
                </label>
                <input
                  type="password"
                  placeholder="AIza..."
                  className="w-full px-2.5 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={geminiKey}
                  onChange={(e) => onGeminiKeyChange(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Languages — side by side */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-0.5 block">
              Audio Language
            </label>
            <select
              className="w-full px-2 py-1.5 border rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={sourceLanguage}
              onChange={(e) => onSourceLanguageChange(e.target.value)}
            >
              {SOURCE_LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-0.5 block">
              Translate To
            </label>
            <select
              className="w-full px-2 py-1.5 border rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={targetLanguage}
              onChange={(e) => onTargetLanguageChange(e.target.value)}
            >
              {TARGET_LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Translation model */}
        <div>
          <label className="text-xs font-medium text-gray-500 mb-0.5 block">
            Translation Model
          </label>
          <select
            className="w-full px-2 py-1.5 border rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            value={translationModel}
            onChange={(e) => onTranslationModelChange(e.target.value)}
            disabled={isActive || isDownloading}
          >
            <optgroup label="Groq">
              {TRANSLATION_MODELS.filter((m) => m.provider === 'groq').map(
                (m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                )
              )}
            </optgroup>
            <optgroup label="Gemini">
              {TRANSLATION_MODELS.filter((m) => m.provider === 'gemini').map(
                (m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                )
              )}
            </optgroup>
            <optgroup label="Local (offline)">
              {TRANSLATION_MODELS.filter((m) => m.provider === 'local').map(
                (m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                )
              )}
            </optgroup>
          </select>
        </div>

        {/* Local LLM panel — shown when the local model is selected */}
        {isLocalLlm && (
          <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold text-amber-800">
              Local {LOCAL_TRANSLATION_MODEL.label}
            </p>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600">
                {localLlmModelCached ? (
                  <span className="text-green-600 font-medium">
                    ✓ Model cached
                  </span>
                ) : (
                  <span className="text-gray-500">
                    Not downloaded ({LOCAL_TRANSLATION_MODEL.downloadSizeLabel})
                  </span>
                )}
              </span>
              <button
                onClick={onCheckHardware}
                disabled={isActive || isDownloading}
                className="text-[10px] px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              >
                Check GPU
              </button>
            </div>
            {localLlmHardwareResult && (
              <p
                className={`text-[10px] ${
                  localLlmHardwareResult.supported
                    ? 'text-green-700'
                    : 'text-red-600'
                }`}
              >
                {localLlmHardwareResult.supported
                  ? `GPU OK: ${localLlmHardwareResult.gpuName}`
                  : `GPU not supported: ${localLlmHardwareResult.reason ?? 'unknown'}`}
              </p>
            )}
            {localLlmDownloadError && (
              <p className="text-[10px] text-red-600">{localLlmDownloadError}</p>
            )}
            {!localLlmModelCached && (
              <button
                onClick={onDownloadLocalModel}
                disabled={isActive || isDownloading}
                className="w-full py-1.5 rounded text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {isDownloading
                  ? `${localLlmDownloadPhase === 'warmup' ? 'Warming up' : 'Downloading'} ${localLlmDownloadPercent ?? 0}%`
                  : 'Download Model'}
              </button>
            )}
            {isDownloading && (
              <div className="w-full bg-amber-200 rounded-full h-1.5">
                <div
                  className="bg-amber-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${localLlmDownloadPercent ?? 0}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* ASR provider selector */}
        <div>
          <label className="text-xs font-medium text-gray-500 mb-0.5 block">
            Speech-to-Text
          </label>
          <select
            className="w-full px-2 py-1.5 border rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            value={asrProvider}
            onChange={(e) =>
              onAsrProviderChange(e.target.value as 'groq' | 'local')
            }
            disabled={isActive}
          >
            {ASR_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.description}
              </option>
            ))}
          </select>
          {isLocalAsr && (
            <select
              className="mt-1 w-full px-2 py-1.5 border rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={localWhisperModel}
              onChange={(e) =>
                onLocalWhisperModelChange(
                  e.target.value as LocalWhisperModelId
                )
              }
              disabled={isActive}
            >
              {LOCAL_WHISPER_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.description}
                </option>
              ))}
            </select>
          )}
          {!isLocalAsr && (
            <select
              className="mt-1 w-full px-2 py-1.5 border rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={whisperModel}
              onChange={(e) => onWhisperModelChange(e.target.value)}
              disabled={isActive}
            >
              {WHISPER_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Speaker detection toggle */}
        <label className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 cursor-pointer">
          <span>
            <span className="text-xs font-medium text-gray-700 block">
              Speaker detection
            </span>
            <span className="text-[10px] text-gray-400 block">
              Tags segments per speaker. Applies on next session start.
            </span>
          </span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-green-500 cursor-pointer"
            checked={speakerDetection}
            onChange={(e) => onSpeakerDetectionChange(e.target.checked)}
          />
        </label>

        {/* System prompt */}
        <div>
          <label className="text-xs font-medium text-gray-500 mb-0.5 block">
            System Prompt
          </label>
          <textarea
            rows={3}
            placeholder="You are a real-time translator..."
            className="w-full px-2.5 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
          />
        </div>
      </div>

      <p className="text-[9px] text-gray-300 text-center mt-3 pt-2 border-t border-gray-100">
        Settings auto-save on change
      </p>
    </>
  );
}
