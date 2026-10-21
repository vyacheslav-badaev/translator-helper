# LiveTab Translator (Chrome Extension MV3)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?style=flat-square&logo=google-chrome&logoColor=white)](manifest.json)
[![React 19](https://img.shields.io/badge/React-19.2-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript 5.9](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Donate-yellow.svg?style=flat-square&logo=buy-me-a-coffee)](https://buymeacoffee.com/slavaadmdew)

Real-time audio transcription and translation Chrome Extension (Manifest V3) for browser tabs, web calls, and streaming audio. Captures tab audio, segments speech with client-side ML VAD, transcribes via Groq Whisper or local Whisper, translates with Google Gemini, Groq LLMs, or local WebGPU models, and renders live interactive subtitles in an on-page overlay.

---

### Why This Project Exists 💡

I built this extension because I couldn't find an existing browser tool or translation app that matched my specific needs: accurate real-time speech capture during calls/streams, flexible choice between fast cloud APIs and privacy-focused local models, and a non-intrusive floating overlay that stays out of the way.

Now that the core system is built and working, I've open-sourced it so that anyone looking for a similar solution can use it, adapt it to their own workflows, or help take it further.

> [!NOTE]
> ### Project Status: Beta 🧪
> The project is currently in **Beta**. The core pipeline (audio capture, VAD, Groq Whisper, and Gemini/Groq translation) is functional, but experimental capabilities—specifically **local on-device WebGPU LLM inference** and **speaker diarization**—are hardware-sensitive and may behave inconsistently depending on your GPU and Chrome version.
> 
> **Forks, bug reports, and pull requests are warmly welcome!** Feel free to use the project, customize it, or submit improvements.

---

## ✨ Features

### 🎙️ Audio & Transcription (ASR)
- **Tab Audio Capture**: Captures stream directly via `tabCapture` + Chrome Offscreen Document.
- **Client-Side VAD (Voice Activity Detection)**: Powered by Silero VAD (`@ricky0123/vad-web`) to segment speech cleanly at natural speech pauses (~300 ms silence detection).
- **Hybrid ASR Providers**:
  - **Cloud**: Groq Whisper (`whisper-large-v3`, `whisper-large-v3-turbo`) with exponential backoff retry.
  - **Local In-Browser**: ONNX Whisper Tiny / Base running locally in the browser via `@huggingface/transformers` (~97–147 MB).

### 🌐 Translation
- **Cloud Translation**:
  - **Google Gemini**: 2.5 / 3.x series models with automatic context window batching and retry fallback on 503 / 429 / 500 errors.
  - **Groq LLMs**: Qwen, Llama, and GPT-OSS models via Groq Chat Completions API.
  - Custom customizable system prompt with dynamic language injection (`{{source}}` / `{{target}}`).
- **Local On-Device Translation (Experimental)**:
  - WebGPU-accelerated local translation using `onnx-community/Qwen3-0.6B-ONNX` (~570 MB).
  - Built-in hardware compatibility check and one-click model downloader with progress tracking.

### 🖥️ Interactive On-Page Overlay
- **Draggable & Resizable Panel**: Rendered inside a Shadow DOM to prevent CSS conflicts with host websites.
- **Live Status Pulse & Audio Visualizer**: Real-time speech heartbeat pulse and visual audio equalizer.
- **Segment Interactions**: Click any segment to toggle between original transcript and translated text; one-click copy to clipboard.
- **Speaker Detection (Beta)**: Local speaker embeddings (WeSpeaker ResNet34) and online centroid clustering to distinguish participants.
- **Performance Analytics**: Real-time display of queue length, chunks processed, and average transcription/translation latency.

### ⚙️ Extension Controls & History
- **Global Hotkey Toggle**: `Ctrl+Shift+L` (macOS: `⌘⇧L`) to start/stop quickly during meetings.
- **Session History**: Persisted in IndexedDB (`idb`); search, review, resume, or export transcripts to `.txt`.
- **Intelligent Resource Management**: Auto-stop after 5 minutes of silence; prevents running on restricted pages (`chrome://`, Web Store).

---

## 🛠️ Tech Stack

| Category | Technology |
| -------- | ---------- |
| **Framework & Core** | React 19, TypeScript 5.9, Vite 8 |
| **Extension Platform** | Chrome Extension Manifest V3, `@crxjs/vite-plugin` |
| **Styling** | Tailwind CSS v4 |
| **ML & AI Runtime** | `@huggingface/transformers`, `@ricky0123/vad-web`, `onnxruntime-web` |
| **Storage** | `idb` (IndexedDB for session history), `chrome.storage.local` (settings) |
| **Cloud APIs** | Groq API (Whisper & Chat), Google Gemini API |

---

## 📐 Architecture Overview

```
┌─────────────────┐       hotkey / popup       ┌────────────────────────┐
│    Popup UI     │ ──────────────────────────▸│  Background Service   │
│   (App.tsx)     │                            │  Worker (background.ts)│
└─────────────────┘                            │  · TranslationQueue    │
                                               │  · Idle Watchdog       │
                                               └───────────┬────────────┘
                                                           │ streamId / LOCAL_*
                                               ┌───────────▼────────────┐
                                               │   Offscreen Document   │
                                               │   (offscreen.ts)       │
                                               │   · Tab Audio capture  │
                                               │   · Silero ML VAD      │
                                               │   · Local Whisper/LLM  │
                                               └───────────┬────────────┘
                                                           │ segments & results
                                               ┌───────────▼────────────┐
                                               │     Content Script     │
                                               │  · Shadow DOM Overlay  │
                                               │  · Live Translation UI │
                                               └────────────────────────┘
```

1. **Background Service Worker (`src/background.ts`)**: Orchestrates the translation lifecycle, validates keys/cache, manages idle timeouts, and runs the translation queue.
2. **Offscreen Document (`src/offscreen.ts`)**: Required by Chrome MV3 for `getUserMedia` and Web Audio API access. Runs VAD, audio chunking, and lazy-loaded WebGPU/WASM models.
3. **Content Script (`src/content.tsx`)**: Injects the floating draggable subtitle panel into a isolated Shadow DOM on the active tab.

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm** or **pnpm**
- **API Keys** (if using cloud features):
  - [Groq Console API Key](https://console.groq.com/keys) (for Whisper cloud ASR and Groq models)
  - [Google AI Studio API Key](https://aistudio.google.com/app/apikey) (for Gemini translation)
- **WebGPU Support** (optional, only needed for local on-device translation): A modern Chromium browser (Chrome 113+) and compatible GPU hardware.

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/vyacheslav-badaev/translator-helper.git
   cd translator-helper
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the extension:**
   ```bash
   npm run build
   ```
   *(For development with live-reloading, run `npm run dev`)*

4. **Load into Google Chrome:**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable **Developer mode** (toggle in the top-right corner)
   - Click **Load unpacked**
   - Select the `dist/` directory generated in the project root

---

## ⌨️ Available Scripts

```bash
npm run dev          # Start Vite dev server with CRX auto-reloading
npm run build        # Type-check and compile production bundle into dist/
npm run build:debug  # Build with verbose logging (debugWarn / debugLog enabled)
npm run lint         # Run ESLint validation
```

---

## ☕ Support & Donations

If this project saved you time, helped you during meetings, or served as a helpful reference for Chrome MV3 / WebAudio / WebGPU pipelines, consider buying me a coffee to support the project!

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Donate-yellow.svg?style=for-the-badge&logo=buy-me-a-coffee)](https://buymeacoffee.com/slavaadmdew)

- **Buy Me a Coffee**: [buymeacoffee.com/slavaadmdew](https://buymeacoffee.com/slavaadmdew)
- **Star on GitHub**: Giving the repository a ⭐ is also a great way to show support!

---

## 🤝 Contributing & Forking

Contributions, suggestions, and forks are very much appreciated! Whether you want to improve model integrations, optimize WebGPU pipelines, or improve the UI:

1. **Fork the Project** (`https://github.com/vyacheslav-badaev/translator-helper/fork`)
2. **Create your Feature Branch** (`git checkout -b feature/AmazingFeature`)
3. **Commit your Changes** (`git commit -m 'feat: add some AmazingFeature'`)
4. **Push to the Branch** (`git push origin feature/AmazingFeature`)
5. **Open a Pull Request**

Feel free to open an issue or reach out if you have ideas or want to collaborate!

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.
