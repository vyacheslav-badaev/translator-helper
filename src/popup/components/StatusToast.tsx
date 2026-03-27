/**
 * StatusToast — Transient notification banner displayed inside the popup.
 * Renders a colored strip (green for success, red for error) that
 * auto-hides after 2.5 s via the parent hook.
 */

interface StatusToastProps {
  text: string;
  tone: 'success' | 'error';
}

export function StatusToast({ text, tone }: StatusToastProps) {
  if (!text) return null;

  return (
    <div
      className={`text-xs font-semibold text-center mb-3 px-2 py-1.5 rounded w-full shadow-sm sticky top-0 z-10 ${
        tone === 'error'
          ? 'bg-red-50 text-red-600 border border-red-100'
          : 'bg-green-50 text-green-600 border border-green-100'
      }`}
    >
      {text}
    </div>
  );
}
