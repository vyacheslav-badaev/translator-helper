/**
 * useTranslationMessages — Runtime message handler for the content script.
 *
 * Subscribes to `chrome.runtime.onMessage` and processes:
 * - `NEW_SEGMENT`        — appends a transcript segment (caps at MAX_SEGMENTS).
 * - `TRANSLATION_RESULT` — patches the matching segment with translated text.
 * - `TRANSLATION_STATE`  — toggles the active flag; clears segments on stop.
 * - `VAD_SPEECH_START/END` — tracks whether the user is currently speaking.
 * - `PIPELINE_ERROR`     — displays a transient error toast.
 *
 * Also queries `GET_STATUS` on mount to sync initial state.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { debugLog, debugWarn } from '../../utils/debug';
import { ERROR_TIMEOUT_MS } from '../../constants';
import type {
  BackgroundRequestMessage,
  ContentScriptMessage
} from '../../types/messages';
import type { TranscriptSegment } from '../../types/segment';

/** Maximum number of transcript segments kept in memory before eviction. */
const MAX_SEGMENTS = 100;

/** Public API returned by the hook. */
export interface UseTranslationMessagesReturn {
  segments: TranscriptSegment[];
  toggleMap: Record<number, boolean>;
  isActive: boolean;
  isSpeaking: boolean;
  errorMessage: string;
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
}

export function useTranslationMessages(): UseTranslationMessagesReturn {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [toggleMap, setToggleMap] = useState<Record<number, boolean>>({});
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

  /** Clear all segments and reset the toggle map. */
  const handleClearHistory = useCallback(() => {
    debugLog('Panel', 'Clearing segment history');
    setSegments([]);
    setToggleMap({});
  }, []);

  /** Toggle a single segment between original and translated text. */
  const handleToggle = useCallback((id: number) => {
    setToggleMap((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  /** Toggle ALL segments to original or translated at once. */
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

    const listener = (msg: ContentScriptMessage) => {
      if (msg.type === 'NEW_SEGMENT') {
        debugLog('Panel', `New segment #${msg.segment.id}`);
        setSegments((prev) => {
          const next = [...prev, msg.segment];
          return next.length > MAX_SEGMENTS ? next.slice(-MAX_SEGMENTS) : next;
        });
        
        setToggleMap((prev) => {
          const updated = { ...prev, [msg.segment.id]: false };
          const keys = Object.keys(updated);
          // Cleanup old toggle states to prevent memory leak
          if (keys.length > MAX_SEGMENTS + 20) {
            const trimmed: Record<number, boolean> = {};
            // Object keys are strings, but they are numerical IDs, so they sort reasonably
            // We just grab the last MAX_SEGMENTS keys.
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
        setToggleMap((prev) => ({ ...prev, [msg.segmentId]: true }));
      }

      if (msg.type === 'TRANSLATION_STATE') {
        debugLog('Panel', `Translation state: ${msg.isActive}`);
        setIsActive(msg.isActive);
        if (msg.sourceLang) setSourceLang(msg.sourceLang.toUpperCase());
        if (msg.targetLang) setTargetLang(msg.targetLang.toUpperCase());
        if (!msg.isActive) {
          setSegments([]);
          setToggleMap({});
          setAnalytics({ queueLength: 0, chunksProcessed: 0, avgTranscribeMs: 0, avgTranslateMs: 0 });
        }
      }

      if (msg.type === 'ANALYTICS_UPDATE') {
        setAnalytics(msg.metrics);
      }

      if (msg.type === 'VAD_SPEECH_START') setIsSpeaking(true);
      if (msg.type === 'VAD_SPEECH_END') setIsSpeaking(false);

      if (msg.type === 'PIPELINE_ERROR') {
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
    isActive,
    isSpeaking,
    errorMessage,
    sourceLang,
    targetLang,
    analytics,
    handleToggle,
    handleToggleAll,
    handleClearHistory
  };
}
