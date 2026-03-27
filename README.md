# Real-Time Translator (Chrome Extension MV3)

Chrome extension that captures active tab audio, transcribes speech in real time with **Groq Whisper** and translates it with **Google Gemini**, then renders translated segments in a draggable on-page overlay.

## Features

### Core

- Real-time audio → transcription → translation pipeline
- **VAD-based smart chunking** — audio is split at natural speech pauses (silence detection via Web Audio API)
- Global hotkey toggle: **Ctrl+Shift+L** (macOS: **⌘⇧L**)
- Extension icon badge (`ON`) when translation is active

### Popup Settings

- **Auto-save** — all changes persist automatically (debounced 800 ms)
- Collapsible API key section with ✓/missing indicators
- Selectable **Whisper model** (Large v3, Large v3 Turbo) and **Gemini model** (2.5 Flash, 2.5 Flash Lite, 2.5 Pro, 3 Flash Preview, 3.1 Pro Preview)
- Custom system prompt for translation
- Start/Stop button disabled until both API keys are provided

### Content Overlay

- Draggable **translation panel** in Shadow DOM — isolated from page styles
- Each segment shows translated text; tap to toggle original transcript
- **Copy-to-clipboard** per segment, **clear history** button
- Smooth **fade-in** animation for new segments, CSS loading spinner while translating
- Custom thin scrollbar inside the panel

### Status Badge

- Floating draggable **Translator ON / OFF** badge
- **Auto-hides** 5 seconds after translation stops (fade-out animation) — no visual clutter while browsing
- Reappears instantly when translation starts

### Reliability

- **Rate-limit retry** with exponential backoff for both Groq (429) and Gemini APIs
- **Idle auto-shutdown** — translation stops automatically after 5 minutes of silence
- **Critical error auto-stop** — pipeline shuts down on unrecoverable API errors and shows an error toast
- **Session-safe TranslationQueue** — `sessionId` prevents stale processing loops after stop/start cycles
- Race-condition guard on toggle (`toggleInProgress`)

## Tech Stack

- **Vite 8** + **@crxjs/vite-plugin** (HMR in development)
- **React 19** + **TypeScript 5.9**
- **Tailwind CSS v4** (popup UI)
- Chrome Extension **Manifest V3** + Offscreen Document

## Architecture

```
┌─────────────┐   hotkey / popup   ┌────────────────────┐
│   Popup UI  │ ──────────────────▸│  Background SW     │
│  (App.tsx)  │                    │  (background.ts)   │
└─────────────┘                    │                    │
                                   │  TranslationQueue  │
                                   │  idle timer        │
                                   └──────┬─────────────┘
                                          │ streamId
                                   ┌──────▾─────────────┐
                                   │  Offscreen Document │
                                   │  (offscreen.ts)     │
                                   │  MediaRecorder +    │
                                   │  VAD (AnalyserNode) │
                                   └──────┬─────────────┘
                                          │ TRANSCRIPTION_SEGMENT
                                   ┌──────▾─────────────┐
                                   │  Content Script     │
                                   │  TranslationPanel   │
                                   │  (Shadow DOM)       │
                                   └────────────────────┘
```

### 1) Background Service Worker (`src/background.ts`)

- Handles hotkey command and popup start/stop requests
- Manages translation state and offscreen document lifecycle
- Hosts `TranslationQueue` — rate-limited, batched Gemini translation with retry/backoff
- Idle timer: auto-stops translation after 5 min of no new segments
- Auto-stops on critical API errors (Groq or Gemini)
- Race-condition guard (`toggleInProgress`)
- Sets action badge (`ON`) and broadcasts state to content scripts

### 2) Offscreen Engine (`src/offscreen.ts`, `offscreen.html`)

- Receives `streamId` from background and captures tab audio via `MediaRecorder`
- **VAD-based smart chunking** via `AnalyserNode` RMS polling every 100 ms
  - Flush on silence ≥ 2 s (natural pause between sentences)
  - Minimum chunk: 3 s (avoids micro-fragments)
  - Maximum chunk: 10 s (safety cap for long monologues)
- Sequential chunk processing queue (prevents parallel API storms)
- Clean teardown of `MediaRecorder`, `MediaStream`, `AudioContext`, `AnalyserNode`
- Forwards pipeline errors to background → content for user-visible toasts

### 3) API Layer

- **`src/api/groq.ts`** — Whisper transcription + retry with exponential backoff on 429 (up to 3 retries, respects `Retry-After` header)
- **`src/api/gemini.ts`** — Gemini translation + context buffer (last N transcriptions for coherent output)

### 4) Utilities

- **`src/utils/translationQueue.ts`** — Rate-limited queue with batching, per-item retry, `sessionId`-based abort
- **`src/utils/sentenceBuffer.ts`** — Segments raw transcription into sentences
- **`src/utils/debug.ts`** — Conditional debug logging (`__DEBUG__` build flag)

### 5) Content UI (`src/content.tsx`, `src/content/TranslationPanel.tsx`)

- Injected on all pages, mounted inside Shadow DOM
- Displays translation panel, status badge, and error toasts
- Panel and badge are independently draggable
- Badge auto-hides when translation is off

### 6) Shared Modules

- `src/constants.ts` — VAD thresholds, timing, model lists, idle timeout
- `src/types/messages.ts` — typed `chrome.runtime` message contracts
- `src/types/segment.ts` — `TranscriptSegment` shape
- `src/types/settings.ts` — `StoredSettings` shape
- `src/storage/settings.ts` — settings persistence via `chrome.storage.local`

## Settings & Storage

All settings are stored in **`chrome.storage.local`**:

| Key            | Description                     |
| -------------- | ------------------------------- |
| `groqApiKey`   | Groq API key for Whisper        |
| `geminiApiKey` | Google AI Studio key for Gemini |
| `systemPrompt` | Custom translation prompt       |
| `whisperModel` | Selected Whisper model id       |
| `geminiModel`  | Selected Gemini model id        |

## Getting Started

### Prerequisites

- **Node.js 18+**
- API keys:
  - [Groq API Key](https://console.groq.com/keys) (free tier available, paid recommended)
  - [Google AI Studio Key](https://aistudio.google.com/app/apikey)

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

Load in Chrome:

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist` folder

### Production Build

```bash
npm run build
```

### Debug Build (with console logging)

```bash
npm run build:debug
```

### Lint

```bash
npm run lint
```

## Runtime Flow

1. User starts translation via popup button or hotkey (**Ctrl+Shift+L**)
2. Background creates offscreen document and obtains `streamId` via `chrome.tabCapture`
3. Offscreen captures tab audio with `MediaRecorder` in continuous mode
4. `AnalyserNode` polls RMS volume every 100 ms to detect speech pauses
5. On silence ≥ 2 s (or max 10 s reached) → `requestData()` flushes a chunk
6. Chunk → **Groq Whisper** transcription (with retry on 429)
7. Transcription → `TRANSCRIPTION_SEGMENT` message → background
8. Background broadcasts `NEW_SEGMENT` to content script and enqueues for **Gemini** translation
9. `TranslationQueue` sends translation with context buffer → broadcasts `TRANSLATION_RESULT`
10. Content script renders translated segment with fade-in animation
11. If idle for 5 min or critical API error → auto-stop

## VAD Tuning Constants (`src/constants.ts`)

| Constant                   | Default   | Description                                  |
| -------------------------- | --------- | -------------------------------------------- |
| `VAD_POLL_INTERVAL_MS`     | 100 ms    | How often RMS is sampled                     |
| `SILENCE_VOLUME_THRESHOLD` | 0.05      | RMS below this = silence                     |
| `SILENCE_DURATION_MS`      | 2000 ms   | Continuous silence to trigger chunk flush    |
| `MIN_CHUNK_MS`             | 3000 ms   | Minimum chunk length before flush is allowed |
| `MAX_CHUNK_MS`             | 10000 ms  | Force flush even if no silence detected      |
| `IDLE_TIMEOUT_MS`          | 300000 ms | Auto-stop after this much inactivity (5 min) |
| `ERROR_TIMEOUT_MS`         | 5000 ms   | Error toast display duration                 |

## Extension Messages

### → Background (`BackgroundRequestMessage`)

| Type                    | Payload   | Source    |
| ----------------------- | --------- | --------- |
| `START_FROM_POPUP`      | —         | Popup     |
| `STOP_FROM_POPUP`       | —         | Popup     |
| `GET_STATUS`            | —         | Popup     |
| `PIPELINE_ERROR`        | `message` | Offscreen |
| `TRANSCRIPTION_SEGMENT` | `text`    | Offscreen |

### → Offscreen (`OffscreenRequestMessage`)

| Type              | Payload                | Source     |
| ----------------- | ---------------------- | ---------- |
| `START_RECORDING` | `streamId`, `settings` | Background |
| `STOP_RECORDING`  | —                      | Background |

### → Content Scripts (`ContentScriptMessage`)

| Type                 | Payload                       | Source     |
| -------------------- | ----------------------------- | ---------- |
| `NEW_SEGMENT`        | `segment: TranscriptSegment`  | Background |
| `TRANSLATION_RESULT` | `segmentId`, `translatedText` | Background |
| `TRANSLATION_STATE`  | `isActive`                    | Background |
| `PIPELINE_ERROR`     | `message`                     | Background |

## MV3 Notes

- Service workers **cannot** access DOM/WebRTC — all media capture lives in the offscreen document
- Groq Whisper is a file-based REST endpoint (not WebSocket streaming)
- Perceived latency = silence detection window + Groq round-trip + Gemini round-trip
- `MediaRecorder.requestData()` flushes chunks without stopping the recorder
