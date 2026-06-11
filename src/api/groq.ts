/**
 * Groq Whisper API client.
 *
 * Sends an audio blob to the Groq REST endpoint for speech-to-text
 * transcription using the Whisper Large V3 model.
 */

import {
  GROQ_TRANSCRIPTION_URL,
  GROQ_CHAT_COMPLETIONS_URL
} from '../constants';
import { debugLog, debugWarn, debugError } from '../utils/debug';

/** Maximum number of retry attempts on 429 rate-limit errors. */
const MAX_RETRIES = 3;

/** Initial backoff (ms) before first retry. Doubled on each subsequent attempt. */
const INITIAL_BACKOFF_MS = 5000;

/** Shape of the JSON response from the Groq Chat Completions endpoint. */
type GroqChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: { message?: string };
};

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

/**
 * Translates a transcribed text fragment via Groq Chat Completions.
 * @param input                  - Raw transcription from Groq Whisper.
 * @param apiKey                 - Groq API key.
 * @param prompt                 - System prompt (user-configurable).
 * @param model                  - Raw Groq model identifier (e.g. 'qwen/qwen3-32b').
 * @param previousTranscriptions - Optional context buffer (last N phrases)
 *                                 to improve coherence of the translation.
 * @returns Translated text, or `null` if the model returned nothing.
 */
export async function translateText(
  input: string,
  apiKey: string,
  prompt: string,
  model: string,
  previousTranscriptions?: string[]
): Promise<string | null> {
  debugLog(
    'Groq',
    `Translating (model=${model}): "${input.substring(0, 60)}${input.length > 60 ? '…' : ''}"`
  );

  let systemInstruction = prompt;

  if (previousTranscriptions && previousTranscriptions.length > 0) {
    const context = previousTranscriptions.join('\n');
    systemInstruction += `\n\nPrevious context (for reference only, do NOT translate this again):\n${context}`;
    debugLog(
      'Groq',
      `Context buffer attached (${previousTranscriptions.length} phrases)`
    );
  }

  const userMessage = `Original Text: ${input}`;

  const isQwen = model.toLowerCase().includes('qwen');

  const requestBody: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: userMessage }
    ]
  };

  if (isQwen) {
    requestBody['reasoning_format'] = 'hidden';
  }

  const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  // Check response status before parsing JSON to catch non-JSON error
  // responses (e.g. 502/504 gateway errors with HTML bodies).
  if (!response.ok) {
    let errorMsg = `Groq API request failed (${response.status})`;
    try {
      const errorData = (await response.json()) as GroqChatCompletionResponse;
      errorMsg = errorData.error?.message || errorMsg;
    } catch {
      // JSON parse failed, use generic error message with status code.
    }
    debugError('Groq', `Translation failed: ${errorMsg}`);
    throw new Error(errorMsg);
  }

  const data = (await response.json()) as GroqChatCompletionResponse;

  let translation = data.choices?.[0]?.message?.content?.trim();

  if (translation) {
    translation = translation.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  if (translation) {
    debugLog(
      'Groq',
      `Translation result: "${translation.substring(0, 80)}${translation.length > 80 ? '…' : ''}"`
    );
  } else {
    debugLog('Groq', 'Translation returned empty response');
  }

  return translation || null;
}
