/**
 * Background Service Worker.
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
  DEFAULT_GEMINI_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  SOURCE_LANGUAGES,
  TARGET_LANGUAGES
} from './constants';
import { debugLog, debugWarn, debugError } from './utils/debug';

import { setupOffscreenDocument, closeOffscreenDocument } from './background/offscreenManager';
import { syncTranslationState, broadcastToActiveTabs } from './background/stateManager';
import { resetIdleTimer, clearIdleTimer } from './background/idleTimer';

/** Whether the translation pipeline is currently active. */
let isTranslating = false;

/** Guard flag to prevent concurrent toggle operations. */
let toggleInProgress = false;

/** Monotonic segment ID counter. */
let nextSegmentId = 1;

/** Holds segments for the current active recording session. */
let currentSessionSegments: TranscriptSegment[] = [];
let currentSourceLang = 'auto';
let currentTargetLang = 'ru';

/** Analytics state */
let chunksProcessed = 0;
let avgTranscribeMs = 0;
let avgTranslateMs = 0;

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

/** Translation queue with rate limiting and batching. */
const translationQueue = new TranslationQueue(
  // onTranslation callback
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
  // onError callback
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
  // onBatchComplete callback (for analytics)
  (durationMs: number, batchSize: number) => {
    const singleTranslateTime = durationMs / batchSize;
    avgTranslateMs =
      avgTranslateMs === 0
        ? singleTranslateTime
        : avgTranslateMs * 0.9 + singleTranslateTime * 0.1;
    broadcastAnalytics();
  }
);

// Hotkey listener
chrome.commands.onCommand.addListener((command: string) => {
  if (command === 'toggle-translation') {
    debugLog('Background', 'Hotkey triggered: toggle-translation');
    void handleToggleTranslation();
  }
});

/**
 * Starts or stops the translation pipeline.
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
      await setupOffscreenDocument();

      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
      });
      if (!tab?.id) {
        throw new Error('No active tab found to capture audio');
      }
      debugLog('Background', `Capturing tab: id=${tab.id}, url=${tab.url}`);

      const streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: tab.id
      });
      debugLog('Background', `Got streamId: ${streamId.substring(0, 20)}…`);

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

      translationQueue.configure(
        settings.geminiApiKey,
        finalPrompt,
        settings.geminiModel || DEFAULT_GEMINI_MODEL
      );

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
        currentSessionSegments = [];
        nextSegmentId = 1;
        chunksProcessed = 0;
        avgTranscribeMs = 0;
        avgTranslateMs = 0;
      }

      resetIdleTimer(() => isTranslating, () => void handleToggleTranslation());

      const message: OffscreenRequestMessage = {
        target: 'offscreen',
        type: 'START_RECORDING',
        streamId,
        settings
      };
      await chrome.runtime.sendMessage(message).catch((err) => debugWarn('Background', 'Offscreen message failed', err));
      isTranslating = true;
      debugLog('Background', 'Translation started successfully');
    } else {
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
    await broadcastToActiveTabs({
      type: 'PIPELINE_ERROR',
      message:
        error instanceof Error ? error.message : 'Failed to toggle translation'
    });
  } finally {
    toggleInProgress = false;
    await syncTranslationState(isTranslating, currentSourceLang, currentTargetLang);
  }
}

// Incoming message handler
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

    if (request.type === 'GET_STATUS') {
      sendResponse({ isTranslating, busy: toggleInProgress });
      return;
    }

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

        chunksProcessed++;
        if (request.durationMs) {
          avgTranscribeMs =
            avgTranscribeMs === 0
              ? request.durationMs
              : avgTranscribeMs * 0.9 + request.durationMs * 0.1;
        }

        resetIdleTimer(() => isTranslating, () => void handleToggleTranslation());

        await broadcastToActiveTabs({ type: 'NEW_SEGMENT', segment });

        translationQueue.enqueue(segment.id, segment.originalText);
        broadcastAnalytics();

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

    return true;
  }
);
