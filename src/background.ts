/**
 * Background Service Worker.
 *
 * Responsibilities:
 * - Listens for the global hotkey command (`toggle-translation`).
 * - Manages the offscreen document lifecycle (create / close).
 * - Obtains a media stream ID via `chrome.tabCapture` and forwards it
 *   to the offscreen document to start audio capture.
 * - Keeps `isTranslating` state and synchronises it with the action badge
 *   and all active content scripts.
 * - Acts as a message hub: receives requests from popup and offscreen,
 *   broadcasts state / errors to content scripts.
 * - Manages the TranslationQueue: receives TRANSCRIPTION_SEGMENT from offscreen,
 *   creates TranscriptSegment objects, broadcasts them to content scripts,
 *   enqueues them for Gemini translation, and sends TRANSLATION_RESULT when done.
 */

import type {
  BackgroundRequestMessage,
  ContentScriptMessage,
  OffscreenRequestMessage
} from './types/messages';
import type { TranscriptSegment } from './types/segment';
import { loadSettings } from './storage/settings';
import { saveSession } from './storage/db';
import type { SessionData } from './storage/db';
import { TranslationQueue } from './utils/translationQueue';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  IDLE_TIMEOUT_MS,
  SOURCE_LANGUAGES,
  TARGET_LANGUAGES
} from './constants';
import { debugLog, debugWarn, debugError } from './utils/debug';

/** Whether the translation pipeline is currently active. */
let isTranslating = false;

/** Guard flag to prevent concurrent toggle operations (race condition protection). */
let toggleInProgress = false;

/** Monotonic segment ID counter. */
let nextSegmentId = 1;

/** Timer ID for auto-shutdown on inactivity. */
let idleTimerId: ReturnType<typeof setTimeout> | null = null;

/** Holds segments for the current active recording session. */
let currentSessionSegments: TranscriptSegment[] = [];
let currentSourceLang = 'auto';
let currentTargetLang = 'ru';

/** Translation queue with rate limiting and batching. */
const translationQueue = new TranslationQueue(
  // onTranslation callback — broadcast translated text to content scripts.
  (segmentId: number, translatedText: string) => {
    debugLog('Background', `Translation ready for segment #${segmentId}`);
    const seg = currentSessionSegments.find((s) => s.id === segmentId);
    if (seg) {
      seg.translatedText = translatedText;
      seg.isTranslating = false;
    }
    void broadcastToActiveTabs({
      type: 'TRANSLATION_RESULT',
      segmentId,
      translatedText
    });
  },
  // onError callback — broadcast error and auto-stop translation.
  (message: string) => {
    debugError('Background', `Translation queue error: ${message}`);
    void broadcastToActiveTabs({
      type: 'PIPELINE_ERROR',
      message
    }).then(() => {
      if (isTranslating && !toggleInProgress) {
        debugLog(
          'Background',
          'Auto-stopping due to critical translation error'
        );
        void handleToggleTranslation();
      }
    });
  }
);

// ---------------------------------------------------------------------------
// Hotkey listener
// ---------------------------------------------------------------------------

chrome.commands.onCommand.addListener((command: string) => {
  if (command === 'toggle-translation') {
    debugLog('Background', 'Hotkey triggered: toggle-translation');
    void handleToggleTranslation();
  }
});

// ---------------------------------------------------------------------------
// Core toggle logic
// ---------------------------------------------------------------------------

/**
 * Starts or stops the translation pipeline.
 * Protected by `toggleInProgress` to avoid overlapping async operations.
 */
async function handleToggleTranslation(resumeSegments?: TranscriptSegment[]) {
  if (toggleInProgress) {
    debugWarn('Background', 'Toggle already in progress, ignoring');
    return;
  }

  toggleInProgress = true;
  const shouldStart = !isTranslating;
  debugLog(
    'Background',
    `Toggle translation: ${shouldStart ? 'START' : 'STOP'}`
  );

  try {
    if (shouldStart) {
      // 1. Ensure the offscreen document exists.
      await setupOffscreenDocument();

      // 2. Find the active tab to capture audio from.
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
      });
      if (!tab?.id) {
        throw new Error('No active tab found to capture audio');
      }
      debugLog('Background', `Capturing tab: id=${tab.id}, url=${tab.url}`);

      // 3. Obtain a media stream ID for the tab.
      const streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: tab.id
      });
      debugLog('Background', `Got streamId: ${streamId.substring(0, 20)}…`);

      // 4. Load settings and pass them to the offscreen document.
      //    Offscreen has no access to chrome.storage, so we read here.
      const settings = await loadSettings();
      if (!settings.groqApiKey || !settings.geminiApiKey) {
        throw new Error(
          'Groq or Gemini API key is missing in extension settings'
        );
      }

      const sourceId = settings.sourceLanguage || 'auto';
      const targetId = settings.targetLanguage || 'ru';
      const sourceName =
        SOURCE_LANGUAGES.find((l) => l.id === sourceId)?.label || 'Auto-Detect';
      const targetName =
        TARGET_LANGUAGES.find((l) => l.id === targetId)?.label || 'Russian';

      const basePrompt = settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;
      const finalPrompt = basePrompt
        .replace(/\{\{source\}\}/g, sourceName)
        .replace(/\{\{target\}\}/g, targetName);

      currentSourceLang = sourceId;
      currentTargetLang = targetId;

      // 5. Configure the translation queue with Gemini settings.
      translationQueue.configure(
        settings.geminiApiKey,
        finalPrompt,
        settings.geminiModel || DEFAULT_GEMINI_MODEL
      );

      if (resumeSegments && resumeSegments.length > 0) {
        currentSessionSegments = [...resumeSegments];
        nextSegmentId = Math.max(...resumeSegments.map((s) => s.id)) + 1;
        // Pre-fill context buffer with last few segments for continuity.
        // TranslationQueue isn't exposing contextBuffer directly, so we just let it build naturally
        // But we must broadcast these old segments to content scripts
        for (const seg of resumeSegments) {
          await broadcastToActiveTabs({ type: 'NEW_SEGMENT', segment: seg });
          if (seg.translatedText && !seg.isTranslating) {
            await broadcastToActiveTabs({
              type: 'TRANSLATION_RESULT',
              segmentId: seg.id,
              translatedText: seg.translatedText
            });
          }
        }
      } else {
        currentSessionSegments = [];
        nextSegmentId = 1;
      }

      resetIdleTimer();

      // 6. Tell the offscreen document to start recording with settings.
      const message: OffscreenRequestMessage = {
        target: 'offscreen',
        type: 'START_RECORDING',
        streamId,
        settings
      };
      await chrome.runtime.sendMessage(message);
      isTranslating = true;
      debugLog('Background', 'Translation started successfully');
    } else {
      // Send stop command to offscreen (ignore errors if already closed).
      const message: OffscreenRequestMessage = {
        target: 'offscreen',
        type: 'STOP_RECORDING'
      };
      await chrome.runtime.sendMessage(message).catch(() => undefined);
      await closeOffscreenDocument();
      translationQueue.clear();
      clearIdleTimer();
      isTranslating = false;
      debugLog('Background', 'Translation stopped successfully');

      // Save session to history
      if (currentSessionSegments.length > 0) {
        const titleText =
          currentSessionSegments[0].originalText.trim() || 'Empty Session';
        const firstWords = titleText.split(/\s+/).slice(0, 5).join(' ');
        const session: SessionData = {
          id: Date.now().toString(),
          timestamp: Date.now(),
          title:
            firstWords + (titleText.length > firstWords.length ? '...' : ''),
          sourceLanguage: currentSourceLang,
          targetLanguage: currentTargetLang,
          segments: [...currentSessionSegments]
        };
        saveSession(session).catch((e) =>
          debugError('Background', 'Failed to save session', e)
        );
        currentSessionSegments = [];
      }
    }
  } catch (error) {
    debugError('Background', 'Failed to toggle translation state:', error);
    if (shouldStart) {
      isTranslating = false;
      await closeOffscreenDocument();
    }
    // Notify the user via content script error toast.
    await broadcastToActiveTabs({
      type: 'PIPELINE_ERROR',
      message:
        error instanceof Error ? error.message : 'Failed to toggle translation'
    });
  } finally {
    toggleInProgress = false;
    await syncTranslationState();
  }
}

// ---------------------------------------------------------------------------
// Offscreen document management
// ---------------------------------------------------------------------------

/** Creates the offscreen document if it doesn't already exist. */
async function setupOffscreenDocument() {
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
async function closeOffscreenDocument() {
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

// ---------------------------------------------------------------------------
// State synchronisation
// ---------------------------------------------------------------------------

/** Updates the action badge and broadcasts current state to all active tabs. */
async function syncTranslationState() {
  debugLog('Background', `Syncing state: isTranslating=${isTranslating}`);

  await chrome.action.setBadgeText({ text: isTranslating ? 'ON' : '' });
  if (isTranslating) {
    await chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
  }
  await broadcastToActiveTabs({
    type: 'TRANSLATION_STATE',
    isActive: isTranslating
  });
}

/** Sends a message to the content script in every active tab. */
async function broadcastToActiveTabs(message: ContentScriptMessage) {
  const tabs = await chrome.tabs.query({ active: true, windowType: 'normal' });
  debugLog(
    'Background',
    `Broadcasting "${message.type}" to ${tabs.length} tab(s)`
  );

  await Promise.allSettled(
    tabs
      .filter((tab: chrome.tabs.Tab) => tab.id)
      .map((tab: chrome.tabs.Tab) =>
        chrome.tabs.sendMessage(tab.id!, message).catch(() => undefined)
      )
  );
}

// ---------------------------------------------------------------------------
// Idle auto-shutdown
// ---------------------------------------------------------------------------

/** Resets (or starts) the idle timer. Called on each new segment and on start. */
function resetIdleTimer() {
  clearIdleTimer();
  idleTimerId = setTimeout(() => {
    if (!isTranslating) return;
    debugLog(
      'Background',
      `No activity for ${IDLE_TIMEOUT_MS / 1000}s — auto-stopping translation`
    );
    void handleToggleTranslation();
  }, IDLE_TIMEOUT_MS);
}

/** Clears the idle timer if running. */
function clearIdleTimer() {
  if (idleTimerId !== null) {
    clearTimeout(idleTimerId);
    idleTimerId = null;
  }
}

// ---------------------------------------------------------------------------
// Incoming message handler (from popup and offscreen)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    const request = message as BackgroundRequestMessage;

    // Ignore messages not targeted at us.
    if (request.target !== 'background') {
      return;
    }

    debugLog('Background', `Received message: ${request.type}`);

    // GET_STATUS is synchronous — respond immediately without async wrapper.
    if (request.type === 'GET_STATUS') {
      sendResponse({ isTranslating, busy: toggleInProgress });
      return;
    }

    // All other message types are handled asynchronously.
    void (async () => {
      if (request.type === 'PIPELINE_ERROR') {
        debugError(
          'Background',
          `Pipeline error from offscreen: ${request.message}`
        );
        await broadcastToActiveTabs({
          type: 'PIPELINE_ERROR',
          message: request.message
        });
        // Auto-stop on critical pipeline error.
        if (isTranslating && !toggleInProgress) {
          debugLog(
            'Background',
            'Auto-stopping due to critical pipeline error'
          );
          await handleToggleTranslation();
        }
        sendResponse({ status: 'forwarded' });
        return;
      }

      if (request.type === 'TRANSCRIPTION_SEGMENT') {
        const segment: TranscriptSegment = {
          id: nextSegmentId++,
          originalText: request.text,
          translatedText: null,
          isTranslating: true,
          timestamp: Date.now()
        };
        currentSessionSegments.push(segment);
        debugLog(
          'Background',
          `New segment #${segment.id}: "${request.text.substring(0, 50)}…"`
        );

        // Reset idle timer — activity detected.
        resetIdleTimer();

        // Immediately broadcast original text to UI.
        await broadcastToActiveTabs({ type: 'NEW_SEGMENT', segment });

        // Enqueue for Gemini translation.
        translationQueue.enqueue(segment.id, segment.originalText);

        sendResponse({ status: 'forwarded' });
        return;
      }

      if (
        request.type === 'VAD_SPEECH_START' ||
        request.type === 'VAD_SPEECH_END'
      ) {
        await broadcastToActiveTabs({ type: request.type });
        sendResponse({ status: 'forwarded' });
        return;
      }

      if (toggleInProgress) {
        debugWarn('Background', 'Toggle in progress, responding busy');
        sendResponse({ status: 'busy' });
        return;
      }

      if (request.type === 'START_FROM_POPUP') {
        if (isTranslating) {
          sendResponse({ status: 'noop', isTranslating });
          return;
        }
        await handleToggleTranslation(request.resumeSegments);
        sendResponse({
          status: isTranslating ? 'started' : 'error',
          isTranslating
        });
        return;
      }

      if (request.type === 'STOP_FROM_POPUP') {
        if (!isTranslating) {
          sendResponse({ status: 'noop', isTranslating });
          return;
        }
        await handleToggleTranslation();
        sendResponse({
          status: !isTranslating ? 'stopped' : 'error',
          isTranslating
        });
      }
    })();

    // Return true to keep the message channel open for async sendResponse.
    return true;
  }
);
