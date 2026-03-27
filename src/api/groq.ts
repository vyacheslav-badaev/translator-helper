/**
 * Groq Whisper API client.
 *
 * Sends an audio blob to the Groq REST endpoint for speech-to-text
 * transcription using the Whisper Large V3 model.
 */

import { GROQ_TRANSCRIPTION_URL } from '../constants';
import { debugLog, debugWarn, debugError } from '../utils/debug';

/** Maximum number of retry attempts on 429 rate-limit errors. */
const MAX_RETRIES = 3;

/** Initial backoff (ms) before first retry. Doubled on each subsequent attempt. */
const INITIAL_BACKOFF_MS = 5000;

/** Shape of the JSON response from the Groq transcription endpoint. */
type GroqTranscriptionResponse = {
  text?: string;
  error?: { message?: string };
};

/**
 * Transcribes a single audio chunk via Groq Whisper.
 * @param blob     - WebM audio blob from MediaRecorder.
 * @param apiKey   - Groq API key.
 * @param model    - Whisper model identifier (e.g. 'whisper-large-v3').
 * @param language - ISO-639-1 language hint (e.g. 'en') for better accuracy.
 * @param prompt   - Optional prompt for Whisper context continuity.
 * @returns Transcribed text, or `null` if the result was empty / silence.
 */
export async function transcribeAudioChunk(
  blob: Blob,
  apiKey: string,
  model: string,
  language?: string,
  prompt?: string
): Promise<string | null> {
  debugLog(
    'Groq',
    `Sending audio chunk for transcription (${(blob.size / 1024).toFixed(1)} KB, model=${model})`
  );

  let backoff = INITIAL_BACKOFF_MS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const formData = new FormData();
    formData.append(
      'file',
      new File([blob], 'chunk.wav', { type: 'audio/wav' })
    );
    formData.append('model', model);
    if (language) {
      formData.append('language', language);
    }
    if (prompt) {
      formData.append('prompt', prompt);
    }

    let response: Response;
    try {
      response = await fetch(GROQ_TRANSCRIPTION_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        body: formData
      });
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Network request failed';
      debugError('Groq', `Fetch failed: ${errorMsg}`);
      throw new Error(`Failed to connect to Groq API: ${errorMsg}`);
    }

    // Handle 429 rate limit with retry.
    if (response.status === 429 && attempt < MAX_RETRIES) {
      // Prefer Retry-After header if provided (value in seconds).
      const retryAfter = response.headers.get('Retry-After');
      const waitMs = retryAfter
        ? Math.ceil(parseFloat(retryAfter) * 1000)
        : backoff;
      debugWarn(
        'Groq',
        `Rate limited (429), retry ${attempt + 1}/${MAX_RETRIES} in ${(waitMs / 1000).toFixed(1)}s`
      );
      await new Promise((r) => setTimeout(r, waitMs));
      backoff = Math.min(backoff * 2, 60000);
      continue;
    }

    // Check response status before parsing JSON to catch network/CORS errors.
    if (!response.ok) {
      let errorMsg = `Groq API request failed (${response.status})`;
      try {
        const data = (await response.json()) as GroqTranscriptionResponse;
        errorMsg = data.error?.message || errorMsg;
      } catch {
        // JSON parse failed, use generic error message.
      }
      debugError('Groq', `Transcription failed: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    const data = (await response.json()) as GroqTranscriptionResponse;

    const text = data.text?.trim();

    if (text) {
      debugLog(
        'Groq',
        `Transcription result: "${text.substring(0, 80)}${text.length > 80 ? '…' : ''}"`
      );
    } else {
      debugLog('Groq', 'Transcription returned empty (silence or noise)');
    }

    return text ? text : null;
  }

  // All retries exhausted.
  debugError('Groq', 'Rate limit retries exhausted');
  throw new Error('Groq rate limit exceeded — retries exhausted');
}
