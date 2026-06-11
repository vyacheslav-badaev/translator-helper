/**
 * Background Service Worker.
 * Acts as the central orchestrator for the extension's translation pipeline.
 */

import type {
  BackgroundRequestMessage,
  OffscreenRequestMessage
} from './types/messages';
import type { TranscriptSegment } from './types/segment';
import { loadSettings } from './storage/settings';
import { saveSession } from './storage/db';
import type { SessionData } from './storage/db';
import { TranslationQueue } from './utils/translationQueue';
import {
  DEFAULT_TRANSLATION_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  SOURCE_LANGUAGES,
  TARGET_LANGUAGES
} from './constants';
import { debugLog, debugWarn, debugError } from './utils/debug';

import {
  setupOffscreenDocument,
  closeOffscreenDocument
} from './background/offscreenManager';
import {
  syncTranslationState,
  broadcastToActiveTabs
} from './background/stateManager';
import { resetIdleTimer, clearIdleTimer } from './background/idleTimer';

/** Whether the translation pipeline is currently active. */
let isTranslating = false;

/** Guard flag to prevent concurrent toggle operations and race conditions. */
let toggleInProgress = false;

/** Monotonic segment ID counter for the current session. */
let nextSegmentId = 1;

/** Holds segments for the current active recording session in memory. */
let currentSessionSegments: TranscriptSegment[] = [];

/** Current language configuration. */
let currentSourceLang = 'auto';
let currentTargetLang = 'ru';

/** Analytics state for tracking performance. */
let chunksProcessed = 0;
let avgTranscribeMs = 0;
let avgTranslateMs = 0;

/** Broadcasts the current analytics metrics to all active content script tabs. */
function broadcastAnalytics() {
  void broadcastToActiveTabs({
    type: 'ANALYTICS_UPDATE',
    metrics: {
      queueLength: translationQueue.queueLength,
      chunksProcessed,
      avgTranscribeMs: Math.round(avgTranscribeMs),
      avgTranslateMs: Math.round(avgTranslateMs)
    }
  });
}

/** Translation queue with rate limiting, batching, and fallback logic. */
const translationQueue = new TranslationQueue(
  // onTranslation callback: triggered when a segment translation is ready
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
  // onError callback: handles translation failures and triggers auto-stop if needed
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
  },
  // onBatchComplete callback: updates translation latency analytics
  (durationMs: number, batchSize: number) => {
    const singleTranslateTime = durationMs / batchSize;
    // Exponential moving average for smoother metrics
    avgTranslateMs =
      avgTranslateMs === 0
        ? singleTranslateTime
        : avgTranslateMs * 0.9 + singleTranslateTime * 0.1;
    broadcastAnalytics();
  }
);

/** Global hotkey listener for starting/stopping the translation. */
chrome.commands.onCommand.addListener((command: string) => {
  if (command === 'toggle-translation') {
    debugLog('Background', 'Hotkey triggered: toggle-translation');
    void handleToggleTranslation();
  }
});

/**
 * Starts or stops the translation pipeline.
 * Handles offscreen document lifecycle, media stream capture, and settings injection.
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
      // 1. Prepare offscreen document for audio capture
      await setupOffscreenDocument();

      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
      });
      if (!tab?.id) {
        throw new Error('No active tab found to capture audio');
      }
      debugLog('Background', `Capturing tab: id=${tab.id}, url=${tab.url}`);

      // 2. Obtain streamId to pass to offscreen document
      const streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: tab.id
      });
      debugLog('Background', `Got streamId: ${streamId.substring(0, 20)}…`);

      // 3. Load user settings and configure prompts
      const settings = await loadSettings();
      const translationModel =
        settings.translationModel || DEFAULT_TRANSLATION_MODEL;

      if (!settings.groqApiKey) {
        throw new Error('Groq API key is missing (required for transcription)');
      }
      if (translationModel.startsWith('gemini:') && !settings.geminiApiKey) {
        throw new Error(
          'Gemini API key is missing for the selected translation model'
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

      // 4. Initialize translation queue with latest settings
      translationQueue.configure(
        settings.geminiApiKey || '',
        settings.groqApiKey,
        finalPrompt,
        translationModel
      );

      // 5. Handle session resumption if segments were provided from history
      if (resumeSegments && resumeSegments.length > 0) {
        currentSessionSegments = [...resumeSegments];
        nextSegmentId = Math.max(...resumeSegments.map((s) => s.id)) + 1;
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
        // Reset analytics and segments for a fresh session
        currentSessionSegments = [];
        nextSegmentId = 1;
        chunksProcessed = 0;
        avgTranscribeMs = 0;
        avgTranslateMs = 0;
      }

      // 6. Start idle timer for auto-shutdown after silence
      resetIdleTimer(
        () => isTranslating,
        () => void handleToggleTranslation()
      );

      // 7. Signal offscreen document to start audio capture
      const message: OffscreenRequestMessage = {
        target: 'offscreen',
        type: 'START_RECORDING',
        streamId,
        settings
      };
      await chrome.runtime
        .sendMessage(message)
        .catch((err) =>
          debugWarn('Background', 'Offscreen message failed', err)
        );
      isTranslating = true;
      debugLog('Background', 'Translation started successfully');
    } else {
      // 1. Signal offscreen to stop
      const message: OffscreenRequestMessage = {
        target: 'offscreen',
        type: 'STOP_RECORDING'
      };
      await chrome.runtime.sendMessage(message).catch(() => undefined);

      // 2. Cleanup resources
      await closeOffscreenDocument();
      translationQueue.clear();
      clearIdleTimer();
      isTranslating = false;
      debugLog('Background', 'Translation stopped successfully');

      // 3. Save the current session to history (IndexedDB)
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
    // Inform UI about the failure
    await broadcastToActiveTabs({
      type: 'PIPELINE_ERROR',
      message:
        error instanceof Error ? error.message : 'Failed to toggle translation'
    });
  } finally {
    toggleInProgress = false;
    // Notify all tabs about the final state sync
    await syncTranslationState(
      isTranslating,
      currentSourceLang,
      currentTargetLang
    );
  }
}

/**
 * Main message listener for incoming requests from Popup or Offscreen.
 */
chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    const request = message as BackgroundRequestMessage;

    if (request.target !== 'background') {
      return;
    }

    debugLog('Background', `Received message: ${request.type}`);

    // Synchronous response for status check
    if (request.type === 'GET_STATUS') {
      sendResponse({ isTranslating, busy: toggleInProgress });
      return;
    }

    // Async handling for pipeline messages
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
        // Create new session segment from transcription
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

        // Update transcription latency metrics
        chunksProcessed++;
        if (request.durationMs) {
          avgTranscribeMs =
            avgTranscribeMs === 0
              ? request.durationMs
              : avgTranscribeMs * 0.9 + request.durationMs * 0.1;
        }

        // Reset idle timer activity
        resetIdleTimer(
          () => isTranslating,
          () => void handleToggleTranslation()
        );

        // Broadcast new segment to UI
        await broadcastToActiveTabs({ type: 'NEW_SEGMENT', segment });

        // Push to translation queue
        translationQueue.enqueue(segment.id, segment.originalText);
        broadcastAnalytics();

        sendResponse({ status: 'forwarded' });
        return;
      }

      // Voice Activity Detection (VAD) events broadcast
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

      // Popup-initiated control actions
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

    return true; // Keep message channel open for async response
  }
);
