import type { MockHostApi } from '../../src/webview/dev/mockHost';

// The dev mock host (src/webview/dev/mockHost.ts) attaches __mockHost to window;
// declaring it here lets the browser tests reach it without an `as` cast.
declare global {
  interface Window {
    __mockHost?: MockHostApi;
  }
}
