import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import tailwindcss from '@tailwindcss/vite';

import { viteStaticCopy } from 'vite-plugin-static-copy';

// Debug mode: set via `VITE_DEBUG=true` env variable.
// When false, all debugLog/debugWarn calls are tree-shaken out of production bundle.
const isDebug = process.env.VITE_DEBUG === 'true';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    crx({ manifest }),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js',
          dest: '.',
          rename: { stripBase: true }
        },
        {
          src: 'node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx',
          dest: '.',
          rename: { stripBase: true }
        },
        {
          src: 'node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx',
          dest: '.',
          rename: { stripBase: true }
        },
        {
          src: 'node_modules/onnxruntime-web/dist/*.wasm',
          dest: '.',
          rename: { stripBase: true }
        },
        {
          src: 'node_modules/onnxruntime-web/dist/*.mjs',
          dest: '.',
          rename: { stripBase: true }
        },
        // @huggingface/transformers pins its own onnxruntime-web build, whose
        // WASM binaries differ from the top-level version used by the speaker
        // embedder. Isolate them in a subfolder to avoid filename clobbering.
        {
          src: 'node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/*.wasm',
          dest: 'transformers',
          rename: { stripBase: true }
        },
        {
          src: 'node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded*.mjs',
          dest: 'transformers',
          rename: { stripBase: true }
        }
      ]
    })
  ],
  define: {
    __DEBUG__: JSON.stringify(isDebug)
  },
  build: {
    rollupOptions: {
      // Include offscreen.html as an additional entry so it gets bundled.
      // CRXJS only auto-detects pages listed in the manifest (popup, options, etc.)
      // but offscreen documents are created dynamically via chrome.offscreen API.
      input: {
        offscreen: resolve(__dirname, 'offscreen.html')
      }
    }
  }
});
