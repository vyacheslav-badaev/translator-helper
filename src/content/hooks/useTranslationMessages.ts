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
          if (next.length > MAX_SEGMENTS) {
            const evicted = next.slice(0, next.length - MAX_SEGMENTS);
            setToggleMap((prevMap) => {
              const cleaned = { ...prevMap };
              for (const seg of evicted) {
                delete cleaned[seg.id];
              }
              cleaned[msg.segment.id] = false;
              return cleaned;
            });
            return next.slice(-MAX_SEGMENTS);
          }
          return next;
        });
        setToggleMap((prev) => ({ ...prev, [msg.segment.id]: false }));
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
        if (!msg.isActive) {
          setSegments([]);
          setToggleMap({});
        }
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
    handleToggle,
    handleToggleAll,
    handleClearHistory
  };
}
