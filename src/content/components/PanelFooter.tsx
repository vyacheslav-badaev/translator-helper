/**
 * PanelFooter — Bottom bar of the translation panel.
 *
 * Shows the current segment count and a toggleable audio equalizer
 * visualization that animates when the VAD detects active speech.
 */

interface PanelFooterProps {
  segmentCount: number;
  isSpeaking: boolean;
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
