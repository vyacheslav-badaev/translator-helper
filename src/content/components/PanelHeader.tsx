/**
 * PanelHeader — Draggable title bar for the translation panel.
 *
 * It serves as the primary navigation and interaction point:
 * 1. Visual Indicator: A red pulsating dot (Heartbeat) that shows real-time VAD status.
 * 2. Branding: Displays the "Live Translation" application title.
 * 3. Language Selector: Shows the currently active [Source]/[Target] mapping.
 * 4. Actions: Global toggle (EN/RU), Clear history (✕), and Minimize/Expand (–/+).
 *
 * Drag Handle: The entire header area is configured as a drag handle for the user.
 */

import React from 'react';

interface PanelHeaderProps {
  isMinimized: boolean;
  isSpeaking: boolean; // Managed by VAD status from background
  sourceLang: string; // Dynamic source language code
  targetLang: string; // Dynamic target language code
  onToggleAll: () => void; // Dispatches a mass toggle to all segments
  onClearHistory: () => void; // Wipes the segment session
  onToggleMinimize: () => void; // Compact/Expand view
  onPointerDown: (event: React.PointerEvent) => void; // Dragging start
  onPointerMove: (event: React.PointerEvent) => void; // Dragging move
  onPointerUp: (event: React.PointerEvent) => void; // Dragging end
}

export function PanelHeader({
  isMinimized,
  isSpeaking,
  sourceLang,
  targetLang,
  onToggleAll,
  onClearHistory,
  onToggleMinimize,
  onPointerDown,
  onPointerMove,
  onPointerUp
}: PanelHeaderProps) {
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* Heartbeat Indicator: Syncs with user speech detected by VAD */}
        <div style={{ width: '12px', height: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              background: '#ff0000',
              borderRadius: '50%',
              opacity: isSpeaking ? 1 : 0,
              transition: 'opacity 0.2s',
              animation: isSpeaking ? 'tp-pulse 1.3s infinite ease-in-out' : 'none',
              boxShadow: isSpeaking ? '0 0 8px rgba(255,0,0,0.6)' : 'none'
            }}
          />
        </div>
        <span style={{ color: '#fff', fontSize: '13px', fontWeight: 600 }}>
          Live Translation
        </span>
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>
        {/* Bulk Toggle: Swaps all segments between translated and original text */}
        <button
          onClick={onToggleAll}
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
          {sourceLang}/{targetLang}
        </button>
        {/* Wipe Session: Dangerous action to clear current transcript history */}
        <button
          onClick={onClearHistory}
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
        {/* Window Controls: Minimizes the panel to a small badge */}
        <button
          onClick={onToggleMinimize}
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
  );
}
