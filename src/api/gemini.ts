/**
 * Google Gemini API client.
 *
 * Sends transcribed text (plus optional context from previous phrases)
 * to Gemini Flash for translation according to the user's system prompt.
 */

import { debugLog, debugError } from '../utils/debug';

/** Shape of the JSON response from the Gemini generateContent endpoint. */
type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
};

/**
 * Translates a transcribed text fragment via Gemini.
 * @param input                  - Raw transcription from Groq Whisper.
 * @param apiKey                 - Google AI Studio API key.
 * @param prompt                 - System prompt (user-configurable).
 * @param model                  - Gemini model identifier (e.g. 'gemini-2.5-flash-lite').
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
    'Gemini',
    `Translating (model=${model}): "${input.substring(0, 60)}${input.length > 60 ? '…' : ''}"`
  );

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Build the full user message: prompt + optional context + current text.
  let userMessage = prompt;

  if (previousTranscriptions && previousTranscriptions.length > 0) {
    const context = previousTranscriptions.join('\n');
    userMessage += `\n\nPrevious context (for reference only, do NOT translate this again):\n${context}`;
    debugLog(
      'Gemini',
      `Context buffer attached (${previousTranscriptions.length} phrases)`
    );
  }

  userMessage += `\n\nOriginal Text: ${input}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: userMessage }]
        }
      ]
    })
  });

  const data = (await response.json()) as GeminiResponse;

  if (!response.ok) {
    const errorMsg =
      data.error?.message || `Gemini API request failed (${response.status})`;
    debugError('Gemini', `Translation failed: ${errorMsg}`);
    throw new Error(errorMsg);
  }

  const translation = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

  if (translation) {
    debugLog(
      'Gemini',
      `Translation result: "${translation.substring(0, 80)}${translation.length > 80 ? '…' : ''}"`
    );
  } else {
    debugLog('Gemini', 'Translation returned empty response');
  }

  return translation ? translation : null;
}
