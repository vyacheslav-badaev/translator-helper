/**
 * Debug logging utility.
 *
 * All log calls are compiled away in production builds (tree-shaken as dead code).
 * To enable debug output, build with:
 *   npm run build:debug
 *
 * This sets the `__DEBUG__` global to `true` via Vite's `define` option.
 * In a normal `npm run build`, `__DEBUG__` is `false` and all log calls become no-ops
 * that are removed by the minifier.
 */

/** Compile-time flag injected by Vite define config. */
declare const __DEBUG__: boolean;

/** Prefix used in all debug messages for easy filtering in DevTools. */
const TAG = '[Translator]';

/**
 * Logs an informational debug message to the console.
 * Only produces output when `__DEBUG__` is `true`.
 */
export function debugLog(context: string, message: string, ...data: unknown[]): void {
  if (__DEBUG__) {
    console.log(`${TAG}[${context}]`, message, ...data);
  }
}

/**
 * Logs a warning debug message to the console.
 * Only produces output when `__DEBUG__` is `true`.
 */
export function debugWarn(context: string, message: string, ...data: unknown[]): void {
  if (__DEBUG__) {
    console.warn(`${TAG}[${context}]`, message, ...data);
  }
}

/**
 * Logs an error message to the console.
 * Always active — errors are logged in both debug and production builds.
 */
export function debugError(context: string, message: string, ...data: unknown[]): void {
  console.error(`${TAG}[${context}]`, message, ...data);
}
