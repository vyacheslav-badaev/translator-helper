/**
 * PanelFooter — Bottom status and analytics bar for the translation panel.
 *
 * It provides real-time feedback about the processing pipeline:
 * 1. Equalizer: Three green bars that animate vertically when speech is detected (VAD).
 * 2. Segment Counter: Displays the current number of fragments in session.
 */

interface PanelFooterProps {
  segmentCount: number; // Total number of fragments currently in memory
  isSpeaking: boolean;  // VAD status; triggers CSS animations for the EQ
}

export function PanelFooter({
  segmentCount,
  isSpeaking
}: PanelFooterProps) {
  return (
    <div
      style={{
        padding: '6px 12px',
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
        {/* Real-time CSS Equalizer: Static bars when silent, jumping bars when speaking */}
        <div
          title={isSpeaking ? 'Listening...' : 'Silence'}
          style={{
            display: 'flex',
            gap: '2px',
            height: '10px',
            alignItems: 'flex-end',
            marginLeft: '4px'
          }}
        >
          <div className={isSpeaking ? 'tp-eq tp-eq-1' : 'tp-eq-idle'} />
          <div className={isSpeaking ? 'tp-eq tp-eq-2' : 'tp-eq-idle'} />
          <div className={isSpeaking ? 'tp-eq tp-eq-3' : 'tp-eq-idle'} />
        </div>
      </div>
      <div>
        {segmentCount} segment{segmentCount !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
