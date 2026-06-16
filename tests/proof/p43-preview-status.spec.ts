import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, waitForPreview, appendAtEnd } from './support/app';

const SENTENCE = 'Stale-preview sentinel 2718.';

// P43 — Preview status indicator. The preview pane must show when the preview is
// stale relative to the source, when it is actively recompiling, and when it is
// up to date. Editing the source through the real editor pipeline drives the
// real render, so the indicator transitions are observed end-to-end: the DOM
// shows "Out of date" right after the edit and "Up to date" once pandoc lands,
// and the recorded transition sequence proves stale -> rendering -> ok in order.

test('preview indicator: edit marks Out of date, then Recompiling, then Up to date', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();
  const statusEl = `document.querySelector('[data-testid="render-status"]')`;

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.renderStatus() === 'ok'`,
    15_000,
  );

  // After the initial render the indicator reads up to date.
  expect(await tauriPage.evaluate(`${statusEl}.dataset.status`)).toBe('ok');
  expect(await tauriPage.evaluate(`${statusEl}.textContent.trim()`)).toContain(
    'Up to date',
  );

  // The sentence is absent until the edit lands (guards against a frozen preview).
  const before = await tauriPage.evaluate(
    `(() => { const f = document.querySelector('iframe'); const d = f.contentDocument; return d.body.textContent.includes(${JSON.stringify(SENTENCE)}); })()`,
  );
  expect(before).toBe(false);

  // Edit the source through the real CM update pipeline (docChanged ->
  // scheduleRender(debounce) -> real pandoc), exactly as user typing does.
  await appendAtEnd(tauriPage, `\n\n${SENTENCE}`);

  // Within the debounce window the indicator flips to "Out of date" (stale):
  // the source diverged from the shown preview. Asserted on the real DOM.
  await tauriPage.waitForFunction(
    `${statusEl}?.dataset.status === 'stale'`,
    5_000,
  );
  expect(await tauriPage.evaluate(`${statusEl}.textContent.trim()`)).toContain(
    'Out of date',
  );

  // After the real render the new text is present and the indicator returns to
  // up to date.
  await waitForPreview(
    tauriPage,
    `return d.body.textContent.includes(${JSON.stringify(SENTENCE)});`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.renderStatus() === 'ok'`,
    15_000,
  );
  expect(await tauriPage.evaluate(`${statusEl}.textContent.trim()`)).toContain(
    'Up to date',
  );

  // The edit's transition sequence is exactly stale -> rendering -> ok: the
  // Out-of-date, Recompiling, and Up-to-date indicators each fired, in order.
  // Sliced from the edit's stale marker so initial open-time renders cannot
  // pollute the assertion.
  const history = JSON.parse(
    (await tauriPage.evaluate(
      `JSON.stringify(window.__PPE_E2E__.statusHistory())`,
    )) as string,
  ) as string[];
  const tail = history.slice(history.lastIndexOf('stale'));
  expect(tail).toEqual(['stale', 'rendering', 'ok']);

  recordObservation({
    spec: manifest.spec,
    name: 'status-sequence',
    value: tail.join('>'),
  });
});
