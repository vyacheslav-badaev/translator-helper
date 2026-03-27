/**
 * TranslationPanel — Content script UI component.
 *
 * Renders a floating, draggable chat-like panel that displays transcript segments.
 * Each segment shows original English text and can be toggled to show the Russian translation.
 * Segments appear immediately with original text; translations fill in asynchronously.
 *
 * Also renders:
 * - Status badge (Translator ON/OFF) — draggable, bottom-left.
 * - Error toast — above the badge on pipeline errors.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ERROR_TIMEOUT_MS } from '../constants';
import type {
  BackgroundRequestMessage,
  ContentScriptMessage
} from '../types/messages';
import type { TranscriptSegment } from '../types/segment';

/** Maximum number of segments kept in memory. */
const MAX_SEGMENTS = 100;

/** Inline styles injected into Shadow DOM for scrollbar and animations. */
const PANEL_STYLES = `
  .tp-scroll::-webkit-scrollbar { width: 5px; }
  .tp-scroll::-webkit-scrollbar-track { background: transparent; }
  .tp-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
  .tp-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
  @keyframes tp-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .tp-segment { animation: tp-fade-in 200ms ease-out; }
  @keyframes tp-pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 0.8; } }
  .tp-loading { animation: tp-pulse 1.2s ease-in-out infinite; }
  @keyframes tp-badge-fade-out { from { opacity: 1; } to { opacity: 0; } }
  .tp-badge-hiding { animation: tp-badge-fade-out 600ms ease-out forwards; pointer-events: none; }
`;

/** Panel dimensions. */
const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 420;

/** Approximate height of the status badge. */
const BADGE_HEIGHT = 34;

function clampPosition(x: number, y: number, w: number, h: number) {
  return {
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w - 8)),
    y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - h - 8))
  };
}

function clampBadgePosition(x: number, y: number) {
  return {
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - 160)),
    y: Math.min(
      Math.max(8, y),
      Math.max(8, window.innerHeight - BADGE_HEIGHT - 8)
    )
  };
}

/** Format timestamp as HH:MM:SS. */
function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// ---------------------------------------------------------------------------
// SegmentRow — single transcript segment with toggle
// ---------------------------------------------------------------------------

function SegmentRow({
  segment,
  showTranslation,
  onToggle
}: {
  segment: TranscriptSegment;
  showTranslation: boolean;
  onToggle: () => void;
}) {
  const hasTranslation = !!segment.translatedText;
  const displayText =
    showTranslation && hasTranslation
      ? segment.translatedText!
      : segment.originalText;

  return (
    <div
      className="tp-segment"
      style={{
        padding: '8px 10px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        fontSize: '13px',
        lineHeight: '1.45',
        fontFamily: 'system-ui, sans-serif'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '4px'
        }}
      >
        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
          {formatTime(segment.timestamp)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          disabled={!hasTranslation && !segment.isTranslating}
          style={{
            background: 'none',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '4px',
            color: segment.isTranslating
              ? 'rgba(255,255,255,0.3)'
              : showTranslation
                ? '#60a5fa'
                : 'rgba(255,255,255,0.5)',
            fontSize: '10px',
            padding: '1px 6px',
            cursor: hasTranslation ? 'pointer' : 'default',
            transition: 'color 150ms'
          }}
        >
          {segment.isTranslating ? (
            <span className="tp-loading">···</span>
          ) : showTranslation ? (
            'RU'
          ) : (
            'EN'
          )}
        </button>
      </div>
      <div
        style={{
          color:
            showTranslation && hasTranslation
              ? '#93c5fd'
              : 'rgba(255,255,255,0.9)',
          transition: 'color 200ms'
        }}
      >
        {displayText}
      </div>
      {showTranslation && hasTranslation && (
        <div
          style={{
            marginTop: '3px',
            fontSize: '10px',
            lineHeight: '1.35',
            color: 'rgba(255,255,255,0.3)',
            fontStyle: 'italic'
          }}
        >
          {segment.originalText}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TranslationPanel — main component
// ---------------------------------------------------------------------------

export function TranslationPanel() {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [toggleMap, setToggleMap] = useState<Record<number, boolean>>({});
  const [isActive, setIsActive] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Badge auto-hide: 'visible' → 'fading' (5s) → 'hidden' (5.6s) when OFF.
  // All setState calls are in timer callbacks or effect cleanup — no sync setState in effect body.
  const [badgePhase, setBadgePhase] = useState<'visible' | 'fading' | 'hidden'>(
    'visible'
  );

  useEffect(() => {
    if (isActive) return;

    const fadeTimer = setTimeout(() => setBadgePhase('fading'), 5000);
    const hideTimer = setTimeout(() => setBadgePhase('hidden'), 5600);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
      // Reset badge to visible when isActive changes back to true.
      setBadgePhase('visible');
    };
  }, [isActive]);

  const handleClearHistory = () => {
    setSegments([]);
    setToggleMap({});
  };

  // Panel position.
  const [panelPos, setPanelPos] = useState(() =>
    clampPosition(
      window.innerWidth - PANEL_WIDTH - 16,
      80,
      PANEL_WIDTH,
      PANEL_HEIGHT
    )
  );

  // Badge position.
  const [badgePos, setBadgePos] = useState(() =>
    clampBadgePosition(16, window.innerHeight - BADGE_HEIGHT - 16)
  );

  // Refs.
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDraggingPanel = useRef(false);
  const isDraggingBadge = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const errorTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll to bottom when new segments arrive.
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [segments, scrollToBottom]);

  // Message listeners.
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
        setSegments((prev) => {
          const next = [...prev, msg.segment];
          return next.length > MAX_SEGMENTS ? next.slice(-MAX_SEGMENTS) : next;
        });
        // Default: show original (EN). User toggles to RU.
        setToggleMap((prev) => ({ ...prev, [msg.segment.id]: false }));
      }

      if (msg.type === 'TRANSLATION_RESULT') {
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
        // Auto-switch to translation when it arrives.
        setToggleMap((prev) => ({ ...prev, [msg.segmentId]: true }));
      }

      if (msg.type === 'TRANSLATION_STATE') {
        setIsActive(msg.isActive);
        if (!msg.isActive) {
          // Clear segments when translation stops.
          setSegments([]);
          setToggleMap({});
        }
      }

      if (msg.type === 'PIPELINE_ERROR') {
        setErrorMessage(msg.message);
        if (errorTimeout.current) clearTimeout(errorTimeout.current);
        errorTimeout.current = setTimeout(
          () => setErrorMessage(''),
          ERROR_TIMEOUT_MS
        );
      }
    };

    const handleResize = () => {
      setPanelPos((prev) =>
        clampPosition(prev.x, prev.y, PANEL_WIDTH, PANEL_HEIGHT)
      );
      setBadgePos((prev) => clampBadgePosition(prev.x, prev.y));
    };

    chrome.runtime.onMessage.addListener(listener);
    window.addEventListener('resize', handleResize);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      window.removeEventListener('resize', handleResize);
      if (errorTimeout.current) clearTimeout(errorTimeout.current);
    };
  }, []);

  // Toggle a single segment between EN/RU.
  const handleToggle = (id: number) => {
    setToggleMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Toggle ALL segments between EN/RU at once.
  const handleToggleAll = () => {
    const anyShowingTranslation = Object.values(toggleMap).some(Boolean);
    const newValue = !anyShowingTranslation;
    setToggleMap((prev) => {
      const next: Record<number, boolean> = {};
      for (const key of Object.keys(prev)) {
        next[Number(key)] = newValue;
      }
      return next;
    });
  };

  // ----- Drag: Panel -----
  const onPanelPointerDown = (e: React.PointerEvent) => {
    isDraggingPanel.current = true;
    dragStart.current = {
      x: e.clientX - panelPos.x,
      y: e.clientY - panelPos.y
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPanelPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingPanel.current) return;
    setPanelPos(
      clampPosition(
        e.clientX - dragStart.current.x,
        e.clientY - dragStart.current.y,
        PANEL_WIDTH,
        PANEL_HEIGHT
      )
    );
  };
  const onPanelPointerUp = (e: React.PointerEvent) => {
    isDraggingPanel.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  // ----- Drag: Badge -----
  const onBadgePointerDown = (e: React.PointerEvent) => {
    isDraggingBadge.current = true;
    dragStart.current = {
      x: e.clientX - badgePos.x,
      y: e.clientY - badgePos.y
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onBadgePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingBadge.current) return;
    setBadgePos(
      clampBadgePosition(
        e.clientX - dragStart.current.x,
        e.clientY - dragStart.current.y
      )
    );
  };
  const onBadgePointerUp = (e: React.PointerEvent) => {
    isDraggingBadge.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  return (
    <>
      {/* Inject scoped CSS into Shadow DOM */}
      <style>{PANEL_STYLES}</style>
      {/* ---- Status badge (auto-hides when OFF) ---- */}
      {badgePhase !== 'hidden' && (
        <div
          className={badgePhase === 'fading' ? 'tp-badge-hiding' : ''}
          onPointerDown={onBadgePointerDown}
          onPointerMove={onBadgePointerMove}
          onPointerUp={onBadgePointerUp}
          style={{
            position: 'fixed',
            left: badgePos.x,
            top: badgePos.y,
            background: isActive
              ? 'rgba(22,163,74,0.92)'
              : 'rgba(107,114,128,0.92)',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: '999px',
            fontSize: '12px',
            fontFamily: 'system-ui, sans-serif',
            fontWeight: 700,
            zIndex: 2147483647,
            letterSpacing: '0.2px',
            backdropFilter: 'blur(6px)',
            boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
            cursor: 'move',
            userSelect: 'none'
          }}
        >
          {isActive ? 'Translator ON' : 'Translator OFF'}
        </div>
      )}

      {/* ---- Error toast ---- */}
      {errorMessage && (
        <div
          style={{
            position: 'fixed',
            left: badgePos.x,
            top: badgePos.y - 46,
            maxWidth: '360px',
            background: 'rgba(220,38,38,0.95)',
            color: '#fff',
            padding: '10px 12px',
            borderRadius: '10px',
            fontSize: '12px',
            fontFamily: 'system-ui, sans-serif',
            zIndex: 2147483647,
            lineHeight: 1.35,
            boxShadow: '0 4px 14px rgba(0,0,0,0.3)'
          }}
        >
          {errorMessage}
        </div>
      )}

      {/* ---- Translation panel ---- */}
      {isActive && (
        <div
          style={{
            position: 'fixed',
            left: panelPos.x,
            top: panelPos.y,
            width: `${PANEL_WIDTH}px`,
            height: isMinimized ? 'auto' : `${PANEL_HEIGHT}px`,
            backgroundColor: 'rgba(15,15,20,0.92)',
            borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            zIndex: 2147483647,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.08)',
            fontFamily: 'system-ui, sans-serif'
          }}
        >
          {/* ---- Header (draggable) ---- */}
          <div
            onPointerDown={onPanelPointerDown}
            onPointerMove={onPanelPointerMove}
            onPointerUp={onPanelPointerUp}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              background: 'rgba(255,255,255,0.05)',
              cursor: 'move',
              userSelect: 'none',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              flexShrink: 0
            }}
          >
            <span style={{ color: '#fff', fontSize: '13px', fontWeight: 600 }}>
              Live Translation
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              {/* Toggle all button */}
              <button
                onClick={handleToggleAll}
                title="Toggle all EN/RU"
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#93c5fd',
                  fontSize: '11px',
                  padding: '2px 8px',
                  cursor: 'pointer'
                }}
              >
                EN/RU
              </button>
              {/* Clear history button */}
              <button
                onClick={handleClearHistory}
                title="Clear history"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255,255,255,0.35)',
                  fontSize: '13px',
                  cursor: 'pointer',
                  padding: '0 4px',
                  lineHeight: 1
                }}
              >
                ✕
              </button>
              {/* Minimize button */}
              <button
                onClick={() => setIsMinimized(!isMinimized)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255,255,255,0.5)',
                  fontSize: '16px',
                  cursor: 'pointer',
                  padding: '0 4px',
                  lineHeight: 1
                }}
              >
                {isMinimized ? '+' : '\u2013'}
              </button>
            </div>
          </div>

          {/* ---- Scrollable segment list ---- */}
          {!isMinimized && (
            <div
              ref={scrollRef}
              className="tp-scroll"
              style={{
                flex: 1,
                overflowY: 'auto',
                overflowX: 'hidden'
              }}
            >
              {segments.length === 0 ? (
                <div
                  style={{
                    padding: '32px 16px',
                    textAlign: 'center',
                    color: 'rgba(255,255,255,0.3)',
                    fontSize: '13px'
                  }}
                >
                  Listening for speech...
                </div>
              ) : (
                segments.map((seg) => (
                  <SegmentRow
                    key={seg.id}
                    segment={seg}
                    showTranslation={!!toggleMap[seg.id]}
                    onToggle={() => handleToggle(seg.id)}
                  />
                ))
              )}
            </div>
          )}

          {/* ---- Footer with segment count ---- */}
          {!isMinimized && (
            <div
              style={{
                padding: '4px 12px',
                fontSize: '10px',
                color: 'rgba(255,255,255,0.25)',
                textAlign: 'right',
                borderTop: '1px solid rgba(255,255,255,0.05)',
                flexShrink: 0
              }}
            >
              {segments.length} segment{segments.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </>
  );
}
