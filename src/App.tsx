import { useState, useEffect, useRef, useCallback } from 'react';
import './index.css';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_WHISPER_MODEL,
  GEMINI_MODELS,
  WHISPER_MODELS
} from './constants';
import { loadSettings, saveSettings } from './storage/settings';
import type {
  BackgroundRequestMessage,
  ContentScriptMessage
} from './types/messages';

function App() {
  const [isActive, setIsActive] = useState(false);
  const [groqKey, setGroqKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [prompt, setPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [whisperModel, setWhisperModel] = useState(DEFAULT_WHISPER_MODEL);
  const [geminiModel, setGeminiModel] = useState(DEFAULT_GEMINI_MODEL);
  const [statusText, setStatusText] = useState('');
  const [statusTone, setStatusTone] = useState<'success' | 'error'>('success');
  const [showKeys, setShowKeys] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(false);

  const keysPresent = !!(groqKey && geminiKey);

  const setTransientStatus = (text: string, tone: 'success' | 'error') => {
    setStatusTone(tone);
    setStatusText(text);
    setTimeout(() => setStatusText(''), 2500);
  };

  // Debounced auto-save: triggers 800ms after last change.
  const debouncedSave = useCallback(() => {
    if (!loaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveSettings({
        groqApiKey: groqKey,
        geminiApiKey: geminiKey,
        systemPrompt: prompt,
        whisperModel,
        geminiModel
      });
    }, 800);
  }, [groqKey, geminiKey, prompt, whisperModel, geminiModel]);

  useEffect(() => {
    debouncedSave();
  }, [debouncedSave]);

  // Load initial settings and status.
  useEffect(() => {
    void (async () => {
      const settings = await loadSettings();
      if (settings.groqApiKey) setGroqKey(settings.groqApiKey);
      if (settings.geminiApiKey) setGeminiKey(settings.geminiApiKey);
      if (settings.systemPrompt) setPrompt(settings.systemPrompt);
      if (settings.whisperModel) setWhisperModel(settings.whisperModel);
      if (settings.geminiModel) setGeminiModel(settings.geminiModel);
      loaded.current = true;
    })();

    const getStatusMessage: BackgroundRequestMessage = {
      target: 'background',
      type: 'GET_STATUS'
    };
    chrome.runtime.sendMessage(
      getStatusMessage,
      (res: { isTranslating?: boolean } | undefined) => {
        if (res && res.isTranslating !== undefined) {
          setIsActive(res.isTranslating);
        }
      }
    );

    const runtimeListener = (message: ContentScriptMessage) => {
      if (message.type === 'TRANSLATION_STATE') {
        setIsActive(message.isActive);
      }
      if (message.type === 'PIPELINE_ERROR') {
        setTransientStatus(message.message, 'error');
      }
    };

    chrome.runtime.onMessage.addListener(runtimeListener);
    return () => {
      chrome.runtime.onMessage.removeListener(runtimeListener);
    };
  }, []);

  const toggleTranslation = async () => {
    // Flush any pending auto-save immediately.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await saveSettings({
      groqApiKey: groqKey,
      geminiApiKey: geminiKey,
      systemPrompt: prompt,
      whisperModel,
      geminiModel
    });

    const nextState = !isActive;
    const message: BackgroundRequestMessage = {
      target: 'background',
      type: nextState ? 'START_FROM_POPUP' : 'STOP_FROM_POPUP'
    };

    chrome.runtime.sendMessage(
      message,
      (response: { status?: string; isTranslating?: boolean } | undefined) => {
        if (chrome.runtime.lastError) {
          setTransientStatus(
            'Error communicating with background. Please reload extension.',
            'error'
          );
          return;
        }
        if (!response || response.status === 'error') {
          setTransientStatus('Failed to change translation state.', 'error');
          return;
        }
        if (response.status === 'busy') {
          setTransientStatus(
            'Translation state is updating. Try again in a second.',
            'error'
          );
          return;
        }
        if (response.isTranslating !== undefined) {
          setIsActive(response.isTranslating);
        } else {
          setIsActive(nextState);
        }
      }
    );
  };

  return (
    <div className="flex flex-col h-full p-4 bg-gray-50 border border-gray-200 w-[350px] font-sans">
      {/* Header */}
      <div className="flex bg-linear-to-r from-blue-600 to-indigo-700 -m-4 mb-3 p-3 items-center justify-between shadow">
        <h1 className="text-lg font-bold text-white tracking-wide">
          Real-Time Translator
        </h1>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            isActive
              ? 'bg-green-400/20 text-green-200'
              : 'bg-white/10 text-white/60'
          }`}
        >
          {isActive ? 'ACTIVE' : 'OFF'}
        </span>
      </div>

      {/* Start / Stop — primary action at the top */}
      <button
        onClick={toggleTranslation}
        disabled={!keysPresent && !isActive}
        title={!keysPresent && !isActive ? 'Add API keys first' : undefined}
        className={`w-full py-2.5 px-4 rounded-lg font-bold text-white transition-colors flex items-center justify-center shadow cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
          isActive
            ? 'bg-red-500 hover:bg-red-600'
            : 'bg-green-500 hover:bg-green-600'
        }`}
      >
        {isActive ? 'Stop Translation' : 'Start Translation'}
      </button>
      <p className="text-[10px] text-gray-400 text-center mt-1 mb-3">
        <kbd className="bg-gray-200 px-1 py-0.5 rounded text-gray-600 text-[10px]">
          Ctrl/Cmd+Shift+L
        </kbd>{' '}
        hotkey
      </p>

      {/* Status toast */}
      {statusText && (
        <div
          className={`text-xs font-semibold text-center mb-2 px-2 py-1 rounded ${
            statusTone === 'error'
              ? 'bg-red-50 text-red-600'
              : 'bg-green-50 text-green-600'
          }`}
        >
          {statusText}
        </div>
      )}

      {/* Settings */}
      <div className="flex-1 space-y-3 overflow-y-auto">
        {/* API Keys — collapsible */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowKeys(!showKeys)}
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
                  onChange={(e) => setGroqKey(e.target.value)}
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
                  onChange={(e) => setGeminiKey(e.target.value)}
                />
              </div>
            </div>
          )}
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
              onChange={(e) => setWhisperModel(e.target.value)}
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
              Gemini
            </label>
            <select
              className="w-full px-2 py-1.5 border rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={geminiModel}
              onChange={(e) => setGeminiModel(e.target.value)}
            >
              {GEMINI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
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
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
      </div>

      <p className="text-[9px] text-gray-300 text-center mt-2">
        Settings auto-save on change
      </p>
    </div>
  );
}

export default App;
