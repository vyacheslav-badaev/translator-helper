import { IDLE_TIMEOUT_MS } from '../constants';
import { debugLog } from '../utils/debug';

/** 
 * Module to handle automatic pipeline shutdown after a period of inactivity. 
 */

let idleTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Resets the inactivity timer. 
 * If no activity occurs within IDLE_TIMEOUT_MS, the onTimeout callback is fired.
 */
export function resetIdleTimer(isActiveCheck: () => boolean, onTimeout: () => void) {
  clearIdleTimer();
  
  if (!isActiveCheck()) return;

  idleTimeout = setTimeout(() => {
    debugLog('Background', 'Idle timeout reached, auto-stopping...');
    onTimeout();
  }, IDLE_TIMEOUT_MS);
}

/**
 * Cancels the current idle timer.
 */
export function clearIdleTimer() {
  if (idleTimeout) {
    clearTimeout(idleTimeout);
    idleTimeout = null;
  }
}
