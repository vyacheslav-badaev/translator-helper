/**
 * StatusBadge — Floating draggable pill showing "Translator ON/OFF".
 *
 * It serves as a persistent status indicator that stays visible even when the main
 * panel is closed or minimized. 
 *
 * Key behaviors:
 * 1. Heartbeat Sync: Shows a red pulsating dot when active speech is detected via VAD.
 * 2. Auto-hide: Gradually fades out after 5 seconds of inactivity to minimize distraction.
 * 3. Draggable: Can be repositioned anywhere along the viewport edges.
 */

import React from 'react';

interface StatusBadgeProps {
  isActive: boolean;
  isSpeaking: boolean; // Managed by VAD status from background
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
        padding: '8px 14px',
        borderRadius: '999px',
        fontSize: '12px',
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 700,
        zIndex: 2147483647,
        letterSpacing: '0.2px',
        backdropFilter: 'blur(6px)',
        boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
        cursor: 'move',
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}
    >
      {isActive && (
        <span
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            background: '#ff0000',
            borderRadius: '50%',
            opacity: isSpeaking ? 1 : 0.3,
            transition: 'opacity 0.2s',
            animation: isSpeaking ? 'tp-pulse 1.3s infinite ease-in-out' : 'none',
            boxShadow: isSpeaking ? '0 0 8px rgba(255,0,0,0.6)' : 'none'
          }}
        />
      )}
      {isActive ? 'Translator ON' : 'Translator OFF'}
    </div>
  );
}
