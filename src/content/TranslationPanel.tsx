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

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslationMessages } from './hooks/useTranslationMessages';
import { useDraggable } from './hooks/useDraggable';
import { StatusBadge } from './components/StatusBadge';
import { ErrorToast } from './components/ErrorToast';
import { PanelHeader } from './components/PanelHeader';
import { PanelFooter } from './components/PanelFooter';
import { SegmentRow } from './components/SegmentRow';

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
  @keyframes tp-eq {
    0% { height: 2px; }
    50% { height: 10px; }
    100% { height: 2px; }
  }
  .tp-eq { background: #10b981; width: 3px; border-radius: 1px; animation: tp-eq 0.5s infinite ease-in-out; }
  .tp-eq-1 { animation-delay: 0.1s; }
  .tp-eq-2 { animation-delay: 0.3s; }
  .tp-eq-3 { animation-delay: 0.2s; }
  .tp-resizable { resize: both; overflow: hidden; min-width: 250px; min-height: 200px; }
`;

/** Panel dimensions. */
const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 600;

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

// ---------------------------------------------------------------------------
// TranslationPanel — main component
// ---------------------------------------------------------------------------

export function TranslationPanel() {
  const messages = useTranslationMessages();
  const [isMinimized, setIsMinimized] = useState(false);
  const [showEq, setShowEq] = useState(true);

  // Badge auto-hide: 'visible' → 'fading' (5s) → 'hidden' (5.6s) when OFF.
  const [badgePhase, setBadgePhase] = useState<'visible' | 'fading' | 'hidden'>(
    'visible'
  );

  useEffect(() => {
    if (messages.isActive) return;

    const fadeTimer = setTimeout(() => setBadgePhase('fading'), 5000);
    const hideTimer = setTimeout(() => setBadgePhase('hidden'), 5600);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
      setBadgePhase('visible');
    };
  }, [messages.isActive]);

  // Draggable panel.
  const panelRef = useRef<HTMLDivElement>(null);
  const panelClamp = useCallback((x: number, y: number) => {
    const w = panelRef.current?.offsetWidth ?? PANEL_WIDTH;
    const h = panelRef.current?.offsetHeight ?? PANEL_HEIGHT;
    return clampPosition(x, y, w, h);
  }, []);
  const panel = useDraggable(
    () =>
      clampPosition(
        window.innerWidth - PANEL_WIDTH - 16,
        80,
        PANEL_WIDTH,
        PANEL_HEIGHT
      ),
    panelClamp
  );

  // Draggable badge.
  const badge = useDraggable(
    () => clampBadgePosition(16, window.innerHeight - BADGE_HEIGHT - 16),
    clampBadgePosition
  );

  // Auto-scroll to bottom when new segments arrive.
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.segments, scrollToBottom]);

  return (
    <>
      <style>{PANEL_STYLES}</style>

      <StatusBadge
        isActive={messages.isActive}
        isSpeaking={messages.isSpeaking}
        badgePhase={badgePhase}
        position={badge.pos}
        onPointerDown={badge.onPointerDown}
        onPointerMove={badge.onPointerMove}
        onPointerUp={badge.onPointerUp}
      />

      <ErrorToast message={messages.errorMessage} position={badge.pos} />

      {messages.isActive && (
        <div
          ref={panelRef}
          className="tp-resizable"
          style={{
            position: 'fixed',
            left: panel.pos.x,
            top: panel.pos.y,
            width: PANEL_WIDTH,
            height: isMinimized ? 'auto' : PANEL_HEIGHT,
            backgroundColor: 'rgba(15,15,20,0.92)',
            borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            zIndex: 2147483647,
            display: 'flex',
            flexDirection: 'column',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.08)',
            fontFamily: 'system-ui, sans-serif'
          }}
        >
          <PanelHeader
            isMinimized={isMinimized}
            onToggleAll={messages.handleToggleAll}
            onClearHistory={messages.handleClearHistory}
            onToggleMinimize={() => setIsMinimized(!isMinimized)}
            onPointerDown={panel.onPointerDown}
            onPointerMove={panel.onPointerMove}
            onPointerUp={panel.onPointerUp}
          />

          {!isMinimized && (
            <div
              ref={scrollRef}
              className="tp-scroll"
              style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}
            >
              {messages.segments.length === 0 ? (
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
                messages.segments.map((seg) => (
                  <SegmentRow
                    key={seg.id}
                    segment={seg}
                    showTranslation={!!messages.toggleMap[seg.id]}
                    onToggle={() => messages.handleToggle(seg.id)}
                  />
                ))
              )}
            </div>
          )}

          {!isMinimized && (
            <PanelFooter
              segmentCount={messages.segments.length}
              isSpeaking={messages.isSpeaking}
              showEq={showEq}
              onToggleEq={() => setShowEq(!showEq)}
            />
          )}
        </div>
      )}
    </>
  );
}
