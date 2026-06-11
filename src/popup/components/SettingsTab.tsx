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
  TARGET_LANGUAGES
} from '../../constants';

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
  onToggleTranslation: () => void;
  onShowKeysChange: (v: boolean) => void;
  onGroqKeyChange: (v: string) => void;
  onGeminiKeyChange: (v: string) => void;
  onSourceLanguageChange: (v: string) => void;
  onTargetLanguageChange: (v: string) => void;
  onWhisperModelChange: (v: string) => void;
  onTranslationModelChange: (v: string) => void;
  onPromptChange: (v: string) => void;
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
  onToggleTranslation,
  onShowKeysChange,
  onGroqKeyChange,
  onGeminiKeyChange,
  onSourceLanguageChange,
  onTargetLanguageChange,
  onWhisperModelChange,
  onTranslationModelChange,
  onPromptChange
}: SettingsTabProps) {
  return (
    <>
      {/* Start / Stop — primary action at the top */}
      <button
        onClick={onToggleTranslation}
        disabled={!keysPresent && !isActive}
        title={!keysPresent && !isActive ? 'Add API keys first' : undefined}
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

        {/* Models — side by side */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-0.5 block">
              Whisper
            </label>
            <select
              className="w-full px-2 py-1.5 border rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={whisperModel}
              onChange={(e) => onWhisperModelChange(e.target.value)}
            >
              {WHISPER_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-0.5 block">
              Translation Model
            </label>
            <select
              className="w-full px-2 py-1.5 border rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={translationModel}
              onChange={(e) => onTranslationModelChange(e.target.value)}
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
            </select>
          </div>
        </div>

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
