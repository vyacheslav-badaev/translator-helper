# Real-Time Translator (Chrome Extension MV3)

Chrome extension that captures active tab audio, transcribes speech in real time, translates it, and renders segments in a draggable on-page overlay.

**Transcription (ASR):** Groq Whisper (cloud) or local Whisper in the browser  
**Translation:** Google Gemini, Groq LLMs, or a local WebGPU model (Qwen3 0.6B)

## Features

### Core

- Real-time audio → transcription → translation pipeline
- **Machine Learning VAD** (`@ricky0123/vad-web`) — splits audio at natural speech pauses
- Dialogue-oriented chunking (≈300 ms silence detection)
- Global hotkey toggle: **Ctrl+Shift+L** (macOS: **⌘⇧L**)
- Extension icon badge (`ON`) when translation is active
- Proactive block for uncapturable tabs (`chrome://`, Web Store, extension pages, etc.)

### Providers

| Stage | Options |
| ----- | ------- |
| **ASR** | Groq Whisper (Large v3 / Turbo) · Local Whisper Tiny / Base (ONNX, ~97–147 MB) |
| **Translation** | Gemini (2.5 / 3.x) · Groq (Qwen3, Llama, GPT-OSS) · Local Qwen3 0.6B (~570 MB, WebGPU) |

- Local translation uses a fixed imperative system prompt (separate from the editable cloud prompt)
- Local model download with progress, WebGPU hardware check, and cache flag in settings
- Local ASR/LLM modules are **lazy-loaded** so the cloud path stays lean

### Popup Settings

- **Session History** — IndexedDB; export TXT, delete, resume
- **Source & Target Languages** — injected into the system prompt (`{{source}}` / `{{target}}`)
- **Auto-save** — debounced ≈800 ms
- API keys with ✓ / missing indicators (only required keys for the selected providers)
- ASR provider switch (Groq vs Local Whisper)
- Multi-provider translation model list
- Local model panel: download, hardware check, cache status
- Speaker Detection (Beta) for local diarization
- Custom system prompt for **cloud** translation
- Start disabled while a local model is downloading or required keys/cache are missing

### Content Overlay

- Draggable and **resizable** panel in Shadow DOM
- Tap a segment to toggle original vs translation
- Speaker badges when diarization is enabled
- Heartbeat pulse + footer equalizer synced with speech
- Analytics footer: chunks processed, queue length, avg transcription / translation latency
- Per-segment copy, clear history, fade-in for new segments

### Status Badge

- Floating draggable **Translator ON / OFF** badge
- Red pulse while speech is detected
- Auto-hides 5 s after stop; reappears on start

### Reliability & Performance

- Gemini fallbacks on 503 / 429 / 500
- Groq Whisper retry with exponential backoff on 429
- Cloud translation batching + sliding context window
- Local translation: no batching / no prior context (better for small models)
- Empty or echoed local outputs are discarded (segment stays untranslated)
- Idle auto-shutdown after 5 minutes of silence
- Concurrent Start blocked during local model download / hardware check

## Tech Stack

- **Vite 8** + **@crxjs/vite-plugin**
- **React 19** + **TypeScript 5.9**
- **Tailwind CSS v4** (popup)
- **@huggingface/transformers** v4 (local LLM / Whisper)
- **idb**, **vad-web**, **onnxruntime-web**
- Chrome Extension **Manifest V3** + Offscreen Document

## Architecture

```
┌─────────────┐   hotkey / popup   ┌────────────────────┐
│   Popup UI  │ ──────────────────▸│  Background SW     │
│  (App.tsx)  │                    │  (background.ts)   │
└─────────────┘                    │  TranslationQueue  │
                                   │  idle timer        │
                                   └──────┬─────────────┘
                                          │ streamId / LOCAL_*
                                   ┌──────▾─────────────┐
                                   │  Offscreen Document │
                                   │  VAD · ASR · LLM    │
                                   │  (lazy local mods)  │
                                   └──────┬─────────────┘
                                          │ segments / results
                                   ┌──────▾─────────────┐
                                   │  Content Script     │
                                   │  TranslationPanel   │
                                   └────────────────────┘
```

### 1) Background (`src/background.ts`)

- Hotkey / popup start-stop, state, badge, idle timer
- Offscreen lifecycle; owns `chrome.storage` writes for local model cache
- Hosts `TranslationQueue` (cloud batching + local request/response)
- Validates API keys / local cache before start
- Blocks Start while a local model op owns the offscreen document
- Rejects privileged URLs that Chrome cannot capture

### 2) Offscreen (`src/offscreen.ts`)

- Tab audio via `getUserMedia` + passthrough to speakers
- ML VAD (`silero_vad_v5`) and optional speaker embeddings
- ASR: Groq Whisper **or** local Whisper (`src/api/localWhisper.ts`)
- Local LLM download / load / translate (`src/api/localLlm.ts`) — dynamic `import()`
- Only `chrome.runtime` is available here (no `chrome.storage`)

### 3) API Layer

| Module | Role |
| ------ | ---- |
| `src/api/groq.ts` | Cloud Whisper + Groq chat translation |
| `src/api/gemini.ts` | Gemini translation + context buffer |
| `src/api/localLlm.ts` | Qwen3-0.6B-ONNX via WebGPU (`q4f16`) |
| `src/api/localWhisper.ts` | Browser ASR (`onnx-community/whisper-*`) |

### 4) Utilities

- `translationQueue.ts` — cloud batching / local one-by-one translate
- `sentenceBuffer.ts`, `speakerEmbedder.ts`, `speakerClustering.ts`
- `hardwareCheck.ts` — WebGPU probe for local LLM
- `debug.ts` — `__DEBUG__` gated logs (`debugWarn` / `debugLog`); `debugError` always on

### 5) Popup / Content

Unchanged layout under `src/popup/` and `src/content/` — settings now include ASR provider, local Whisper model, and local LLM download UI.

## Settings & Storage

Persisted in **`chrome.storage.local`**:

| Key | Description |
| --- | ----------- |
| `groqApiKey` | Groq (Whisper and/or Groq translation) |
| `geminiApiKey` | Gemini translation |
| `systemPrompt` | Editable cloud translation prompt |
| `whisperModel` | Groq Whisper model id |
| `translationModel` | Prefixed id (`groq:…` / `gemini:…` / `local:…`) |
| `sourceLanguage` / `targetLanguage` | Language codes |
| `speakerDetection` | Local diarization toggle |
| `asrProvider` | `groq` \| `local` |
| `localWhisperModel` | ONNX Whisper repo id |
| `localLlmModelCached` | Local translation weights present |

Session history lives in **IndexedDB** (`src/storage/db.ts`). Local model weights use the Transformers.js / browser cache (not IndexedDB).

## Getting Started

### Prerequisites

- **Node.js 18+**
- For cloud ASR/translation: [Groq](https://console.groq.com/keys) and/or [Google AI Studio](https://aistudio.google.com/app/apikey)
- For local translation: a GPU with **WebGPU** support; download ~570 MB once
- For local ASR: download Whisper Tiny/Base on first use (~97–147 MB)

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
3. **Load unpacked** → select the `dist` folder

### Production / Debug / Lint

```bash
npm run build
npm run build:debug   # enables debugWarn / debugLog
npm run lint
```

## Runtime Flow

1. Start via popup or **Ctrl+Shift+L**
2. Background checks tab URL, keys/cache, creates offscreen, gets `streamId`
3. Offscreen captures tab audio, VAD segments speech → WAV
4. ASR (Groq or local Whisper) → `TRANSCRIPTION_SEGMENT`
5. Background broadcasts `NEW_SEGMENT` and enqueues translation
6. Cloud: batched Gemini/Groq with context · Local: fixed prompt, no context
7. `TRANSLATION_RESULT` → overlay update
8. Idle 5 min or critical error → auto-stop

## Key Constants (`src/constants.ts`)

| Constant | Notes |
| -------- | ----- |
| `IDLE_TIMEOUT_MS` | 300000 — idle auto-stop |
| `ERROR_TIMEOUT_MS` | 5000 — error toast duration |
| `LOCAL_TRANSLATION_MODEL` | `onnx-community/Qwen3-0.6B-ONNX` |
| `LOCAL_SYSTEM_PROMPT` | Imperative prompt for local LLM only |
| `DEFAULT_LOCAL_WHISPER_MODEL` | `onnx-community/whisper-base` |

VAD (in `offscreen.ts`): `positiveSpeechThreshold: 0.8`, `negativeSpeechThreshold: 0.45`, `redemptionMs: 300`.

## Extension Messages (summary)

**→ Background:** `START_FROM_POPUP`, `STOP_FROM_POPUP`, `GET_STATUS`, `PIPELINE_ERROR`, `TRANSCRIPTION_SEGMENT`, `RENAME_SPEAKER`, `VAD_*`, `LOCAL_LLM_DOWNLOAD`, `LOCAL_LLM_CHECK_HARDWARE`, `LOCAL_LLM_PROGRESS`, `LOCAL_LLM_TRANSLATE_RESULT`

**→ Offscreen:** `START_RECORDING`, `STOP_RECORDING`, `LOCAL_LLM_*`, `LOCAL_WHISPER_LOAD`

**→ Content:** `NEW_SEGMENT`, `TRANSLATION_RESULT`, `TRANSLATION_STATE`, `PIPELINE_ERROR`, `SPEAKER_NAMES`, `ANALYTICS_UPDATE`, `VAD_*`

## MV3 & Local-Model Notes

- Service workers cannot use DOM/WebRTC — media and ML run in the offscreen document
- Offscreen may only use `chrome.runtime`; cache flags are written by the background SW
- Local LLM ONNX files must stay small enough for the WASM heap (≈&lt;1 GB single protobuf, or external shards)
- Chrome cannot capture `chrome://`, extension pages, DevTools, or the Web Store
- Perceived latency ≈ VAD silence window + ASR + translation RTT (local path is GPU-bound)
