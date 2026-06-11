/**
 * SpeakerBadge — Compact colored pill identifying the speaker of a segment.
 *
 * Displays the user-assigned name (e.g. "Julia") or the default label
 * ("Speaker 1"). Clicking the badge switches it to an inline text input:
 *   - Enter / blur → save the new name (empty input restores the default),
 *   - Escape       → cancel editing.
 *
 * Colors are assigned from a fixed palette by speaker ID so each speaker
 * keeps a stable color for the whole session.
 */

import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SPEAKER_LABEL_PREFIX,
  MAX_SPEAKER_NAME_LENGTH
} from '../../constants';

/** Stable per-speaker color palette (dark-theme friendly). */
const SPEAKER_COLORS = ['#10b981', '#60a5fa', '#f59e0b', '#f472b6'];

/** Returns the display color for a 1-based speaker ID. */
function speakerColor(speakerId: number): string {
  return SPEAKER_COLORS[(speakerId - 1) % SPEAKER_COLORS.length];
}

/** Returns the default label for a speaker without a custom name. */
function defaultSpeakerLabel(speakerId: number): string {
  return `${DEFAULT_SPEAKER_LABEL_PREFIX} ${speakerId}`;
}

interface SpeakerBadgeProps {
  speakerId: number;
  /** User-assigned name; falls back to the default label when undefined. */
  name?: string;
  onRename: (speakerId: number, name: string) => void;
}

export function SpeakerBadge({ speakerId, name, onRename }: SpeakerBadgeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const color = speakerColor(speakerId);
  const label = name || defaultSpeakerLabel(speakerId);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const startEditing = (event: React.MouseEvent) => {
    event.stopPropagation();
    setDraft(name || '');
    setIsEditing(true);
  };

  const commit = () => {
    setIsEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (name || '')) {
      onRename(speakerId, trimmed);
    }
  };

  const cancel = () => {
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        maxLength={MAX_SPEAKER_NAME_LENGTH}
        placeholder={defaultSpeakerLabel(speakerId)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') cancel();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '90px',
          background: 'rgba(255,255,255,0.08)',
          border: `1px solid ${color}`,
          borderRadius: '8px',
          color: 'rgba(255,255,255,0.9)',
          fontSize: '10px',
          fontFamily: 'system-ui, sans-serif',
          padding: '1px 6px',
          outline: 'none'
        }}
      />
    );
  }

  return (
    <button
      onClick={startEditing}
      onPointerDown={(e) => e.stopPropagation()}
      title="Click to rename speaker"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        background: 'none',
        border: `1px solid ${color}55`,
        borderRadius: '8px',
        color,
        fontSize: '10px',
        fontWeight: 600,
        padding: '1px 6px',
        cursor: 'pointer',
        maxWidth: '120px',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis'
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: color,
          flexShrink: 0
        }}
      />
      {label}
    </button>
  );
}
