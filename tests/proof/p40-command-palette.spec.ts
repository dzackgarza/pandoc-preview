import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openProject, clickSidebarEntry } from './support/app';

// ── P40 — MIGRATED to P104 (Phase E / E3): the command palette moved to
//          Ctrl+Shift+P, behind the plugin firewall ────────────────────────────
//
// p40 historically asserted the OLD behaviour: Ctrl+P opened an app-owned
// CommandPaletteModal whose "Fold All" / "Unfold All" buttons drove the editor's
// fold commands. E3 FIXES that — Ctrl+P is VSCode's quick-open (proven in p113),
// and the command palette moves to Ctrl+Shift+P, delivered behind the plugin
// firewall (the OS-integration-as-plugin doctrine), with CommandPaletteModal.svelte
// DELETED. p40's underlying proof burden — that the palette RUNS a fold COMMAND
// against the REAL editor (not merely renders a modal) — is TRANSFERRED here to
// the corrected surface: this spec now proves the Ctrl+Shift+P firewall palette
// runs "Unfold All", the complement of p113's "Fold All" leg, so the two specs
// together prove BOTH fold commands run through the new firewall palette.
//
// ── THE FIREWALL PICKER (the headless stand-in for fzf) ────────────────────────
// fzf is an interactive TUI undriveable headless, so the WIRING is proven through
// the REAL plugin firewall by the REAL recording-picker plugin (NOT a mock in app
// logic) whose pick step returns a config-configured deterministic selection on
// stdout — here `unfold_all` (the catalog id of "Unfold All"; provision-proof.sh,
// the p40 branch). The app feeds the command catalog to the picker through the
// firewall, the picker returns the `unfold_all` line, and the app RUNS it — the
// pre-folded buffer ACTUALLY UNFOLDS, proving the palette RUNS the selection, not
// merely lists it.
//
// ── THE OBSERVABLE CONTRACT (real keybinding + independent fold observation) ───
// BLIND to how the binding / firewall picker / run dispatch are wired. Fires the
// REAL Ctrl+Shift+P window keydown and reads the editor's folded ranges off the
// independent harness observable (p42 precedent):
//   __PPE_E2E__.foldAll(): collapse every foldable range (the move PRIMITIVE used
//     ONLY to PLACE the buffer in the folded start state, never the action under
//     test).
//   __PPE_E2E__.getFoldedRanges(): the live CM6 folded ranges — the INDEPENDENT
//     proof the palette ran "Unfold All".
//
// ── WHAT THIS KILLS ───────────────────────────────────────────────────────────
//   Ctrl+Shift+P with the picker configured to select Unfold All unfolds the
//   PRE-FOLDED buffer (folded ranges return to empty). KILLS a palette that lists
//   commands but whose selection is a NO-OP (the buffer stays folded), and an app
//   with no Ctrl+Shift+P firewall palette at all (the pre-fold persists).
//
// RED today: there is no Ctrl+Shift+P firewall palette and no recording-picker
// wiring, so firing Ctrl+Shift+P never runs Unfold All and the pre-folded buffer
// stays folded — this wait times out. The failure is the MISSING new behaviour,
// not a boot/setup error: the app, project, and editor are brought up, outline.md
// opened, and the buffer folded FIRST, with the folded state confirmed non-empty
// before the palette is invoked.

const WITNESS_FILE = 'outline.md';

async function pressCtrlShiftP(page: { evaluate(e: string): Promise<unknown> }): Promise<void> {
  await page.evaluate(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    return null;
  })()`);
}

async function foldCount(page: { evaluate(e: string): Promise<unknown> }): Promise<number> {
  const raw = await page.evaluate(`JSON.stringify(window.__PPE_E2E__.getFoldedRanges())`);
  return (JSON.parse(raw as string) as unknown[]).length;
}

test('Ctrl+Shift+P firewall palette runs Unfold All (pre-folded buffer unfolds)', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openProject(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('.grow.overflow-auto.p-1 button span:last-child')).some((s) => s.textContent.trim() === ${JSON.stringify(WITNESS_FILE)})`,
    15_000,
  );
  await clickSidebarEntry(tauriPage, WITNESS_FILE);
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-editor .cm-content')?.textContent ?? '').includes('Section One')`,
    15_000,
  );

  // PLACE the buffer in the folded start state via the fold PRIMITIVE, and CONFIRM
  // it independently — the known start the Unfold All command must reverse.
  expect(await foldCount(tauriPage)).toBe(0);
  await tauriPage.evaluate(`(() => { window.__PPE_E2E__.foldAll(); return null; })()`);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getFoldedRanges().length > 0`,
    10_000,
  );
  // outline.md has 2 headings + 2 fenced divs -> all 4 fold.
  expect(await foldCount(tauriPage)).toBe(4);

  // Ctrl+Shift+P opens the firewall command palette; with the picker configured to
  // select Unfold All, the pre-folded buffer ACTUALLY UNFOLDS. The firewall run
  // (feed catalog -> picker returns `unfold_all` -> app runs it) is async, so poll
  // the INDEPENDENT folded-ranges observation. RED today: no Ctrl+Shift+P firewall
  // palette, so nothing unfolds and this wait times out.
  await pressCtrlShiftP(tauriPage);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getFoldedRanges().length === 0`,
    15_000,
  );
  expect(await foldCount(tauriPage)).toBe(0);

  recordObservation({ spec: manifest.spec, name: 'command-palette-unfold', value: 1 });
});
