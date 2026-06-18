import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  appendAtEnd,
  seedClipboardText,
  insertSnippetByTrigger,
  typeInEditor,
  acceptCompletion,
  completionLabels,
  editorText,
} from './support/app';

// ── P82 — Snippet variables resolve at expansion (Phase-B B6) ───────────────
//
// THE OBLIGATION (phase-b-snippet-engine.md, proposed P82, exact intent):
//   Config declares a snippet dictionary with an entry whose body contains the
//   STANDARD TextMate/VSCode snippet variables `$CLIPBOARD` and `$CURRENT_DATE`
//   (B6 adopts the established `$NAME` variable names — `CLIPBOARD`,
//   `CURRENT_DATE`, `CURRENT_YEAR` — never bespoke tokens). With KNOWN text on
//   the system clipboard, EXPANDING the entry inserts a body where `$CLIPBOARD`
//   is replaced by the REAL clipboard text and `$CURRENT_DATE` by the HOST DATE
//   — NOT the literal tokens.
//
//   Admissible because it FAILS on:
//     - a LITERAL-TOKEN engine (`$CLIPBOARD` / `$CURRENT_DATE` appear VERBATIM in
//       the buffer because the body is expanded with no variable resolution).
//       This is the CURRENT state: runSnippet (snippets.ts) expands its body
//       through snippetCompletion(normalizeTabstops(body), …), and
//       normalizeTabstops only rewrites bare `$<digits>` tabstops — the
//       NON-digit variable tokens survive untouched.
//     - a NO-OP (the expansion never fires, so neither the resolved values nor
//       the tokens change the buffer).
//
// ── THE VARIABLE CONTRACT (what the implementer must honor) ──────────────────
// Resolution happens AT EXPANSION TIME, BEFORE snippetCompletion instantiates the
// template — and it must be resolved on EVERY shipped expansion path, BOTH the
// popup-accept path P52/P77 (type the trigger, accept the offered completion) AND
// the insertion-bar path P59 (insertSnippet → runSnippet). `$CLIPBOARD` → the
// system-clipboard text, read through the SAME clipboard backend the P62
// paste-image path owns; `$CURRENT_DATE` / `$CURRENT_YEAR` → the host date (the
// standard VSCode semantics: CURRENT_DATE is the day of the month, CURRENT_YEAR
// the 4-digit year). This spec is BLIND to how resolution is implemented; it only
// observes the user-facing buffer effect — on BOTH expansion paths.
//
// The dictionary is declared by the SAME config-owned path P52/P59 read
// ([editor].snippet_dictionary); provision-proof.sh (the p82 case) provisions a
// hermetic copy of the committed fixture
// tests/proof/fixtures/snippets/p82-variables-snippets.json — one entry:
//   { "trigger": "sig", "mode": "both",
//     "body": "<!-- PPE-SIG clip=$CLIPBOARD date=$CURRENT_DATE year=$CURRENT_YEAR -->" }
// and points [editor].snippet_dictionary at that copy.
//
// ── THE OBSERVABLE CONTRACT (hooks + observables, BLIND to implementation) ────
//
//   seedClipboardText(text)  [NEW for P82] — writes `text` onto the REAL system
//     clipboard through the clipboard-manager plugin's writeText path (the SAME
//     clipboard a user's copy lands on; the sibling of P62's seedClipboardImage).
//     The chosen string is an unusual witness sentinel no incidental clipboard
//     content would carry, so its presence in the expanded body proves the REAL
//     clipboard text (not a placeholder) was substituted for `$CLIPBOARD`.
//
//   insertSnippetByTrigger(trigger)  [P59, reused] — expand the named entry's
//     BODY at the cursor through the SHARED insertSnippet → runSnippet path B6
//     places variable resolution inside. The insertion-bar path is the
//     deterministic, popup-free expansion this spec drives.
//
//   appendAtEnd(text) [reused] — place the cursor at a clean buffer position.
//   getEditorText() [reused] — the live editor buffer text.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (1) After expansion the buffer contains the KNOWN clipboard sentinel in the
//       expanded body — `$CLIPBOARD` resolved to the REAL clipboard text.
//       KILLS the literal-token engine (which leaves `$CLIPBOARD` verbatim and
//       never inserts the sentinel) and the no-op (nothing expands).
//   (2) After expansion the buffer contains the HOST YEAR (computed
//       INDEPENDENTLY by this test process) in the expanded body — `$CURRENT_DATE`
//       / `$CURRENT_YEAR` resolved to the host date.
//       KILLS the literal-token engine (the date tokens stay verbatim) and the
//       no-op.
//   (3) NONE of the literal variable tokens (`$CLIPBOARD`, `$CURRENT_DATE`,
//       `$CURRENT_YEAR`) survive in the buffer.
//       KILLS the literal-token engine decisively: a body expanded with no
//       variable resolution leaves these tokens verbatim; a resolving engine
//       removes every one.
//
// Together: with a known string on the clipboard, expanding the entry resolves
// `$CLIPBOARD` to that string (1) and `$CURRENT_DATE`/`$CURRENT_YEAR` to the host
// date (2), with NO literal variable token left in the buffer (3) — the full P82
// variable-resolution obligation.

// An unusual witness sentinel placed on the clipboard: no incidental clipboard
// content would carry it, so its appearance proves the REAL clipboard text was
// substituted for `$CLIPBOARD`.
const CLIPBOARD_SENTINEL = 'PPE-CLIP-WITNESS-Zeta-7351-naïve-café';
// The host year, computed INDEPENDENTLY by this test process — the strongest
// host-date discriminator (a 4-digit year cannot collide with the body text or
// the clipboard sentinel, unlike a 1-2 digit day-of-month).
const HOST_YEAR = String(new Date().getFullYear());
// The literal variable tokens a no-resolution engine leaves verbatim.
const TOKEN_CLIPBOARD = '$CLIPBOARD';
const TOKEN_DATE = '$CURRENT_DATE';
const TOKEN_YEAR = '$CURRENT_YEAR';
// The expanded-body marker (the literal prefix of the snippet body), so the spec
// can locate the expansion regardless of how the variables rendered around it.
const BODY_MARKER = '<!-- PPE-SIG';
// The entry trigger the variable body is declared under.
const TRIGGER = 'sig';

// A clean zone whose END places the cursor at a fresh position for the expansion.
const ZONE = '\n\nSignature zone here: ';

test('Expanding a snippet whose body contains $CLIPBOARD and $CURRENT_DATE resolves them to the real clipboard text and the host date, leaving no literal variable tokens', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // Neither the resolved values nor the body marker is present to start.
  const initial = await editorText(tauriPage);
  expect(initial).not.toContain(BODY_MARKER);
  expect(initial).not.toContain(CLIPBOARD_SENTINEL);
  expect(initial).not.toContain(TOKEN_CLIPBOARD);

  // Place the cursor in a clean zone.
  await appendAtEnd(tauriPage, ZONE);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(ZONE.trimEnd())})`,
    10_000,
  );

  // ── PART A — THE DECISIVE LITERAL-TOKEN KILL (no seed needed) ────────────────
  // Expand the variable entry through the SHARED insertion-bar path B6 places
  // variable resolution inside (insertSnippetByTrigger → insertSnippet →
  // runSnippet). This expansion DOES fire on the current code — the body lands in
  // the buffer (the body marker appears) — so the assertions observe a REAL
  // expanded body, never an empty no-op. What is ABSENT on the current code is
  // the resolution: runSnippet expands the body through
  // snippetCompletion(normalizeTabstops(body)) with NO variable resolution, and
  // normalizeTabstops rewrites only bare `$<digits>` tabstops, so the NON-digit
  // variable tokens `$CLIPBOARD` / `$CURRENT_DATE` / `$CURRENT_YEAR` survive
  // VERBATIM. The token-survival assertions below FAIL on this shipped
  // literal-token engine (the tokens ARE present) and pass only once resolution
  // removes every one — the core P82 proof, observable WITHOUT the clipboard seed.
  await insertSnippetByTrigger(tauriPage, TRIGGER);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(BODY_MARKER)})`,
    10_000,
  );
  const afterExpand = await editorText(tauriPage);
  // The expansion fired — the body marker is present, so the next assertions are
  // about a real expanded body, not an empty no-op.
  expect(afterExpand).toContain(BODY_MARKER);
  // (3) NO literal variable token survives — the decisive literal-token kill,
  // failing on the shipped no-resolution runSnippet:
  expect(afterExpand).not.toContain(TOKEN_CLIPBOARD);
  expect(afterExpand).not.toContain(TOKEN_DATE);
  expect(afterExpand).not.toContain(TOKEN_YEAR);
  // (2) the host date resolved — the host year (computed independently by this
  // test process) is in the expanded body:
  expect(afterExpand).toContain(HOST_YEAR);

  // ── PART B — `$CLIPBOARD` RESOLVES TO THE REAL CLIPBOARD TEXT ────────────────
  // Seed the KNOWN sentinel on the REAL system clipboard (the SAME clipboard a
  // user's copy lands on), place the cursor in a fresh zone, expand again, and
  // observe the sentinel substituted for `$CLIPBOARD`. KILLS a resolution that
  // strips the token to an empty string (the sentinel would be absent) as well as
  // the literal-token engine (the token would survive).
  await seedClipboardText(tauriPage, CLIPBOARD_SENTINEL);
  await appendAtEnd(tauriPage, ZONE);
  await insertSnippetByTrigger(tauriPage, TRIGGER);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(CLIPBOARD_SENTINEL)})`,
    10_000,
  );
  const afterSeed = await editorText(tauriPage);
  // (1) `$CLIPBOARD` resolved to the REAL clipboard sentinel:
  expect(afterSeed).toContain(CLIPBOARD_SENTINEL);
  // and still no literal `$CLIPBOARD` token survives in the seeded expansion:
  expect(afterSeed).not.toContain(TOKEN_CLIPBOARD);

  // ── PART C — THE POPUP-ACCEPT PATH (P52/P77) MUST RESOLVE VARIABLES TOO ──────
  // Parts A/B drove the insertion-bar path (insertSnippetByTrigger → insertSnippet
  // → runSnippet), where variable resolution lives today. But the SHIPPED
  // popup-accept path a user hits by typing a trigger and pressing Enter does NOT
  // route through runSnippet: snippetCompletionSource builds each option via
  // snippetOption → snippetCompletion(normalizeTabstops(entry.body)) (snippets.ts),
  // expanding the RAW body with NO call to resolveSnippetVariables. So a user who
  // opens the completion popup and accepts gets `$CLIPBOARD` / `$CURRENT_DATE` /
  // `$CURRENT_YEAR` left VERBATIM. A spec that drives only the insertion-bar path
  // would pass while this real shipped path leaks literal tokens — inadmissible.
  // This part adds the missing path: type the trigger, accept the OFFERED popup
  // completion (the SAME real accept surface P52/P77 use), and require the SAME
  // resolution the insertion-bar path delivers.
  //
  // The clipboard sentinel seeded in Part B is still on the REAL clipboard, so a
  // resolving popup-accept path substitutes it for `$CLIPBOARD`.
  await appendAtEnd(tauriPage, ZONE);
  // Type the trigger; CM6 opens the autocomplete tooltip and offers `sig`
  // (the `both`-mode entry surfaces in this prose zone).
  await typeInEditor(tauriPage, TRIGGER);
  await tauriPage.waitForFunction(
    `(() => {
      const tip = document.querySelector('.cm-tooltip-autocomplete');
      if (!tip) return false;
      return Array.from(tip.querySelectorAll('.cm-completionLabel'))
        .some((el) => el.textContent === ${JSON.stringify(TRIGGER)});
    })()`,
    10_000,
  );
  const popupLabels = await completionLabels(tauriPage);
  expect(popupLabels).toContain(TRIGGER);

  // Accept the highlighted option through CM6's REAL acceptCompletion command —
  // the SAME path the Enter keybinding fires (P52/P77). The body lands at the
  // cursor; the body marker proves the expansion fired (never a no-op).
  await acceptCompletion(tauriPage);
  await tauriPage.waitForFunction(
    `(() => {
      const text = window.__PPE_E2E__.getEditorText();
      // The popup-accept expansion fired (its body marker is present) — wait for
      // that, NOT for the resolved values, so the assertions below observe the
      // REAL expanded body whether or not it resolved (a literal-token expansion
      // still contains the marker, and is exactly what must FAIL here).
      const markers = text.split(${JSON.stringify(BODY_MARKER)}).length - 1;
      return markers >= 3;
    })()`,
    10_000,
  );
  // Isolate the popup-accept expansion: the LAST occurrence of the body marker is
  // the body just inserted by acceptCompletion (Parts A/B inserted the two earlier
  // ones via the insertion-bar path). Assert resolution on THAT body only, so a
  // resolved insertion-bar body cannot mask an unresolved popup-accept body.
  const afterPopup = await editorText(tauriPage);
  const lastMarker = afterPopup.lastIndexOf(BODY_MARKER);
  expect(lastMarker).toBeGreaterThanOrEqual(0);
  const popupBody = afterPopup.slice(lastMarker);
  // (1) `$CLIPBOARD` resolved to the REAL clipboard sentinel on the popup path:
  expect(popupBody).toContain(CLIPBOARD_SENTINEL);
  // (2) the host year resolved on the popup path:
  expect(popupBody).toContain(HOST_YEAR);
  // (3) NO literal variable token survives in the popup-accept expansion — the
  // decisive kill: the shipped popup-accept path expands the raw body with no
  // variable resolution, leaving every token VERBATIM, so each of these FAILS
  // today and passes only once the popup-accept path resolves variables too.
  expect(popupBody).not.toContain(TOKEN_CLIPBOARD);
  expect(popupBody).not.toContain(TOKEN_DATE);
  expect(popupBody).not.toContain(TOKEN_YEAR);

  recordObservation({ spec: manifest.spec, name: 'p82-clipboard-sentinel', value: CLIPBOARD_SENTINEL });
  recordObservation({ spec: manifest.spec, name: 'p82-host-year', value: HOST_YEAR });
});
