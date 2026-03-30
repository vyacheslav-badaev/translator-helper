/**
 * PanelHeader — Draggable title bar for the translation panel.
 *
 * Contains the "Live Translation" label and action buttons:
 * EN/RU toggle-all, clear history (✕), and minimize/expand (–/+).
 * The entire header area is the drag handle for repositioning the panel.
 */

import React from 'react';

interface PanelHeaderProps {
  isMinimized: boolean;
  isSpeaking: boolean;
  sourceLang: string;
  targetLang: string;
  onToggleAll: () => void;
  onClearHistory: () => void;
  onToggleMinimize: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
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
        <div style={{ width: '8px', height: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              background: '#ff3333',
              borderRadius: '50%',
              opacity: isSpeaking ? 1 : 0,
              transition: 'opacity 0.2s',
              animation: isSpeaking ? 'tp-pulse 1.5s infinite ease-in-out' : 'none'
            }}
          />
        </div>
        <span style={{ color: '#fff', fontSize: '13px', fontWeight: 600 }}>
          Live Translation
        </span>
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>
        {/* Toggle all button */}
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
        {/* Clear history button */}
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
        {/* Minimize button */}
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
