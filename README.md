# Real-Time Translator (Chrome Extension MV3)

Chrome extension that captures active tab audio, transcribes speech in real time with **Groq Whisper** and translates it with **Google Gemini**, then renders translated segments in a draggable on-page overlay.

## Features

### Core

- Real-time audio → transcription → translation pipeline
- **Machine Learning VAD** (@ricky0123/vad-web) — audio is split at natural speech pauses with high accuracy
- **Low Latency** — chunking optimized for dialogue (300ms silence detection)
- Global hotkey toggle: **Ctrl+Shift+L** (macOS: **⌘⇧L**)
- Extension icon badge (`ON`) when translation is active

### Popup Settings

- **Session History** — automatically saves translation sessions to IndexedDB; supports Export to TXT, Delete, and Resume functionality
- **Source & Target Languages** — drop-downs that dynamically inject into the system prompt
- **Auto-save** — all changes persist automatically (debounced 800 ms)
- Collapsible API key section with ✓/missing indicators
- Selectable **Whisper model** (Large v3, Large v3 Turbo) and **Gemini model** (2.5 Flash, 2.5 Flash Lite, 2.5 Pro, 3 Flash Preview, 3.1 Pro Preview)
- Custom system prompt for translation
- Start/Stop button disabled until both API keys are provided

### Content Overlay

- Draggable and **resizable translation panel** in Shadow DOM — isolated from page styles
- Each segment shows translated text; tap to toggle original transcript
- **Visual Voice Indicators** — toggleable audio equalizer and status pulse confirming VAD is actively listening
- **Copy-to-clipboard** per segment, **clear history** button
- Smooth **fade-in** animation for new segments, CSS loading spinner while translating
- Custom thin scrollbar inside the panel

### Status Badge

- Floating draggable **Translator ON / OFF** badge
- Includes a red pulsating dot when active voice is detected
- **Auto-hides** 5 seconds after translation stops (fade-out animation) — no visual clutter while browsing
- Reappears instantly when translation starts

### Reliability

- **High Availability Fallbacks** — dynamically switches to alternative Gemini Flash models on 503, 429, or 500 errors
- **Rate-limit retry** with exponential backoff for Groq APIs
- **Idle auto-shutdown** — translation stops automatically after 5 minutes of silence
- **Critical error auto-stop** — pipeline shuts down on unrecoverable API errors
- **Session-safe TranslationQueue** — `sessionId` prevents stale processing loops after stop/start cycles
- Race-condition guard on toggle (`toggleInProgress`)

## Tech Stack

- **Vite 8** + **@crxjs/vite-plugin** (HMR in development)
- **React 19** + **TypeScript 5.9**
- **Tailwind CSS v4** (popup UI)
- **idb** (IndexedDB wrapper) & **vad-web** (ONNX-driven VAD)
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
                                   │  ML VAD (vad-web)   │
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
- Fallback models derived from `GEMINI_MODELS` constant (flash variants)
- Idle timer: auto-stops translation after 5 min of no new segments
- Auto-stops on critical API errors (Groq or Gemini)
- Race-condition guard (`toggleInProgress`)
- Sets action badge (`ON`) and broadcasts state to content scripts

### 2) Offscreen Engine (`src/offscreen.ts`, `offscreen.html`)

- Receives `streamId` from background and captures tab audio via `getUserMedia`
- **Audio Passthrough** — captured audio routed back to speakers via `AudioContext` so users hear original content while translating
- **Machine Learning VAD pipeline** using `@ricky0123/vad-web` (`MicVAD`)
  - Uses `silero_vad_v5.onnx` model with dialogue-optimized parameters
  - **Dialogue Optimization**: `redemptionMs: 300`, `negativeSpeechThreshold: 0.45` for fast speech segmentation in conversations
  - Dynamic `sourceLanguage` passed to Whisper (no longer hardcoded)
  - Proper `myvad.destroy()` cleanup on stop
- WAV-encoded audio chunks sent to Groq Whisper
- Sequential chunk processing queue (prevents parallel API storms)
- Forwards pipeline errors to background → content for user-visible toasts

### 3) API Layer

- **`src/api/groq.ts`** — Whisper transcription with WAV MIME type + retry with exponential backoff on 429 (up to 3 retries, respects `Retry-After` header)
- **`src/api/gemini.ts`** — Gemini translation with proper `system_instruction` field (128K+ token capacity vs 896 char limit) + context buffer; API key sent via `x-goog-api-key` header

### 4) Utilities

- **`src/utils/translationQueue.ts`** — Rate-limited queue with batching, per-item retry, `sessionId`-based abort, fallback models derived from constants
- **`src/utils/sentenceBuffer.ts`** — Segments raw transcription into sentences
- **`src/utils/debug.ts`** — Conditional debug logging (`__DEBUG__` build flag)

### 5) Popup UI (`src/App.tsx`, `src/popup/`)

```
src/popup/
  hooks/
    useSettings.ts          — settings state, auto-save, flushSettings()
    useTranslation.ts       — isActive, toggle, status toast, runtime listener
    useHistory.ts           — sessions CRUD, export, resume
  components/
    PopupHeader.tsx         — gradient header with tabs and ACTIVE/OFF badge
    StatusToast.tsx          — transient success/error banner
    SettingsTab.tsx          — Start/Stop, API keys, languages, models, prompt
    HistoryTab.tsx           — session list with Export/Resume/Delete
```

`App.tsx` is a thin orchestrator (~88 lines) that wires hooks to components.

### 6) Content UI (`src/content.tsx`, `src/content/`)

```
src/content/
  hooks/
    useDraggable.ts          — generic pointer drag with viewport clamping
    useTranslationMessages.ts — runtime message handler (segments, VAD, errors)
  components/
    StatusBadge.tsx           — floating ON/OFF pill with speech dot
    ErrorToast.tsx            — red error banner above badge
    PanelHeader.tsx           — draggable title bar with EN/RU, clear, minimize
    PanelFooter.tsx           — segment count + equalizer visualization
    SegmentRow.tsx            — single transcript segment with toggle
  TranslationPanel.tsx        — orchestrator (~220 lines)
```

Injected on all pages inside Shadow DOM. Panel and badge are independently draggable.

### 7) Shared Modules

- `src/constants.ts` — timing, model lists, language lists, idle timeout
- `src/types/messages.ts` — typed `chrome.runtime` message contracts
- `src/types/segment.ts` — `TranscriptSegment` shape
- `src/types/settings.ts` — `StoredSettings` shape
- `src/storage/settings.ts` — settings persistence via `chrome.storage.local` (all 7 fields)
- `src/storage/db.ts` — IndexedDB wrapper with cached singleton connection

## Settings & Storage

All settings are stored in **`chrome.storage.local`**:

| Key              | Description                     |
| ---------------- | ------------------------------- |
| `groqApiKey`     | Groq API key for Whisper        |
| `geminiApiKey`   | Google AI Studio key for Gemini |
| `systemPrompt`   | Custom translation prompt       |
| `whisperModel`   | Selected Whisper model id       |
| `geminiModel`    | Selected Gemini model id        |
| `sourceLanguage` | Audio source language code      |
| `targetLanguage` | Translation target language     |

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
3. Offscreen captures tab audio via `getUserMedia`, routes passthrough to speakers, and pipes it to `MicVAD`
4. ML VAD (`silero_vad_v5.onnx`) detects speech boundaries with 300ms silence threshold (optimized for dialogue)
5. On speech end → VAD emits a `Float32Array` → encoded as WAV blob
6. WAV blob → **Groq Whisper** transcription (with retry on 429)
7. Transcription → `TRANSCRIPTION_SEGMENT` message → background
8. Background broadcasts `NEW_SEGMENT` to content script and enqueues for **Gemini** translation
9. `TranslationQueue` sends translation with context buffer → broadcasts `TRANSLATION_RESULT`
10. Content script renders translated segment with fade-in animation
11. If idle for 5 min or critical API error → auto-stop

## Key Constants (`src/constants.ts`)

| Constant           | Default   | Description                                  |
| ------------------ | --------- | -------------------------------------------- |
| `IDLE_TIMEOUT_MS`  | 300000 ms | Auto-stop after this much inactivity (5 min) |
| `ERROR_TIMEOUT_MS` | 5000 ms   | Error toast display duration                 |

VAD parameters are configured directly in `offscreen.ts` via `MicVAD.new()` options:
`positiveSpeechThreshold: 0.8`, `negativeSpeechThreshold: 0.45`, `redemptionMs: 300` (300ms silence for dialogue optimization).

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
