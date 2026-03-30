import { debugLog, debugError } from '../utils/debug';

/** Creates the offscreen document if it doesn't already exist. */
export async function setupOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]
  });

  if (existingContexts.length > 0) {
    debugLog('Background', 'Offscreen document already exists, reusing');
    return;
  }

  debugLog('Background', 'Creating offscreen document…');
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [
      chrome.offscreen.Reason.USER_MEDIA,
      chrome.offscreen.Reason.AUDIO_PLAYBACK
    ],
    justification: 'Recording audio for real-time translation'
  });
  debugLog('Background', 'Offscreen document created');
}

/** Safely closes the offscreen document if it is open. */
export async function closeOffscreenDocument() {
  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]
    });
    if (existingContexts.length > 0) {
      await chrome.offscreen.closeDocument();
      debugLog('Background', 'Offscreen document closed');
    }
  } catch (error) {
    debugError('Background', 'Failed to close offscreen document:', error);
  }
}
