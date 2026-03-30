# Antigravity Rules for MyTranslateHelper

## Project Overview

Real-time audio translation Chrome Extension using Groq Whisper (ASR) and Google Gemini (Translation).

## Strict Language Rule

- **ALL** code, comments, documentation, and commit messages MUST be in **English**.

## Coding Standards

- **Language Protocol**:
  - Comments/Code/Docs: **STRICTLY English**.
  - All project files must be in English.
- **TypeScript**: Use strict TypeScript. Define interfaces for all message payloads in `src/types/messages.ts`.
- **React**: Use functional components and hooks. React 19 is used, so ensure compatibility.
- **Safety**:
  - Never hardcode API keys.
  - Always use `sessionId` to guard async loops in `offscreen.ts` and `translationQueue.ts` to prevent stale processing after the pipeline stops.
- **Modularization**: Keep background logic split (e.g., `offscreenManager.ts`, `stateManager.ts`, `idleTimer.ts`).

## File Structure Conventions

- `src/background/`: Orchestrator logic split by responsibility (Timer, State, Manager).
- `src/content/components/`: Pure UI components injected into Shadow DOM.
- `src/utils/`: Core processing logic (Batching, Sentence Segmentation).

## Design System

- Theme: Dark / Deep Blue / Vibrant Green (#10b981).
- Animation: `tp-pulse` for speech, `tp-eq` for audio visualization.
- Layout: Draggable and resizable panel with viewport clamping.
