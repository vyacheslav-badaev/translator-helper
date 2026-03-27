/**
 * useTranslation — Manages the active/inactive translation state for the popup.
 *
 * On mount, queries the background service worker for the current status and
 * subscribes to `TRANSLATION_STATE` and `PIPELINE_ERROR` runtime messages.
 * Exposes `toggleTranslation()` which flushes settings then sends
 * START/STOP to background.
 */

import { useState, useEffect, useCallback } from 'react';
import { debugLog, debugWarn } from '../../utils/debug';
import type {
  BackgroundRequestMessage,
  ContentScriptMessage
} from '../../types/messages';

/** Dependencies injected from the parent (App) component. */
interface UseTranslationParams {
  /** Immediately persist settings before toggling translation. */
  flushSettings: () => Promise<void>;
}

/** Public API returned by the hook. */
export interface UseTranslationReturn {
  isActive: boolean;
  setIsActive: (v: boolean) => void;
  statusText: string;
  statusTone: 'success' | 'error';
  toggleTranslation: () => Promise<void>;
}

export function useTranslation({
  flushSettings
}: UseTranslationParams): UseTranslationReturn {
  const [isActive, setIsActive] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [statusTone, setStatusTone] = useState<'success' | 'error'>('success');

  const setTransientStatus = useCallback(
    (text: string, tone: 'success' | 'error') => {
      setStatusTone(tone);
      setStatusText(text);
      setTimeout(() => setStatusText(''), 2500);
    },
    []
  );

  // Load initial status and listen for runtime messages.
  useEffect(() => {
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
        debugLog('Popup', `Translation state changed: ${message.isActive}`);
        setIsActive(message.isActive);
      }
      if (message.type === 'PIPELINE_ERROR') {
        debugWarn('Popup', `Pipeline error: ${message.message}`);
        setTransientStatus(message.message, 'error');
      }
    };

    chrome.runtime.onMessage.addListener(runtimeListener);
    return () => {
      chrome.runtime.onMessage.removeListener(runtimeListener);
    };
  }, [setTransientStatus]);

  /** Toggle translation on/off. Flushes settings first, then sends message to background. */
  const toggleTranslation = useCallback(async () => {
    debugLog('Popup', `Toggling translation: ${isActive} -> ${!isActive}`);
    await flushSettings();

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
  }, [flushSettings, isActive, setTransientStatus]);

  return {
    isActive,
    setIsActive,
    statusText,
    statusTone,
    toggleTranslation
  };
}
