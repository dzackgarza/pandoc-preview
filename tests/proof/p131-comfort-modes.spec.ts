import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { parseTomlFile } from './support/toml';
import {
  openAndSelectDemo,
  appendAtEnd,
  waitForHarness,
  waitForPreview,
  sleep,
} from './support/app';
import { sidebarPresent } from './support/layout';

// P131 (Phase H / H.1) — DISTRACTION-FREE / TYPEWRITER / READABILITY comfort modes.
//
// RESEARCH-FIRST: these are EDITOR-PRESENTATION comfort modes realized as the
// established CM6 `Compartment` + post-mount-reconfigure machinery P54 spellcheck
// uses (EditorPane.svelte: spellCompartment/lintCompartment are the precedent),
// PLUS an App-shell CSS state — NOT a new editor engine:
//   (a) TYPEWRITER keeps the caret line vertically CENTERED in the editor
//       viewport, the published CM6 typewriter-scrolling recipe
//       (EditorView.scrollMargins / scroll-into-view centering), reconfigured
//       through a `typewriterCompartment` next to the existing spellCompartment.
//   (b) DISTRACTION-FREE is an App-shell CSS state driven from App.svelte (a
//       `viewComfort` $state toggling a shell class) that HIDES the chrome — the
//       ActivityBar / sidebar, the InsertionBar, and the StatusBar — NOT editor
//       infra.
//   (c) READABILITY is a thin CM6 `Decoration` layer coloring SENTENCE spans over
//       the visible prose, reconfigured through a `readabilityCompartment`,
//       respecting the SAME math/code exclusion predicate the fork exposes — NOT a
//       new engine. Each marked sentence carries the STABLE contract class
//       `cm-ppe-readability` (the sibling of spellcheck's `cm-spellError`), the
//       observable this spec asserts in the real `.cm-content` DOM.
//
// All three are config-owned booleans in an `[editor.comfort]` sub-table
// ({distraction_free, typewriter, readability}, all FALSE by default), validated
// at load and round-tripped through the XDG TOML by `save_config` (the P9
// invariant). Each toggle flips its boolean and persists it.
//
// THE IMPLEMENTATION-BLIND HARNESS CONTRACT the GREEN must satisfy (only the
// observables matter — never how the modes are wired):
//
//   __PPE_E2E__.setComfort(mode: 'distractionFree'|'typewriter'|'readability',
//                          on: boolean)
//     Toggles the named comfort mode ON/OFF through the SAME path the
//     `comfort:distraction-free` / `comfort:typewriter` / `comfort:readability`
//     command-palette entries run — reconfiguring the corresponding CM6
//     Compartment (typewriter/readability) or flipping the App-shell
//     distraction-free CSS state, AND persisting the boolean to the config-owned
//     [editor.comfort] sub-table (the P9 round-trip). Fire-and-forget; the spec
//     awaits the resulting editor geometry / chrome visibility / decoration DOM /
//     on-disk config.
//
//   __PPE_E2E__.comfortState(): { distractionFree, typewriter, readability }
//     The live booleans the three modes hold, read straight off the app state the
//     config seeds and setComfort mutates.
//
// WHAT THIS SPEC PROVES (the four P120 clauses, on REAL surfaces):
//   (1) TYPEWRITER CENTERS. With typewriter OFF, the caret line placed deep in a
//       tall buffer sits LOW in the editor viewport (near its bottom, NOT
//       centered). Toggling typewriter ON moves the caret line into a CENTERED
//       band near the viewport mid-height — a materially different, centered
//       position. Measured directly off the rendered `.cm-activeLine` and the
//       `.cm-scroller` viewport, independently of any app report.
//   (2) DISTRACTION-FREE HIDES CHROME. With the mode OFF, the ActivityBar/sidebar,
//       the InsertionBar, and the StatusBar are all VISIBLE in the DOM. Toggling
//       distraction-free ON hides ALL THREE (absent / not laid out); toggling OFF
//       restores all three.
//   (3) READABILITY MARKS. With the mode OFF, the `.cm-content` carries NO
//       `cm-ppe-readability` sentence-decoration marks. Toggling readability ON
//       makes visible sentence-decoration marks (`.cm-ppe-readability`) appear in
//       the real `.cm-content` DOM.
//   (4) ROUND-TRIP. After enabling the modes, the chosen [editor.comfort] booleans
//       round-trip to the on-disk config.toml under the hermetic XDG_CONFIG_HOME
//       (the P9 class), read back by an INDEPENDENT process (python tomllib) — so
//       the enabled modes survive persistence and are STILL active on relaunch.
//
// ADMISSIBLE because it FAILS on a plausibly broken app:
//   - NO comfort extensions: `__PPE_E2E__.setComfort` does not exist -> the
//     evaluate throws (every clause is gated behind a setComfort call). A typewriter
//     that does not center leaves the caret low (clause 1); a distraction-free that
//     leaves the chrome visible fails clause 2; a readability that emits no
//     `cm-ppe-readability` marks fails clause 3.
//   - NON-PERSISTED toggle: the enabled modes never reach the on-disk
//     [editor.comfort] table (clause 4 — the modes would reset after relaunch, the
//     P9 round-trip class the obligation names).
//   - An existence-only `setComfort`/`comfortState` symbol passes NONE of
//     clauses 1-4, which measure the REAL caret geometry, the REAL chrome
//     visibility, the REAL decoration DOM, and the REAL on-disk config — never the
//     mere presence of a hook.
//
// RED EXPECTATION today: there are NO comfort modes. EditorPane.svelte has no
// typewriter/readability Compartment, App.svelte exposes no `viewComfort` shell
// state and no `setComfort`/`comfortState` on `__PPE_E2E__`, and config.rs has no
// `[editor.comfort]` table. The app BOOTS cleanly (the canonical config carries no
// comfort table, so there is no config-schema error), the project opens, demo.md
// renders (<h1> present), the caret line is measurable, and the chrome
// (ActivityBar/sidebar + InsertionBar + StatusBar) is all VISIBLE — so the FIRST
// `window.__PPE_E2E__.setComfort('typewriter', true)` THROWS because the hook is
// absent. The failure is the MISSING comfort feature, never a boot or
// config-schema error.

// A tall block appended so the buffer exceeds the editor viewport height and is
// genuinely scrollable — a precondition for centering to be observable (a caret
// line in a short, fully-visible buffer cannot move from "low" to "centered").
const FILLER_LINES = 80;
const FILLER = Array.from(
  { length: FILLER_LINES },
  (_, i) => `Sentence number ${i + 1} of the comfort filler prose. It is plain text.`,
).join('\n');

// The stable contract class the readability sentence-decoration layer marks each
// sentence span with — the sibling of spellcheck's `cm-spellError`.
const READABILITY_MARK_CLASS = 'cm-ppe-readability';

async function setComfort(
  page: { evaluate(expr: string): Promise<unknown> },
  mode: 'distractionFree' | 'typewriter' | 'readability',
  on: boolean,
): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.setComfort(${JSON.stringify(mode)}, ${JSON.stringify(on)}); return null; })()`,
  );
}

// The caret line's vertical center as a FRACTION of the editor scroll-viewport
// height (0 = top of the viewport, 1 = bottom). Read directly off the rendered
// `.cm-activeLine` (CM6's highlightActiveLine marks the cursor's line) relative to
// the `.cm-scroller` viewport — the app's own report is never trusted.
async function caretViewportFraction(page: {
  evaluate(expr: string): Promise<unknown>;
}): Promise<number> {
  const raw = await page.evaluate(`(() => {
    const scroller = document.querySelector('.cm-editor .cm-scroller');
    const active = document.querySelector('.cm-editor .cm-content .cm-activeLine');
    if (!scroller || !active) return null;
    const sr = scroller.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    if (sr.height <= 0) return null;
    const caretCenterY = (ar.top + ar.bottom) / 2;
    return (caretCenterY - sr.top) / sr.height;
  })()`);
  if (typeof raw !== 'number') {
    throw new Error(`caretViewportFraction returned non-number: ${JSON.stringify(raw)}`);
  }
  return raw;
}

// Whether a chrome marker element is VISIBLE (present, laid out, non-zero box) —
// the same visibility discipline `sidebarPresent` uses: a display:none element has
// a null offsetParent, and a zero-box element is not shown.
async function chromeVisible(
  page: { evaluate(expr: string): Promise<unknown> },
  selector: string,
): Promise<boolean> {
  const visible = await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    if (el.offsetParent === null) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  })()`);
  if (typeof visible !== 'boolean') {
    throw new Error(`chromeVisible(${selector}) returned non-boolean: ${JSON.stringify(visible)}`);
  }
  return visible;
}

// The count of readability sentence-decoration marks in the real `.cm-content`
// DOM — spans carrying the stable contract class. Zero when the layer is OFF.
async function readabilityMarkCount(page: {
  evaluate(expr: string): Promise<unknown>;
}): Promise<number> {
  const raw = await page.evaluate(
    `document.querySelectorAll('.cm-editor .cm-content .${READABILITY_MARK_CLASS}').length`,
  );
  if (typeof raw !== 'number') {
    throw new Error(`readabilityMarkCount returned non-number: ${JSON.stringify(raw)}`);
  }
  return raw;
}

// The InsertionBar's stable markers (env buttons), the ActivityBar's stable
// markers (view buttons), and the StatusBar's word-count span. These are the
// per-region chrome observables the distraction-free state hides.
const INSERTION_BAR_MARKER = '[data-insert-env]';
const ACTIVITY_BAR_MARKER = '[data-view]';

// The StatusBar word-count span identifies the status cluster (it renders
// `{wordCount} words` whenever a file is open). Resolved by text, since the
// cluster root carries no data attribute today.
async function statusBarVisible(page: {
  evaluate(expr: string): Promise<unknown>;
}): Promise<boolean> {
  const visible = await page.evaluate(`(() => {
    const span = Array.from(document.querySelectorAll('span'))
      .find((s) => /\\b\\d+\\s+words\\b/.test((s.textContent ?? '').trim()));
    if (!span) return false;
    if (span.offsetParent === null) return false;
    const r = span.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  })()`);
  if (typeof visible !== 'boolean') {
    throw new Error(`statusBarVisible returned non-boolean: ${JSON.stringify(visible)}`);
  }
  return visible;
}

test('comfort modes center the caret, hide the chrome, mark sentences, and round-trip through config', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // Bring the app + project + preview up FIRST so a RED failure below is
  // demonstrably the MISSING comfort feature, not a boot/open/render error.
  await waitForHarness(tauriPage);
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // [editor.comfort] is a REQUIRED opinionated sub-table: the canonical config bakes
  // it with every mode OFF (all-false). Assert it is PRESENT at baseline with the
  // three booleans false — confirming the app booted on a comfort-carrying config (so
  // a later failure is the missing feature behavior, not a config-schema reject), and
  // that the required table parsed (no serde default, no silent coercion).
  const baseCfg = parseTomlFile(manifest.configPath);
  const baseEditor = baseCfg.editor as Record<string, unknown>;
  const baseComfort = baseEditor.comfort as Record<string, unknown>;
  expect(baseComfort).toBeDefined();
  expect(baseComfort.distraction_free).toBe(false);
  expect(baseComfort.typewriter).toBe(false);
  expect(baseComfort.readability).toBe(false);

  // Make the buffer TALL so the caret line can meaningfully move from "low in the
  // viewport" (typewriter OFF) to "centered" (typewriter ON). appendAtEnd lands the
  // cursor at the END of the appended block — deep in the doc — and dispatches NO
  // centering scroll, so the default editor keeps the caret near the viewport
  // BOTTOM (the un-centered baseline the obligation contrasts against).
  await appendAtEnd(tauriPage, `\n${FILLER}\n`);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > ${FILLER_LINES}`,
    10_000,
  );
  // The caret line must be measurable and genuinely LOW (un-centered) with the mode
  // OFF — the precondition that gives clause (1) discriminating power.
  const fractionOff = await caretViewportFraction(tauriPage);
  expect(fractionOff).toBeGreaterThan(0.65);

  // ── Clause (1): TYPEWRITER centers the caret line ──────────────────────────
  // RED today: setComfort does not exist -> this evaluate THROWS (the faithful "no
  // comfort extensions" failure). Were it implemented, the caret line would move
  // into a centered band near viewport mid-height.
  await setComfort(tauriPage, 'typewriter', true);
  await tauriPage.waitForFunction(
    `(() => {
       const sc = document.querySelector('.cm-editor .cm-scroller');
       const al = document.querySelector('.cm-editor .cm-content .cm-activeLine');
       if (!sc || !al) return false;
       const s = sc.getBoundingClientRect();
       const a = al.getBoundingClientRect();
       if (s.height <= 0) return false;
       const f = ((a.top + a.bottom) / 2 - s.top) / s.height;
       return f > 0.35 && f < 0.65;
     })()`,
    5_000,
  );
  const fractionOn = await caretViewportFraction(tauriPage);
  // Centered: the caret line now sits in a band straddling viewport mid-height.
  expect(fractionOn).toBeGreaterThan(0.35);
  expect(fractionOn).toBeLessThan(0.65);
  // And materially different from (higher up than) the un-centered OFF position.
  expect(fractionOff - fractionOn).toBeGreaterThan(0.15);

  // ── Clause (2): DISTRACTION-FREE hides the chrome ──────────────────────────
  // With the mode OFF, all three chrome regions are present and laid out.
  expect(await chromeVisible(tauriPage, INSERTION_BAR_MARKER)).toBe(true);
  expect(await chromeVisible(tauriPage, ACTIVITY_BAR_MARKER)).toBe(true);
  expect(await sidebarPresent(tauriPage)).toBe(true);
  expect(await statusBarVisible(tauriPage)).toBe(true);

  await setComfort(tauriPage, 'distractionFree', true);
  await tauriPage.waitForFunction(
    `(() => {
       const ins = document.querySelector('[data-insert-env]');
       const act = document.querySelector('[data-view]');
       const insHidden = !ins || ins.offsetParent === null
         || ins.getBoundingClientRect().width === 0;
       const actHidden = !act || act.offsetParent === null
         || act.getBoundingClientRect().width === 0;
       return insHidden && actHidden;
     })()`,
    5_000,
  );
  expect(await chromeVisible(tauriPage, INSERTION_BAR_MARKER)).toBe(false);
  expect(await chromeVisible(tauriPage, ACTIVITY_BAR_MARKER)).toBe(false);
  expect(await sidebarPresent(tauriPage)).toBe(false);
  expect(await statusBarVisible(tauriPage)).toBe(false);

  // Toggling OFF restores all three chrome regions.
  await setComfort(tauriPage, 'distractionFree', false);
  await tauriPage.waitForFunction(
    `(() => {
       const ins = document.querySelector('[data-insert-env]');
       const act = document.querySelector('[data-view]');
       const insVisible = ins && ins.offsetParent !== null
         && ins.getBoundingClientRect().width > 0;
       const actVisible = act && act.offsetParent !== null
         && act.getBoundingClientRect().width > 0;
       return insVisible && actVisible;
     })()`,
    5_000,
  );
  expect(await chromeVisible(tauriPage, INSERTION_BAR_MARKER)).toBe(true);
  expect(await chromeVisible(tauriPage, ACTIVITY_BAR_MARKER)).toBe(true);
  expect(await sidebarPresent(tauriPage)).toBe(true);
  expect(await statusBarVisible(tauriPage)).toBe(true);

  // ── Clause (3): READABILITY marks sentence spans ───────────────────────────
  // With the mode OFF, no readability decoration marks exist in the content DOM.
  expect(await readabilityMarkCount(tauriPage)).toBe(0);

  await setComfort(tauriPage, 'readability', true);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .${READABILITY_MARK_CLASS}').length > 0`,
    5_000,
  );
  const marks = await readabilityMarkCount(tauriPage);
  // The tall filler is many plain-prose sentences, so the layer marks several.
  expect(marks).toBeGreaterThan(1);

  // ── Clause (4): the enabled modes ROUND-TRIP to the on-disk config ─────────
  // All three modes are now enabled (typewriter + readability ON; distraction-free
  // was toggled back OFF above, so set it ON again to persist all three). Assert the
  // [editor.comfort] booleans reach the on-disk config.toml under the hermetic
  // XDG_CONFIG_HOME (the P9 class), read back by an INDEPENDENT process — so the
  // modes survive persistence and are STILL active on relaunch.
  await setComfort(tauriPage, 'distractionFree', true);

  let comfort: Record<string, unknown> | undefined;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const cfg = parseTomlFile(manifest.configPath);
    const editor = cfg.editor as Record<string, unknown> | undefined;
    comfort = editor?.comfort as Record<string, unknown> | undefined;
    if (
      comfort?.typewriter === true &&
      comfort?.readability === true &&
      comfort?.distraction_free === true
    ) {
      break;
    }
    await sleep(250);
  }
  expect(comfort).toBeDefined();
  expect(comfort?.typewriter).toBe(true);
  expect(comfort?.readability).toBe(true);
  expect(comfort?.distraction_free).toBe(true);

  recordObservation({ spec: manifest.spec, name: 'caret-fraction-off', value: Number(fractionOff.toFixed(4)) });
  recordObservation({ spec: manifest.spec, name: 'caret-fraction-typewriter-on', value: Number(fractionOn.toFixed(4)) });
  recordObservation({ spec: manifest.spec, name: 'readability-mark-count', value: marks });
});
