import { debugLog } from '../utils/debug';
import { IDLE_TIMEOUT_MS } from '../constants';

let idleTimerId: ReturnType<typeof setTimeout> | null = null;

/** Resets (or starts) the idle timer. Called on each new segment and on start. */
export function resetIdleTimer(
  isTranslating: () => boolean,
  onIdle: () => void
) {
  clearIdleTimer();
  idleTimerId = setTimeout(() => {
    if (!isTranslating()) return;
    debugLog(
      'Background',
      `No activity for ${IDLE_TIMEOUT_MS / 1000}s — auto-stopping translation`
    );
    onIdle();
  }, IDLE_TIMEOUT_MS);
}

/** Clears the idle timer if running. */
export function clearIdleTimer() {
  if (idleTimerId !== null) {
    clearTimeout(idleTimerId);
    idleTimerId = null;
  }
}
