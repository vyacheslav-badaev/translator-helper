/**
 * App — Root component of the Chrome extension popup.
 *
 * Thin orchestrator that wires together three custom hooks
 * (`useSettings`, `useTranslation`, `useHistory`) and renders
 * the popup UI via presentational components (`PopupHeader`,
 * `StatusToast`, `SettingsTab`, `HistoryTab`).
 */

import { useState } from 'react';
import './index.css';
import { useSettings } from './popup/hooks/useSettings';
import { useTranslation } from './popup/hooks/useTranslation';
import { useHistory } from './popup/hooks/useHistory';
import { PopupHeader } from './popup/components/PopupHeader';
import { StatusToast } from './popup/components/StatusToast';
import { SettingsTab } from './popup/components/SettingsTab';
import { HistoryTab } from './popup/components/HistoryTab';

function App() {
  const [activeTab, setActiveTab] = useState<'settings' | 'history'>(
    'settings'
  );

  const settings = useSettings();
  const translation = useTranslation({ flushSettings: settings.flushSettings });
  const history = useHistory({
    activeTab,
    isActive: translation.isActive,
    setIsActive: translation.setIsActive,
    setActiveTab,
    setSourceLanguage: settings.setSourceLanguage,
    setTargetLanguage: settings.setTargetLanguage,
    flushSettings: settings.flushSettings,
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage
  });

  return (
    <div className="flex flex-col h-full bg-gray-50 border border-gray-200 w-[350px] font-sans">
      <PopupHeader
        isActive={translation.isActive}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <div className="flex-1 overflow-y-auto p-4 flex flex-col relative">
        <StatusToast
          text={translation.statusText}
          tone={translation.statusTone}
        />

        {activeTab === 'settings' ? (
          <SettingsTab
            isActive={translation.isActive}
            keysPresent={settings.keysPresent}
            showKeys={settings.showKeys}
            groqKey={settings.groqKey}
            geminiKey={settings.geminiKey}
            sourceLanguage={settings.sourceLanguage}
            targetLanguage={settings.targetLanguage}
            whisperModel={settings.whisperModel}
            translationModel={settings.translationModel}
            prompt={settings.prompt}
            speakerDetection={settings.speakerDetection}
            asrProvider={settings.asrProvider}
            localWhisperModel={settings.localWhisperModel}
            localLlmModelCached={settings.localLlmModelCached}
            localLlmDownloadPercent={settings.localLlmDownloadPercent}
            localLlmDownloadPhase={settings.localLlmDownloadPhase}
            localLlmHardwareResult={settings.localLlmHardwareResult}
            localLlmDownloadError={settings.localLlmDownloadError}
            onToggleTranslation={translation.toggleTranslation}
            onShowKeysChange={settings.setShowKeys}
            onGroqKeyChange={settings.setGroqKey}
            onGeminiKeyChange={settings.setGeminiKey}
            onSourceLanguageChange={settings.setSourceLanguage}
            onTargetLanguageChange={settings.setTargetLanguage}
            onWhisperModelChange={settings.setWhisperModel}
            onTranslationModelChange={settings.setTranslationModel}
            onPromptChange={settings.setPrompt}
            onSpeakerDetectionChange={settings.setSpeakerDetection}
            onAsrProviderChange={settings.setAsrProvider}
            onLocalWhisperModelChange={settings.setLocalWhisperModel}
            onCheckHardware={() => {
              void chrome.runtime.sendMessage({
                target: 'background',
                type: 'LOCAL_LLM_CHECK_HARDWARE'
              });
            }}
            onDownloadLocalModel={() => {
              void chrome.runtime.sendMessage({
                target: 'background',
                type: 'LOCAL_LLM_DOWNLOAD'
              });
            }}
          />
        ) : (
          <HistoryTab
            sessions={history.sessions}
            onExport={history.exportTxt}
            onResume={history.resumeSession}
            onDelete={history.handleDeleteSession}
          />
        )}
      </div>
    </div>
  );
}

export default App;
