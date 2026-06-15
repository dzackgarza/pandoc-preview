import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd } from './support/app';

// True/false for "does the .cm-line containing `needle` carry the indentation-
// marker line decoration", or a diagnostic string if no such line is rendered.
async function lineHasIndentMarkers(
  page: { evaluate(expr: string): Promise<unknown> },
  needle: string,
): Promise<unknown> {
  return page.evaluate(`(() => {
    const lines = Array.from(document.querySelectorAll('.cm-editor .cm-content .cm-line'));
    const ln = lines.find((l) => l.textContent.includes(${JSON.stringify(needle)}));
    if (!ln) return 'no-line:' + ${JSON.stringify(needle)};
    return ln.classList.contains('cm-indent-markers');
  })()`);
}

// P35 — Indentation guides (Tier-0 line 28). The editor wires
// @replit/codemirror-indentation-markers, which decorates each indented line
// with the cm-indent-markers class (Decoration.line) so guide bars render in
// the leading whitespace. Owned interlock: the decoration tracks ACTUAL
// indentation — a deeply-indented line carries it, a zero-indent line does not.
// RED until the extension is added to the editor's extension set.

test('Indented lines render indentation guides; non-indented lines do not', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  // Wait until demo.md's async file-read -> setContent has actually populated
  // the buffer; appending before that lands races setContent, which would
  // overwrite the appended lines.
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-editor .cm-content')?.textContent ?? '').includes('Geometry of Numbers')`,
    15_000,
  );

  // Append a zero-indent line and an eight-column-indented line through the
  // real editor update pipeline.
  await appendAtEnd(tauriPage, "\n\nzeroindentline\n        eightspaceline\n");
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('.cm-editor .cm-content .cm-line')).some((l) => l.textContent.includes('eightspaceline'))`,
    15_000,
  );

  // The indented line carries indentation guides.
  expect(await lineHasIndentMarkers(tauriPage, "eightspaceline")).toBe(true);

  // The heading (column 0) does not — the decoration reflects real indentation,
  // not a blanket applied to every line.
  expect(await lineHasIndentMarkers(tauriPage, "Geometry of Numbers")).toBe(false);

  recordObservation({ spec: manifest.spec, name: 'indentation-guides', value: 1 });
});
