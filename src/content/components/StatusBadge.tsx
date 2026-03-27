/**
 * StatusBadge — Floating draggable pill showing "Translator ON/OFF".
 *
 * Positioned at the bottom-left by default. Auto-hides (fade-out animation)
 * 5 seconds after translation stops. Shows a red pulsating dot when the
 * VAD detects active speech.
 */

import React from 'react';

interface StatusBadgeProps {
  isActive: boolean;
  isSpeaking: boolean;
  badgePhase: 'visible' | 'fading' | 'hidden';
  position: { x: number; y: number };
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

export function StatusBadge({
  isActive,
  isSpeaking,
  badgePhase,
  position,
  onPointerDown,
  onPointerMove,
  onPointerUp
}: StatusBadgeProps) {
  if (badgePhase === 'hidden') return null;

  return (
    <div
      className={badgePhase === 'fading' ? 'tp-badge-hiding' : ''}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
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
      {isSpeaking && (
        <span
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            background: '#ef4444',
            borderRadius: '50%',
            marginLeft: 8,
            verticalAlign: 'middle',
            animation: 'tp-pulse 1.5s infinite ease-in-out'
          }}
        />
      )}
    </div>
  );
}
