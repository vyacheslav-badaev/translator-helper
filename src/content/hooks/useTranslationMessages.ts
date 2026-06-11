/**
 * useTranslationMessages — React hook for maintaining the real-time translation state.
 *
 * It acts as the primary bridge between the background service worker and the UI:
 * 1. Subscribes to runtime messages (transcriptions, translations, analytics).
 * 2. Manages segment history with a memory cap (MAX_SEGMENTS).
 * 3. Tracks VAD (speech) status and dynamic language selection.
 * 4. Handles automated cleanup when the translation pipeline stops.
 *
 * @returns {UseTranslationMessagesReturn} State and handlers for the TranslationPanel.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { debugLog, debugWarn } from '../../utils/debug';
import { ERROR_TIMEOUT_MS } from '../../constants';
import type {
  BackgroundRequestMessage,
  ContentScriptMessage
} from '../../types/messages';
import type { TranscriptSegment } from '../../types/segment';

/** Limit for the number of segments stored in the UI to prevent DOM performance degradation. */
const MAX_SEGMENTS = 100;

/** State object returned by the hook. */
export interface UseTranslationMessagesReturn {
  segments: TranscriptSegment[];
  toggleMap: Record<number, boolean>; // Maps segment ID to whether translated or original text is shown
  speakerNames: Record<number, string>; // User-assigned names per speaker ID (session-scoped)
  isActive: boolean; // Whether the background pipeline is currently running
  isSpeaking: boolean; // Real-time VAD status from the offscreen document
  errorMessage: string; // Transient error for the toast notification
  sourceLang: string;
  targetLang: string;
  analytics: {
    queueLength: number;
    chunksProcessed: number;
    avgTranscribeMs: number;
    avgTranslateMs: number;
  };
  handleToggle: (id: number) => void;
  handleToggleAll: () => void;
  handleClearHistory: () => void;
  handleRenameSpeaker: (speakerId: number, name: string) => void;
}

export function useTranslationMessages(): UseTranslationMessagesReturn {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [toggleMap, setToggleMap] = useState<Record<number, boolean>>({});
  const [speakerNames, setSpeakerNames] = useState<Record<number, string>>({});
  const [isActive, setIsActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [sourceLang, setSourceLang] = useState('EN');
  const [targetLang, setTargetLang] = useState('RU');
  const [analytics, setAnalytics] = useState({
    queueLength: 0,
    chunksProcessed: 0,
    avgTranscribeMs: 0,
    avgTranslateMs: 0
  });

  const errorTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Resets the UI state for the current session.
   */
  const handleClearHistory = useCallback(() => {
    debugLog('Panel', 'Clearing segment history');
    setSegments([]);
    setToggleMap({});
  }, []);

  /**
   * Swaps a specific segment's display mode.
   */
  const handleToggle = useCallback((id: number) => {
    setToggleMap((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  /**
   * Sends a speaker rename request to the background, which broadcasts
   * the updated name map back to all tabs.
   */
  const handleRenameSpeaker = useCallback((speakerId: number, name: string) => {
    const msg: BackgroundRequestMessage = {
      target: 'background',
      type: 'RENAME_SPEAKER',
      speakerId,
      name
    };
    chrome.runtime.sendMessage(msg).catch(() => undefined);
  }, []);

  /**
   * Mass-toggles all visible segments to original or translated text.
   */
  const handleToggleAll = useCallback(() => {
    setToggleMap((prev) => {
      const anyShowing = Object.values(prev).some(Boolean);
      const newValue = !anyShowing;
      const next: Record<number, boolean> = {};
      for (const key of Object.keys(prev)) {
        next[Number(key)] = newValue;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    // 1. Initial State Sync: Query the background for current translation status on mount.
    const getStatusMessage: BackgroundRequestMessage = {
      target: 'background',
      type: 'GET_STATUS'
    };
    chrome.runtime.sendMessage(
      getStatusMessage,
      (res: { isTranslating?: boolean } | undefined) => {
        if (res?.isTranslating !== undefined) setIsActive(res.isTranslating);
      }
    );

    // 2. Message Listener: Reactive updates from the transcription pipeline.
    const listener = (msg: ContentScriptMessage) => {
      if (msg.type === 'NEW_SEGMENT') {
        // Appending a new sentence fragment as it leaves the SentenceBuffer.
        debugLog('Panel', `New segment #${msg.segment.id}`);
        setSegments((prev) => {
          const next = [...prev, msg.segment];
          return next.length > MAX_SEGMENTS ? next.slice(-MAX_SEGMENTS) : next;
        });

        setToggleMap((prev) => {
          const updated = { ...prev, [msg.segment.id]: false };
          const keys = Object.keys(updated);
          // Automatic cleanup of the toggle map to maintain memory parity.
          if (keys.length > MAX_SEGMENTS + 20) {
            const trimmed: Record<number, boolean> = {};
            const keptKeys = keys.slice(-MAX_SEGMENTS);
            for (const key of keptKeys) {
              trimmed[Number(key)] = updated[Number(key)];
            }
            return trimmed;
          }
          return updated;
        });
      }

      if (msg.type === 'TRANSLATION_RESULT') {
        // Patching an existing segment with its translated text from Gemini.
        debugLog('Panel', `Translation arrived for segment #${msg.segmentId}`);
        setSegments((prev) =>
          prev.map((s) =>
            s.id === msg.segmentId
              ? {
                  ...s,
                  translatedText: msg.translatedText,
                  isTranslating: false
                }
              : s
          )
        );
        // Automatically switch to translated view when result arrives.
        setToggleMap((prev) => ({ ...prev, [msg.segmentId]: true }));
      }

      if (msg.type === 'TRANSLATION_STATE') {
        // Global toggle: Start/Stop.
        debugLog('Panel', `Translation state: ${msg.isActive}`);
        setIsActive(msg.isActive);
        if (msg.sourceLang) setSourceLang(msg.sourceLang.toUpperCase());
        if (msg.targetLang) setTargetLang(msg.targetLang.toUpperCase());

        // Reset local state if processing is stopped.
        if (!msg.isActive) {
          setSegments([]);
          setToggleMap({});
          setSpeakerNames({});
          setAnalytics({
            queueLength: 0,
            chunksProcessed: 0,
            avgTranscribeMs: 0,
            avgTranslateMs: 0
          });
        }
      }

      if (msg.type === 'SPEAKER_NAMES') {
        setSpeakerNames(msg.names);
      }

      if (msg.type === 'ANALYTICS_UPDATE') {
        // Real-time telemetry update for the footer analytics bar.
        setAnalytics(msg.metrics);
      }

      if (msg.type === 'VAD_SPEECH_START') setIsSpeaking(true);
      if (msg.type === 'VAD_SPEECH_END') setIsSpeaking(false);

      if (msg.type === 'PIPELINE_ERROR') {
        // Display errors (transcription/translation API failures) as transient toasts.
        debugWarn('Panel', `Pipeline error: ${msg.message}`);
        setErrorMessage(msg.message);
        if (errorTimeout.current) clearTimeout(errorTimeout.current);
        errorTimeout.current = setTimeout(
          () => setErrorMessage(''),
          ERROR_TIMEOUT_MS
        );
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      if (errorTimeout.current) clearTimeout(errorTimeout.current);
    };
  }, []);

  return {
    segments,
    toggleMap,
    speakerNames,
    isActive,
    isSpeaking,
    errorMessage,
    sourceLang,
    targetLang,
    analytics,
    handleToggle,
    handleToggleAll,
    handleClearHistory,
    handleRenameSpeaker
  };
}
