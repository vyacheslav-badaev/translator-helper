import { debugLog, debugWarn } from '../utils/debug';
import type { ContentScriptMessage } from '../types/messages';

/** 
 * Synchronizes the translation state by updating the action badge 
 * and broadcasting the status to all active content script tabs.
 */
export async function syncTranslationState(
  isTranslating: boolean,
  sourceLang?: string,
  targetLang?: string
) {
  debugLog('Background', `Syncing state: isTranslating=${isTranslating}`);

  // Update extension icon badge
  await chrome.action.setBadgeText({ text: isTranslating ? 'ON' : '' });
  if (isTranslating) {
    await chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
  }

  // Notify content scripts to show/hide the UI panel
  await broadcastToActiveTabs({
    type: 'TRANSLATION_STATE',
    isActive: isTranslating,
    sourceLang,
    targetLang
  });
}

/** 
 * Broadcasts a generic ContentScriptMessage to all active and visible tabs.
 */
export async function broadcastToActiveTabs(message: ContentScriptMessage) {
  const tabs = await chrome.tabs.query({ active: true, windowType: 'normal' });
  debugLog(
    'Background',
    `Broadcasting "${message.type}" to ${tabs.length} tab(s)`
  );

  await Promise.allSettled(
    tabs
      .filter((tab: chrome.tabs.Tab) => tab.id)
      .map((tab: chrome.tabs.Tab) =>
        chrome.tabs.sendMessage(tab.id!, message).catch((err) => {
          debugWarn('Background', `Failed to send to tab ${tab.id}`, err);
        })
      )
  );
}
