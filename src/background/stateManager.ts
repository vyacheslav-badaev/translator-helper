import { debugLog, debugWarn } from '../utils/debug';
import type { ContentScriptMessage } from '../types/messages';

/** Updates the action badge and broadcasts current state to all active tabs. */
export async function syncTranslationState(
  isTranslating: boolean,
  sourceLang?: string,
  targetLang?: string
) {
  debugLog('Background', `Syncing state: isTranslating=${isTranslating}`);

  await chrome.action.setBadgeText({ text: isTranslating ? 'ON' : '' });
  if (isTranslating) {
    await chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
  }
  await broadcastToActiveTabs({
    type: 'TRANSLATION_STATE',
    isActive: isTranslating,
    sourceLang,
    targetLang
  });
}

/** Sends a message to the content script in every active tab. */
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
