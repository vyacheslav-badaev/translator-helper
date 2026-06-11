/**
 * SegmentRow — Single transcript segment inside the translation panel.
 *
 * Displays a timestamp, the original or translated text, and a toggle
 * button (EN/RU). While translation is in progress, the button shows a
 * pulsating "···" indicator. When toggled to RU, the original text is
 * shown below in italics for reference.
 */

import type { TranscriptSegment } from '../../types/segment';
import { SpeakerBadge } from './SpeakerBadge';

/** Format timestamp as HH:MM:SS. */
function formatTime(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

interface SegmentRowProps {
  segment: TranscriptSegment;
  showTranslation: boolean;
  onToggle: () => void;
  /** User-assigned name for the segment's speaker, if any. */
  speakerName?: string;
  onRenameSpeaker: (speakerId: number, name: string) => void;
}

export function SegmentRow({
  segment,
  showTranslation,
  onToggle,
  speakerName,
  onRenameSpeaker
}: SegmentRowProps) {
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
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            minWidth: 0
          }}
        >
          {segment.speakerId !== undefined && (
            <SpeakerBadge
              speakerId={segment.speakerId}
              name={speakerName}
              onRename={onRenameSpeaker}
            />
          )}
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
            {formatTime(segment.timestamp)}
          </span>
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
