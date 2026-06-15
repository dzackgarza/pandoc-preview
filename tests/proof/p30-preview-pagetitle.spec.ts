import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, previewQuery, waitForPreview } from './support/app';

// P30 — Preview document <title> (pagetitle). A standalone HTML preview with an
// empty <title> makes pandoc warn ("This document format requires a nonempty
// <title> element. Defaulting to '-'") on EVERY render — confusing compile-log
// noise. The renderer sets --metadata pagetitle to the document's containing
// folder name (render.sh receives base_dir, the open file's directory), which
// fills the HTML <title> and silences the warning. pagetitle is distinct from the
// document's own title metadata, so a title the document declares is NOT clobbered.
//
// The hermetic project dir is named "project" (provision-proof copies the witness
// fixture there), so the preview document.title must be exactly that.

test('the preview document title is the containing folder name', async ({ tauriPage }) => {
  const manifest = loadRunManifest();
  await openAndSelectDemo(tauriPage, manifest.project);

  // Wait until the preview has rendered real content (demo.md's H1), then read
  // the iframe document's <title>.
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  const title = await previewQuery(tauriPage, `return d.title;`);
  expect(title).toBe('project');

  recordObservation({ spec: manifest.spec, name: 'preview-title', value: String(title) });
});
