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
  // Phase F PDF-compile specs (p116/p118/p119/p120) drive REAL lualatex / latexmk
  // multi-pass builds in-app; a single spec performs several sequential compiles
  // (p119: a FAST single-pass, a FULL latexmk multi-pass, a MANUAL FULL recompile,
  // then an AUTO FAST recompile) whose internal waits are 180–300s each. The
  // per-test budget must exceed the sum of those real compiles, so it is set above
  // the spec's worst-case internal waits.
  timeout: 600_000,
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
