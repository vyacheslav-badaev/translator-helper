/**
 * PanelFooter — Bottom bar of the translation panel.
 *
 * Shows the current segment count and a toggleable audio equalizer
 * visualization that animates when the VAD detects active speech.
 */

interface PanelFooterProps {
  segmentCount: number;
  isSpeaking: boolean;
  showEq: boolean;
  onToggleEq: () => void;
}

export function PanelFooter({
  segmentCount,
  isSpeaking,
  showEq,
  onToggleEq
}: PanelFooterProps) {
  return (
    <div
      style={{
        padding: '4px 12px',
        fontSize: '10px',
        color: 'rgba(255,255,255,0.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        flexShrink: 0
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          onClick={onToggleEq}
          title="Toggle Equalizer"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: showEq ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.2)',
            fontSize: '10px',
            padding: 0
          }}
        >
          {showEq ? 'Hide EQ' : 'Show EQ'}
        </button>
        {showEq && isSpeaking && (
          <div
            style={{
              display: 'flex',
              gap: '2px',
              height: '10px',
              alignItems: 'flex-end',
              marginLeft: '4px'
            }}
          >
            <div className="tp-eq tp-eq-1" />
            <div className="tp-eq tp-eq-2" />
            <div className="tp-eq tp-eq-3" />
          </div>
        )}
      </div>
      <div>
        {segmentCount} segment{segmentCount !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
