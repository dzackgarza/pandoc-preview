import { createTauriTest } from '@srsholmes/tauri-playwright';

// Real-webview proof fixture. No browser mode, no IPC mocks: the proof
// drives the REAL app through the plugin socket on a REAL display.
//
// mcpSocket must equal PLAYWRIGHT_SOCKET in src-tauri/src/lib.rs. If they
// diverge the socket wait times out and the proof fails loudly.
//
// scripts/proof-run.sh owns the app + vite lifecycle (process-group kills
// the library cannot do), so there is no tauriCommand/tauriCwd here.
//
// No devUrl: Tauri already loads the frontend at the dev URL, and the
// fixture's devUrl path re-assigns window.location.href, which reloads the
// real webview mid-eval and loses the eval reply (30s timeout). Omitting it
// connects straight to the already-loaded, plugin-instrumented page.
export const { test, expect } = createTauriTest({
  mcpSocket: '/tmp/pandoc-preview-playwright.sock',
});
