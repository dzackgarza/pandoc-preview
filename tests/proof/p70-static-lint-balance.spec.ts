import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  appendAtEnd,
  editorText,
  lintDiagnostics,
  lintCount,
  type LintDiagnostic,
} from './support/app';

// ── P70 — Static delimiter & math-mode balance warns BEFORE a compile ─────────
//
// THE OBLIGATION (Phase A plan, A.1; proposed proof P70, exact intent):
//   With a buffer containing a REAL imbalance — a math line with two `\left` and
//   one `\right`, and a separate `$`-opened math zone with no closing `$` — the
//   editor surfaces, via the `@codemirror/lint` diagnostics FIELD (the SAME field
//   the gutter renders, observed through `lintDiagnostics()`), at least one
//   diagnostic whose marked range covers the surplus `\left` / the unterminated
//   `$` and whose message NAMES the imbalance; AND after the user balances them
//   (append the missing `\right` and the closing `$`), that diagnostic is GONE.
//   NO latex COMPILE / preview RENDER is the source — the diagnostic comes from
//   the cheap REAL-ChkTeX lint pass on the pandoc-emitted `.tex` (pandoc md→tex +
//   the real /usr/bin/chktex v1.7.8), not the full pandoc-HTML render. That is
//   exactly "feedback faster than a compile."
//
// ── WHY THE APP IS RED TODAY (the implementation fact this proof pins) ─────────
// The ONLY linter wired into the editor today is the vendored fork's grammar
// linter — `vendor/codemirror-lang-latex/src/linter.ts:latexLinter`, enabled via
// `latex({linter})` (EditorPane.svelte:197). It does `{}` brace balance
// (checkUnclosedBraces) and `\begin`/`\end` environment balance
// (checkUnmatchedEnvironments) only. It has NO `\left`/`\right` count and NO
// `$…$` math-mode on/off tracking, so a surplus `\left` and an unterminated `$`
// are NEVER marked. There is NO app-owned `linter()` source registered
// (EditorPane.svelte:147 editorBasics / :170 lintKeymap — no app linter), and NO
// `__PPE_E2E__.lintDiagnostics` / `lintCount` hook on the harness (App.svelte:256
// hook object). So the very thing P70 requires — a real-ChkTeX-sourced diagnostic
// for the `\left`/$ imbalance, observable through the live lint field — cannot
// happen with the current wiring. The spec therefore THROWS first on the missing
// hook; once the hook exists but no app lint SOURCE produces the diagnostic, the
// (A)/(B) assertions are the ones that catch it.
//
// ── THE OBSERVABLE CONTRACT (hooks + observable, BLIND to implementation) ──────
// To observe the produced diagnostics deterministically — and BLIND to how the
// lint source is built — the implementer must expose two stable harness hooks.
// They MUST read the editor's ACTUAL `@codemirror/lint` diagnostic state (the
// `lintState` field that `lintGutter` renders), flushed via `forceLinting`, NOT a
// parallel JS array maintained alongside it. A hook that returned a side array
// would be inadmissible: it could pass while the gutter shows nothing.
//
//   __PPE_E2E__.lintDiagnostics(): {from,to,severity,message,source}[]  [NEW]
//     The live, `forceLinting`-flushed `@codemirror/lint` diagnostics, mapped to
//     a JSON-serializable shape: `from`/`to` are the diagnostic's character
//     offsets into the editor buffer (the SAME range CM6 marks in the gutter and
//     underlines in the content), `severity` is the CM6 severity string
//     ('error'|'warning'|'info'|'hint'), `message` is the human-readable text,
//     and `source` identifies the producing linter (e.g. the ChkTeX warning id /
//     rule id, so a directive can later name it — A.4/P73). Forces a lint flush
//     before reading so the field reflects the current buffer, not a stale pass.
//
//   __PPE_E2E__.lintCount(): number  [NEW]
//     The count of currently-active diagnostics in that SAME flushed field. A
//     convenience over lintDiagnostics().length, read from the same source.
//
//   __PPE_E2E__.getEditorText()  [reused]  — the live editor buffer text.
//   __PPE_E2E__.appendAtEnd(text) [reused] — append through the REAL CM update
//     pipeline (docChanged path), so the lint source re-runs as it does for user
//     typing.
//
// The diagnostic the spec demands must originate from the cheap real-ChkTeX lint
// pass (pandoc md→tex + chktex), NOT a full HTML render: the spec NEVER triggers
// a preview render, and asserts the diagnostic appears purely from editing —
// "feedback faster than a compile."
//
// ── THE WITNESS IMBALANCE (a REAL imbalance ChkTeX warns on) ──────────────────
// Appended to the demo buffer (so the spans are NEW, not pre-existing):
//   * MATH_IMBALANCED: a display-math line with TWO `\left(` and ONE `\right)` —
//     a surplus `\left`. ChkTeX warns on unmatched `\left`/`\right` (its
//     mathmode/delimiter checks); the fork linter does NOT.
//   * DOLLAR_UNTERMINATED: an inline math zone opened with `$` and never closed —
//     an unterminated math-mode delimiter. ChkTeX warns on the dangling `$`.
// The BALANCE step appends ONLY the missing closers — a `\right)` and the closing
// `$` — so the imbalance diagnostics must disappear (a STUCK linter that keeps
// the diagnostic after balancing fails (D)).
//
// ── WHY THE DOLLAR HALF IS A REAL (CURRENTLY-UNMET) BURDEN, NOT AN OR-FILLER ───
// The earlier form of this proof asked only for a diagnostic covering EITHER the
// `\left` span OR the `$` span. That disjunction was satisfiable by the `\left`
// arm ALONE, leaving the math-mode `$`-balance half INERT: it could pass while the
// editor surfaced NOTHING for an unterminated markdown `$`. That is precisely the
// state the current chktex-on-`.tex` bridge is in. Pandoc's md→latex writer
// ESCAPES a lone markdown `$` to a literal `\$` (verified: the markdown line
// `The value $x + y is undefined here.` emits `The value \$x + y ...`), so the
// `.tex` chktex sees has NO open math zone — chktex's "Mathmode still on at end of
// LaTeX file" (warning 16) NEVER fires for a pandoc-escaped lone `$`. A bridge
// that lints only the pandoc-emitted `.tex` therefore CANNOT catch an unterminated
// markdown inline-`$` (or an unterminated `$$` display block); that is a
// markdown-native balance check chktex-on-`.tex` structurally cannot do. P70's
// stated obligation REQUIRES this check, so the `$`-balance assertion is made
// REQUIRED and SEPARATE here — not OR-ed with the delimiter span.
//
// ── WHAT EACH ASSERTION KILLS ─────────────────────────────────────────────────
//   DELIMITER ARM (the `\left`/`\right` imbalance, which DOES survive pandoc):
//   (A) After appending the imbalance, at least ONE diagnostic's range covers the
//       surplus `\left`.
//       KILLS "no app lint source": with only the fork's `{}`/`\begin`-`\end`
//       checks, the `\left` imbalance is NEVER marked, so no diagnostic covers
//       that span and this fails.
//   (B) That delimiter diagnostic's message NAMES the imbalance (mentions
//       left/right or unmatched/unbalanced, case-insensitively).
//       KILLS a cursor-pair-HIGHLIGHT-only impl: matched-delimiter highlighting
//       paints the pair under the cursor but emits NO buffer-wide diagnostic with
//       a message — so there is no message naming the imbalance, and this fails.
//
//   MATH-MODE `$`-BALANCE ARM (REQUIRED, the markdown-native check):
//   (M1) After appending the unterminated markdown inline-`$`, at least ONE
//        diagnostic's range covers the unterminated `$` AND its message names the
//        unterminated math (mentions math/dollar/`$`/unterminated/unbalanced).
//        KILLS a bridge that only lints the pandoc-emitted `.tex`: pandoc escapes
//        the lone `$` to `\$`, so chktex emits no warning 16 and NO diagnostic
//        covers the `$` span — this fails. It passes only when the lint layer owns
//        a markdown-native math-mode `$`-balance check (the .tex chktex pass cannot
//        provide it). This is the assertion that is RED today.
//   (C) The witness produced MORE diagnostics than the demo baseline had.
//       KILLS a source that ignores the appended imbalance entirely (the count
//       is unchanged by introducing two real imbalances).
//   (D) After appending the missing `\right)` (balancing the delimiter pair), NO
//       diagnostic covers the (now-balanced) `\left` span with a delimiter message.
//       KILLS a STUCK linter on the delimiter arm: a source that computed once and
//       never re-ran keeps the diagnostic after the buffer is balanced.
//   (M2) After appending the closing `$` (balancing the inline math zone), NO
//        diagnostic covers the (now-balanced) `$` span with a math-mode message.
//        KILLS a STUCK markdown math-mode check that keeps the unterminated-`$`
//        diagnostic after the zone is closed.
//
// Together: a real `\left` imbalance AND a real unterminated markdown `$` each
// produce a real `@codemirror/lint` diagnostic that NAMES it (A,B,M1,C), and
// balancing each clears its own diagnostic (D,M2) — proving a live, buffer-wide
// static balance check that covers BOTH the delimiter class (chktex-on-`.tex`) and
// the markdown-native math-mode `$` class (which chktex-on-`.tex` cannot), all
// without a compile.

// A display-math line: two `\left(` openers, one `\right)` closer → surplus left.
const MATH_IMBALANCED = '\n\n$$\n\\left( a + \\left( b \\right) + c\n$$\n';
// An inline math zone opened with `$` and never closed → unterminated math mode.
const DOLLAR_UNTERMINATED = '\n\nThe value $x + y is undefined here.\n';
// The closers that BALANCE the above: the missing `\right)` and the closing `$`.
const BALANCE_RIGHT = ' \\right)';
const BALANCE_DOLLAR = '$';

// True iff `[a,b)` and `[c,d)` overlap — a diagnostic "covers" a span when its
// marked range intersects the span's character range.
function rangesOverlap(a: number, b: number, c: number, d: number): boolean {
  return a < d && c < b;
}

// Names the DELIMITER imbalance: a `\left`/`\right` (or generic unmatched/unclosed)
// diagnostic. Used only for the delimiter arm.
function namesDelimiter(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('left') ||
    m.includes('right') ||
    m.includes('unmatched') ||
    m.includes('unbalanced') ||
    m.includes('unclosed')
  );
}

// Names the MATH-MODE `$`-balance imbalance SPECIFICALLY: the message must speak
// to math mode / a dollar / an unterminated zone. A delimiter-only message that
// merely says "unmatched `(`" does NOT satisfy this — the markdown-native
// math-mode check must produce a message that NAMES the unterminated math.
function namesMathMode(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('math') ||
    m.includes('dollar') ||
    m.includes('$') ||
    m.includes('unterminated')
  );
}

test('A real \\left/$ imbalance surfaces a real @codemirror/lint diagnostic before any compile, and balancing clears it', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // Baseline diagnostic count on the clean demo buffer, so we can prove the
  // imbalance ADDS diagnostics (C). RED today: lintDiagnostics/lintCount do not
  // exist on __PPE_E2E__, so this evaluate THROWS — there is no live lint field
  // to read; the only linter present is the fork grammar linter with no harness
  // surface.
  const baselineCount = await lintCount(tauriPage);

  // Introduce the REAL imbalance through the real CM update pipeline (the same
  // docChanged path user typing fires), so the lint source re-runs.
  await appendAtEnd(tauriPage, MATH_IMBALANCED);
  await appendAtEnd(tauriPage, DOLLAR_UNTERMINATED);

  const withImbalance = await editorText(tauriPage);
  // The surplus `\left(` span: the SECOND `\left(` is the one with no matching
  // `\right)`. We locate the first `\left(` occurrence's start as the math-line
  // anchor; the DELIMITER arm's diagnostic must cover the `\left` region. The `$`
  // span is the lone markdown inline-math `$` the MATH-MODE arm requires covered.
  const leftIdx = withImbalance.indexOf('\\left(');
  expect(leftIdx).toBeGreaterThanOrEqual(0);
  const leftEnd = withImbalance.lastIndexOf('\\left(') + '\\left('.length;
  const dollarIdx = withImbalance.indexOf('The value $x + y') + 'The value '.length;
  const dollarEnd = dollarIdx + 1;

  // Wait for the lint pass to produce, for the DELIMITER arm, a diagnostic that
  // COVERS the surplus `\left` span and NAMES the delimiter imbalance. Polling the
  // live field (forceLinting-flushed) is the deterministic signal the pass
  // completed (the real-ChkTeX call is async). The delimiter arm survives pandoc
  // unchanged, so this settles on the current bridge.
  await tauriPage.waitForFunction(
    `(() => {
      const fn = window.__PPE_E2E__ && window.__PPE_E2E__.lintDiagnostics;
      if (!fn) return false;
      const ds = fn();
      const namesDelim = (msg) => {
        const m = String(msg).toLowerCase();
        return m.includes('left') || m.includes('right') ||
               m.includes('unmatched') || m.includes('unbalanced') ||
               m.includes('unclosed');
      };
      const overlaps = (a,b,c,d) => a < d && c < b;
      return ds.some((dg) =>
        overlaps(dg.from, dg.to, ${leftIdx}, ${leftEnd}) && namesDelim(dg.message));
    })()`,
    20_000,
  );

  const imbalanced: LintDiagnostic[] = await lintDiagnostics(tauriPage);

  // (A) At least one diagnostic's range covers the surplus `\left`.
  const coveringLeft = imbalanced.filter((d) =>
    rangesOverlap(d.from, d.to, leftIdx, leftEnd),
  );
  expect(coveringLeft.length).toBeGreaterThan(0);

  // (B) Its message NAMES the delimiter imbalance.
  expect(coveringLeft.some((d) => namesDelimiter(d.message))).toBe(true);

  // ── MATH-MODE `$`-BALANCE ARM (REQUIRED) ────────────────────────────────────
  // (M1) A diagnostic's range covers the unterminated markdown inline-`$` AND its
  //      message NAMES the unterminated math. This is the markdown-native check
  //      chktex-on-`.tex` CANNOT provide: pandoc escapes the lone `$` to `\$`, so
  //      the emitted `.tex` carries no open math zone and chktex emits no warning
  //      16. RED today: no diagnostic ever covers the `$` span with a math-mode
  //      message, so this poll times out / the assertion below fails.
  await tauriPage.waitForFunction(
    `(() => {
      const fn = window.__PPE_E2E__ && window.__PPE_E2E__.lintDiagnostics;
      if (!fn) return false;
      const ds = fn();
      const namesMath = (msg) => {
        const m = String(msg).toLowerCase();
        return m.includes('math') || m.includes('dollar') ||
               m.includes('$') || m.includes('unterminated');
      };
      const overlaps = (a,b,c,d) => a < d && c < b;
      return ds.some((dg) =>
        overlaps(dg.from, dg.to, ${dollarIdx}, ${dollarEnd}) && namesMath(dg.message));
    })()`,
    20_000,
  );

  const withDollar: LintDiagnostic[] = await lintDiagnostics(tauriPage);
  const coveringDollar = withDollar.filter(
    (d) =>
      rangesOverlap(d.from, d.to, dollarIdx, dollarEnd) && namesMathMode(d.message),
  );
  expect(coveringDollar.length).toBeGreaterThan(0);

  // (C) The imbalance ADDED diagnostics over the clean-demo baseline.
  const imbalancedCount = await lintCount(tauriPage);
  expect(imbalancedCount).toBeGreaterThan(baselineCount);

  // ── Balance the buffer: append ONLY the missing closers ─────────────────────
  // Append the missing `\right)` inside the display-math block (before its `$$`
  // close, achieved by appending after the open zone is the simplest append-only
  // balance the obligation names) and the closing `$` for the inline zone.
  await appendAtEnd(tauriPage, BALANCE_RIGHT);
  await appendAtEnd(tauriPage, BALANCE_DOLLAR);

  // (D)+(M2) After balancing, NO diagnostic covers EITHER imbalance span with its
  // naming message — both the delimiter check (D) and the markdown-native
  // math-mode check (M2) re-ran and cleared their resolved imbalance (a STUCK
  // linter on either arm keeps its diagnostic and this never settles).
  await tauriPage.waitForFunction(
    `(() => {
      const ds = window.__PPE_E2E__.lintDiagnostics();
      const namesDelim = (msg) => {
        const m = String(msg).toLowerCase();
        return m.includes('left') || m.includes('right') ||
               m.includes('unmatched') || m.includes('unbalanced') ||
               m.includes('unclosed');
      };
      const namesMath = (msg) => {
        const m = String(msg).toLowerCase();
        return m.includes('math') || m.includes('dollar') ||
               m.includes('$') || m.includes('unterminated');
      };
      const overlaps = (a,b,c,d) => a < d && c < b;
      const delimStuck = ds.some((dg) =>
        overlaps(dg.from, dg.to, ${leftIdx}, ${leftEnd}) && namesDelim(dg.message));
      const mathStuck = ds.some((dg) =>
        overlaps(dg.from, dg.to, ${dollarIdx}, ${dollarEnd}) && namesMath(dg.message));
      return !delimStuck && !mathStuck;
    })()`,
    20_000,
  );

  const balanced: LintDiagnostic[] = await lintDiagnostics(tauriPage);

  // (D) The delimiter diagnostic on the `\left` span is gone.
  const delimStillCovering = balanced.filter(
    (d) =>
      rangesOverlap(d.from, d.to, leftIdx, leftEnd) && namesDelimiter(d.message),
  );
  expect(delimStillCovering.length).toBe(0);

  // (M2) The math-mode diagnostic on the `$` span is gone.
  const mathStillCovering = balanced.filter(
    (d) =>
      rangesOverlap(d.from, d.to, dollarIdx, dollarEnd) && namesMathMode(d.message),
  );
  expect(mathStillCovering.length).toBe(0);

  recordObservation({ spec: manifest.spec, name: 'baseline-lint-count', value: baselineCount });
  recordObservation({ spec: manifest.spec, name: 'imbalanced-lint-count', value: imbalancedCount });
  recordObservation({
    spec: manifest.spec,
    name: 'delimiter-diagnostic-message',
    value: coveringLeft.find((d) => namesDelimiter(d.message))?.message ?? '',
  });
  recordObservation({
    spec: manifest.spec,
    name: 'mathmode-diagnostic-message',
    value: coveringDollar.find((d) => namesMathMode(d.message))?.message ?? '',
  });
});
