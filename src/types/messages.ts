/**
 * Typed message contracts for chrome.runtime messaging between extension contexts.
 * Each union member represents a distinct action with its required payload.
 */

import type { StoredSettings } from './settings';
import type { TranscriptSegment } from './segment';
import type { HardwareCheckResult } from '../utils/hardwareCheck';
import type { LocalWhisperModelId } from '../constants';

/** Messages sent TO the background service worker (from popup or offscreen). */
export type BackgroundRequestMessage =
  | {
      target: 'background';
      type: 'START_FROM_POPUP';
      resumeSegments?: TranscriptSegment[];
      resumeSpeakerNames?: Record<number, string>;
    }
  | { target: 'background'; type: 'STOP_FROM_POPUP' }
  | { target: 'background'; type: 'GET_STATUS' }
  | { target: 'background'; type: 'PIPELINE_ERROR'; message: string }
  | {
      target: 'background';
      type: 'TRANSCRIPTION_SEGMENT';
      text: string;
      durationMs?: number;
      speakerId?: number;
    }
  | {
      target: 'background';
      type: 'RENAME_SPEAKER';
      speakerId: number;
      name: string;
    }
  | { target: 'background'; type: 'VAD_SPEECH_START' }
  | { target: 'background'; type: 'VAD_SPEECH_END' }
  | { target: 'background'; type: 'LOCAL_LLM_DOWNLOAD' }
  | { target: 'background'; type: 'LOCAL_LLM_CHECK_HARDWARE' }
  | {
      target: 'background';
      type: 'LOCAL_LLM_PROGRESS';
      percent: number;
      phase: 'download' | 'warmup';
    }
  | {
      target: 'background';
      type: 'LOCAL_LLM_TRANSLATE_RESULT';
      requestId: string;
      result: string | null;
      error?: string;
    };

/** Messages sent TO the offscreen document (from background). */
export type OffscreenRequestMessage =
  | {
      target: 'offscreen';
      type: 'START_RECORDING';
      streamId: string;
      settings: StoredSettings;
    }
  | { target: 'offscreen'; type: 'STOP_RECORDING' }
  | { target: 'offscreen'; type: 'LOCAL_LLM_DOWNLOAD' }
  | { target: 'offscreen'; type: 'LOCAL_LLM_CHECK_HARDWARE' }
  | { target: 'offscreen'; type: 'LOCAL_LLM_LOAD' }
  | { target: 'offscreen'; type: 'LOCAL_LLM_UNLOAD' }
  | {
      target: 'offscreen';
      type: 'LOCAL_LLM_TRANSLATE';
      requestId: string;
      text: string;
      prompt: string;
    }
  | {
      target: 'offscreen';
      type: 'LOCAL_WHISPER_LOAD';
      modelId: LocalWhisperModelId;
    };

/** Messages sent TO content scripts (from background, broadcast to active tabs). */
export type ContentScriptMessage =
  | { type: 'NEW_SEGMENT'; segment: TranscriptSegment }
  | { type: 'TRANSLATION_RESULT'; segmentId: number; translatedText: string }
  | {
      type: 'TRANSLATION_STATE';
      isActive: boolean;
      sourceLang?: string;
      targetLang?: string;
    }
  | { type: 'PIPELINE_ERROR'; message: string }
  | { type: 'SPEAKER_NAMES'; names: Record<number, string> }
  | {
      type: 'ANALYTICS_UPDATE';
      metrics: {
        queueLength: number;
        chunksProcessed: number;
        avgTranscribeMs: number;
        avgTranslateMs: number;
      };
    }
  | { type: 'VAD_SPEECH_START' }
  | { type: 'VAD_SPEECH_END' }
  | {
      type: 'LOCAL_LLM_PROGRESS';
      percent: number;
      phase: 'download' | 'warmup';
    }
  | { type: 'LOCAL_LLM_READY' }
  | { type: 'LOCAL_LLM_DOWNLOAD_FAILED'; message: string }
  | {
      type: 'LOCAL_LLM_HARDWARE_RESULT';
      result: HardwareCheckResult;
    };
