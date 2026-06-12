import { defineConfig } from '@playwright/test';

// The proof boundary: ONE project (tauri mode, real webview), serial,
// halt on first failure. No webServer block — scripts/proof-run.sh owns the
// vite server and the app process lifecycle.
export default defineConfig<{ mode: string }>({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  maxFailures: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 120_000,
  reporter: [['list'], ['./support/proof-artifact-reporter.ts']],
  projects: [
    {
      name: 'tauri',
      use: {
        mode: 'tauri',
        trace: 'off',
        screenshot: 'off',
      },
    },
  ],
});
