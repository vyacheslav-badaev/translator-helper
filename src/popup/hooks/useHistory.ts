/**
 * useHistory — Session history management for the popup History tab.
 *
 * Fetches saved sessions from IndexedDB when the History tab becomes active
 * (or when translation stops). Provides actions to export, delete, and
 * resume past sessions.
 */

import { useState, useEffect, useCallback } from 'react';
import { debugLog } from '../../utils/debug';
import { getSessions, deleteSession } from '../../storage/db';
import type { SessionData } from '../../storage/db';
import type { BackgroundRequestMessage } from '../../types/messages';
import type { StoredSettings } from '../../types/settings';

/** Dependencies injected from the parent (App) component. */
interface UseHistoryParams {
  activeTab: 'settings' | 'history';
  isActive: boolean;
  setIsActive: (v: boolean) => void;
  setActiveTab: (v: 'settings' | 'history') => void;
  setSourceLanguage: (v: string) => void;
  setTargetLanguage: (v: string) => void;
  flushSettings: (overrides?: Partial<StoredSettings>) => Promise<void>;
  sourceLanguage: string;
  targetLanguage: string;
}

/** Public API returned by the hook. */
export interface UseHistoryReturn {
  sessions: SessionData[];
  exportTxt: (session: SessionData) => void;
  handleDeleteSession: (id: string) => Promise<void>;
  resumeSession: (session: SessionData) => Promise<void>;
}

export function useHistory({
  activeTab,
  isActive,
  setIsActive,
  setActiveTab,
  setSourceLanguage,
  setTargetLanguage,
  flushSettings,
  sourceLanguage,
  targetLanguage
}: UseHistoryParams): UseHistoryReturn {
  const [sessions, setSessions] = useState<SessionData[]>([]);

  /** Fetch all sessions from IndexedDB and update local state. */
  const loadHistory = useCallback(async () => {
    const data = await getSessions();
    debugLog('History', `Loaded ${data.length} sessions`);
    setSessions(data);
  }, []);

  useEffect(() => {
    if (activeTab === 'history') {
      void loadHistory();
    }
  }, [activeTab, loadHistory, isActive]);

  /** Generate a plain-text export of a session and trigger a browser download. */
  const exportTxt = useCallback((session: SessionData) => {
    debugLog('History', `Exporting session ${session.id}`);
    let content = `Session: ${session.title}\nDate: ${new Date(session.timestamp).toLocaleString()}\n\n`;
    session.segments.forEach((seg) => {
      content += `[${new Date(seg.timestamp).toLocaleTimeString()}]\n`;
      content += `Audio: ${seg.originalText}\n`;
      if (seg.translatedText) {
        content += `Translation: ${seg.translatedText}\n`;
      }
      content += `\n`;
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `translator_${session.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  /** Delete a session from IndexedDB and refresh the list. */
  const handleDeleteSession = useCallback(
    async (id: string) => {
      debugLog('History', `Deleting session ${id}`);
      await deleteSession(id);
      await loadHistory();
    },
    [loadHistory]
  );

  /**
   * Resume a previously saved session.
   * Stops any active translation, restores session languages,
   * persists settings, and sends START_FROM_POPUP with the saved segments.
   */
  const resumeSession = useCallback(
    async (session: SessionData) => {
      debugLog('History', `Resuming session ${session.id}`);
      if (isActive) {
        await new Promise((r) => {
          chrome.runtime.sendMessage(
            { target: 'background', type: 'STOP_FROM_POPUP' },
            r
          );
        });
        setIsActive(false);
      }

      const resumeSource = session.sourceLanguage || sourceLanguage;
      const resumeTarget = session.targetLanguage || targetLanguage;
      setSourceLanguage(resumeSource);
      setTargetLanguage(resumeTarget);

      await flushSettings({
        sourceLanguage: resumeSource,
        targetLanguage: resumeTarget
      });

      const message: BackgroundRequestMessage = {
        target: 'background',
        type: 'START_FROM_POPUP',
        resumeSegments: session.segments
      };
      chrome.runtime.sendMessage(
        message,
        (res: { status?: string; isTranslating?: boolean } | undefined) => {
          if (res?.isTranslating !== undefined) setIsActive(res.isTranslating);
          setActiveTab('settings');
        }
      );
    },
    [
      isActive,
      setIsActive,
      sourceLanguage,
      targetLanguage,
      setSourceLanguage,
      setTargetLanguage,
      flushSettings,
      setActiveTab
    ]
  );

  return {
    sessions,
    exportTxt,
    handleDeleteSession,
    resumeSession
  };
}
