import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import tailwindcss from '@tailwindcss/vite';

// Debug mode: set via `VITE_DEBUG=true` env variable.
// When false, all debugLog/debugWarn calls are tree-shaken out of production bundle.
const isDebug = process.env.VITE_DEBUG === 'true';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
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
