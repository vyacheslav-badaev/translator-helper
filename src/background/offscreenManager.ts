/**
 * Manages the lifecycle of the Offscreen Document.
 * Offscreen documents are required in Manifest V3 for tasks that need DOM APIs, 
 * like getUserMedia or complex audio processing.
 */

import { debugLog } from '../utils/debug';

/**
 * Ensures the offscreen document is created and ready.
 * If it already exists, this is a no-op.
 */
export async function setupOffscreenDocument() {
  const OFFSCREEN_PATH = 'offscreen.html';

  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
  });

  if (existingContexts.length > 0) {
    debugLog('Background', 'Offscreen document already exists');
    return;
  }

  debugLog('Background', 'Creating offscreen document');
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: 'Capturing tab audio for real-time transcription and providing audio passthrough.'
  });
}

/**
 * Closes the offscreen document if it exists.
 */
export async function closeOffscreenDocument() {
  const OFFSCREEN_PATH = 'offscreen.html';

  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
  });

  if (existingContexts.length > 0) {
    debugLog('Background', 'Closing offscreen document');
    await chrome.offscreen.closeDocument();
  }
}
