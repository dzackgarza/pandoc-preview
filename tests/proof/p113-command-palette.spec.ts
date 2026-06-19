import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openProject, clickSidebarEntry, currentFile, sleep } from './support/app';

// ── P113 — P104 (Phase E / E3): the command palette (Ctrl+Shift+P) and quick-open
//          (Ctrl+P), delivered behind the plugin firewall ──────────────────────
//
// THE OBLIGATION (proof-obligations.md, P104 — verbatim intent):
//   Ctrl+Shift+P opens the COMMAND PALETTE — a firewall picker fed the app's
//   command catalog — and SELECTING the "Fold All" command actually FOLDS the
//   buffer: an INDEPENDENT observation of the editor's folded ranges shows the
//   buffer folded after the selection, proving the palette RUNS the selected
//   command, not merely lists it. Separately, Ctrl+P opens the QUICK-OPEN file
//   finder — a firewall picker over the workspace files, NOT the command palette —
//   and SELECTING a workspace file OPENS that file in the editor (the editor's
//   active document becomes the selected file, read independently of the app's own
//   report).
//
//   Admissible because it fails on: Ctrl+P opening the COMMAND PALETTE (the
//   un-fixed binding transposition — Ctrl+P must be quick-open, not the palette);
//   a palette that LISTS commands but where running the selection is a NO-OP (the
//   "Fold All" selection is offered but nothing folds); and a quick-open that
//   LISTS files but whose SELECTION does NOT open the file (a file is offered but
//   selecting it leaves the editor on the previous document).
//
//   It is NOT satisfied by an assertion that a palette / quick-open surface merely
//   EXISTS or LISTS its entries — a picker that surfaces commands/files but whose
//   selection never folds the buffer / never opens the file would pass an
//   existence-or-listing check while failing the run-the-selection clauses above.
//
// ── WHY THE WIRING IS PROVEN THROUGH A REAL FIREWALL PICKER PLUGIN ─────────────
// fzf is an interactive TUI undriveable headless (the same constraint as the D-7
// diagram-tool GUI launch, P96/p106). So the WIRING is proven through the REAL
// plugin firewall by a REAL picker plugin (tests/proof/fixtures/plugins/
// recording-picker, exercising the REAL firewall — NOT a mock in app logic) whose
// pick step is SCRIPTED to RETURN a deterministic selection: the app feeds the
// candidate list (the palette command catalog / the workspace file list) to the
// picker on stdin through the generic firewall, and the picker emits the
// config-configured choice on stdout (it reads a config-declared selection file —
// `[plugin.recording-picker].selection_file` — and returns the first stdin
// candidate whose token matches a configured token). The real fzf picker is the
// production UI; this fixture substitutes the non-interactive selection-returning
// plugin via config. The app then RUNS the returned command / OPENS the returned
// file. The DECISIVE observable is the buffer ACTUALLY FOLDING (the palette ran
// the command) and the selected file ACTUALLY OPENING (quick-open ran the
// selection) — read INDEPENDENTLY of the app's own report — never that the picker
// listed them.
//
// ── THE DETERMINISTIC SELECTION (provision-proof.sh, the p113 branch) ──────────
//   $CONFIG_DIR/picker-selection — one configured token per line:
//     fold_all              the COMMAND PALETTE choice (the "Fold All" command id)
//     <project>/demo.md     the QUICK-OPEN choice (a workspace file DIFFERENT from
//                           the outline.md this proof opens first)
//   The palette candidate set carries `fold_all` and never a file path; the
//   quick-open candidate set carries the file path and never `fold_all`; so the
//   one selection file deterministically yields the correct pick for each surface
//   from the candidate set the app actually fed through the firewall.
//
// ── THE OBSERVABLE CONTRACT (real keybindings + independent observables) ───────
// This spec is BLIND to how the bindings, the firewall picker invocation, and the
// run/open dispatch are wired. It fires the REAL window keybindings (the p40
// precedent — a real `keydown`), and reads the decisive state off independent
// observables already in the harness:
//   __PPE_E2E__.getFoldedRanges(): the live CM6 folded ranges (p40/p42 precedent)
//     — the INDEPENDENT proof the palette ran "Fold All".
//   __PPE_E2E__.currentFile(): the editor's active document path (p06/p49
//     precedent) — the INDEPENDENT proof quick-open opened the picked file.
//
// ── WHAT EACH ASSERTION KILLS ─────────────────────────────────────────────────
//   (PALETTE)   Ctrl+Shift+P with the picker configured to select Fold All folds
//        the buffer (getFoldedRanges becomes non-empty). KILLS a palette that
//        lists commands but whose selection is a NO-OP (nothing folds), and an app
//        with no Ctrl+Shift+P firewall palette at all.
//   (QUICK-OPEN) Ctrl+P with the picker configured to select demo.md makes the
//        editor's active document become demo.md. KILLS Ctrl+P opening the COMMAND
//        PALETTE (the un-fixed transposition — the active file would stay
//        outline.md), and a quick-open that lists files but whose selection does
//        NOT open the file (the active file stays outline.md).
//
// RED today: Ctrl+P still opens the OLD app-owned CommandPaletteModal (the
// un-fixed binding transposition) and there is no Ctrl+Shift+P firewall palette,
// no quick-open, and no recording-picker wiring — so Ctrl+Shift+P never folds the
// buffer (no firewall palette runs the selection) and Ctrl+P does not open the
// picked file (it opens the app palette / leaves outline.md active). The failure
// is the MISSING new behaviour, not a boot/setup error: the app, project, and
// editor are all brought up and outline.md opened FIRST, with the fold state
// confirmed empty before any palette is invoked.

const FIRST_FILE = 'outline.md';
const QUICK_OPEN_FILE = 'demo.md';

async function pressCtrlShiftP(page: { evaluate(e: string): Promise<unknown> }): Promise<void> {
  await page.evaluate(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    return null;
  })()`);
}

async function pressCtrlP(page: { evaluate(e: string): Promise<unknown> }): Promise<void> {
  await page.evaluate(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', ctrlKey: true, bubbles: true, cancelable: true }));
    return null;
  })()`);
}

async function foldCount(page: { evaluate(e: string): Promise<unknown> }): Promise<number> {
  const raw = await page.evaluate(`JSON.stringify(window.__PPE_E2E__.getFoldedRanges())`);
  return (JSON.parse(raw as string) as unknown[]).length;
}

test('Ctrl+Shift+P firewall palette runs Fold All (buffer folds); Ctrl+P quick-open opens the picked file', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // The app + project + editor must be alive first, so a later failure is the
  // missing new behaviour, not a boot/setup error. Open outline.md (a foldable
  // buffer, the p40/p42 witness) and confirm its content is loaded.
  await openProject(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('.grow.overflow-auto.p-1 button span:last-child')).some((s) => s.textContent.trim() === ${JSON.stringify(FIRST_FILE)})`,
    15_000,
  );
  await clickSidebarEntry(tauriPage, FIRST_FILE);
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-editor .cm-content')?.textContent ?? '').includes('Section One')`,
    15_000,
  );

  // Baseline: nothing folded, and outline.md is the active document. A pre-folded
  // buffer or a wrong active file would make the post-palette observation
  // meaningless.
  expect(await foldCount(tauriPage)).toBe(0);
  expect(await currentFile(tauriPage)).toContain(FIRST_FILE);

  // ── (PALETTE) Ctrl+Shift+P opens the COMMAND PALETTE — the firewall picker fed
  // the command catalog — and, with the picker configured to select Fold All, the
  // buffer ACTUALLY FOLDS. The firewall run (feed catalog -> picker returns
  // `fold_all` -> app runs the command) is async, so poll the INDEPENDENT
  // folded-ranges observation. RED today: there is no Ctrl+Shift+P firewall
  // palette, so nothing folds and this wait times out.
  await pressCtrlShiftP(tauriPage);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getFoldedRanges().length > 0`,
    15_000,
  );
  // Fold All collapses EVERY foldable range, not just the top level: outline.md
  // has 2 headings and 2 fenced divs, so all 4 fold (the p40 witness count).
  expect(await foldCount(tauriPage)).toBe(4);

  // ── (QUICK-OPEN) Ctrl+P opens the QUICK-OPEN file finder — the firewall picker
  // over the workspace files, NOT the command palette — and, with the picker
  // configured to select demo.md, that file ACTUALLY OPENS: the editor's active
  // document becomes demo.md. The firewall run (feed file list -> picker returns
  // the demo.md path -> app opens it) is async, so poll the INDEPENDENT
  // currentFile observation. RED today: Ctrl+P opens the OLD app palette (the
  // un-fixed transposition), so the active document stays outline.md and this wait
  // times out.
  await pressCtrlP(tauriPage);
  await tauriPage.waitForFunction(
    `(window.__PPE_E2E__.currentFile() ?? '').endsWith('/${QUICK_OPEN_FILE}')`,
    15_000,
  );
  const opened = await currentFile(tauriPage);
  expect(opened).toContain(QUICK_OPEN_FILE);
  expect(opened).not.toContain(FIRST_FILE);

  // Settle so the recorded observation reflects the final active document.
  await sleep(100);
  recordObservation({ spec: manifest.spec, name: 'p113-palette-fold', value: 4 });
  recordObservation({ spec: manifest.spec, name: 'p113-quickopen', value: opened });
});
