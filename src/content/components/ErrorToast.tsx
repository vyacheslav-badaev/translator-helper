/**
 * ErrorToast — Red notification banner for pipeline errors.
 *
 * Positioned just above the StatusBadge. Auto-dismissed after
 * `ERROR_TIMEOUT_MS` by the `useTranslationMessages` hook.
 */

interface ErrorToastProps {
  message: string;
  position: { x: number; y: number };
}

export function ErrorToast({ message, position }: ErrorToastProps) {
  if (!message) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y - 46,
        maxWidth: '360px',
        background: 'rgba(220,38,38,0.95)',
        color: '#fff',
        padding: '10px 12px',
        borderRadius: '10px',
        fontSize: '12px',
        fontFamily: 'system-ui, sans-serif',
        zIndex: 2147483647,
        lineHeight: 1.35,
        boxShadow: '0 4px 14px rgba(0,0,0,0.3)'
      }}
    >
      {message}
    </div>
  );
}
