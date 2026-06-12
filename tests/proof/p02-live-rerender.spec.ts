import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, previewQuery, waitForPreview } from './support/app';

const SENTENCE = 'The discriminant equals −163.';

// P2 — Live re-render. After the witness renders, type a new sentence at the
// buffer end through the REAL editor. The sentence is absent from the
// preview before the edit and present verbatim after the configured debounce
// elapses (the app re-invokes real pandoc). A frozen preview fails this.

test('typing at the buffer end re-renders the preview with the new sentence', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // The sentence must be absent before the edit.
  const before = await previewQuery(
    tauriPage,
    `return d.body.textContent.includes(${JSON.stringify(SENTENCE)});`,
  );
  expect(before).toBe(false);

  // Append at the buffer end through the real editor update pipeline. This
  // fires the same docChanged -> scheduleRender(debounce) -> real pandoc
  // path that user typing fires.
  await appendAtEnd(tauriPage, `\n\n${SENTENCE}`);

  // After the configured debounce + real render, the sentence is present.
  await waitForPreview(
    tauriPage,
    `return d.body.textContent.includes(${JSON.stringify(SENTENCE)});`,
  );

  const after = await previewQuery(
    tauriPage,
    `return d.body.textContent.includes(${JSON.stringify(SENTENCE)});`,
  );
  expect(after).toBe(true);

  recordObservation({ spec: manifest.spec, name: 'sentence', value: SENTENCE });
});
