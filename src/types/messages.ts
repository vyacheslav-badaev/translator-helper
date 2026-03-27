/**
 * Typed message contracts for chrome.runtime messaging between extension contexts.
 * Each union member represents a distinct action with its required payload.
 */

import type { StoredSettings } from './settings';
import type { TranscriptSegment } from './segment';

/** Messages sent TO the background service worker (from popup or offscreen). */
export type BackgroundRequestMessage =
  | { target: 'background'; type: 'START_FROM_POPUP' }
  | { target: 'background'; type: 'STOP_FROM_POPUP' }
  | { target: 'background'; type: 'GET_STATUS' }
  | { target: 'background'; type: 'PIPELINE_ERROR'; message: string }
  | { target: 'background'; type: 'TRANSCRIPTION_SEGMENT'; text: string };

/** Messages sent TO the offscreen document (from background). */
export type OffscreenRequestMessage =
  | {
      target: 'offscreen';
      type: 'START_RECORDING';
      streamId: string;
      settings: StoredSettings;
    }
  | { target: 'offscreen'; type: 'STOP_RECORDING' };

/** Messages sent TO content scripts (from background, broadcast to active tabs). */
export type ContentScriptMessage =
  | { type: 'NEW_SEGMENT'; segment: TranscriptSegment }
  | { type: 'TRANSLATION_RESULT'; segmentId: number; translatedText: string }
  | { type: 'TRANSLATION_STATE'; isActive: boolean }
  | { type: 'PIPELINE_ERROR'; message: string };
