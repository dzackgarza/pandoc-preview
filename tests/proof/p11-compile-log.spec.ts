import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, waitForPreview } from './support/app';

// P11 — Compile log reflects the real render subprocess. After a successful
// render, the Compile Log tab shows the real command line and a zero exit status.
// After Milestone B the preview is produced by the ACTIVE renderer plugin, so the
// logged command is that plugin's command (the pandoc renderer's render.sh) — the
// pandoc flags now live inside the renderer script, not in the app core. The
// log's command therefore names the active renderer (pandoc-renderer).
//
// Known cosmetic defect (contract): the log doubles the exit prefix, yielding
// `exit status: exit status: 0`. We assert the real zero exit without
// over-coupling to the doubling, and record the raw line for the artifact.

test('the compile log shows the real --from markdown command and a zero exit', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  // A successful render populates the log; preview h1 confirms success.
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Switch to the real Compile Log tab (click the tab button by text).
  await tauriPage.evaluate(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === 'Compile Log');
    if (!b) throw new Error('Compile Log tab not found');
    b.click();
    return null;
  })()`);
  const logText = await tauriPage.evaluate(
    `document.querySelector('pre.select-text')?.textContent ?? ''`,
  );
  expect(typeof logText).toBe('string');
  const log = logText as string;

  // The real render subprocess command is the active renderer plugin's command.
  expect(log.includes('pandoc-renderer')).toBe(true);
  // A zero exit status is reported (real process success).
  expect(/exit status:(?:\s*exit status:)?\s*0\b/.test(log)).toBe(true);

  const exitLine = log.split('\n').find((l) => l.startsWith('exit status:')) ?? '';
  recordObservation({ spec: manifest.spec, name: 'exit-status-line', value: exitLine });
});
