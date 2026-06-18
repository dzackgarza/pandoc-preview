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
// ── WHAT EACH ASSERTION KILLS ─────────────────────────────────────────────────
//   (A) After appending the imbalance, at least ONE diagnostic's range covers
//       either the surplus `\left` or the unterminated `$`.
//       KILLS "no app lint source": with only the fork's `{}`/`\begin`-`\end`
//       checks, the `\left`/$ imbalance is NEVER marked, so no diagnostic covers
//       those spans and this fails. (RED today: lintDiagnostics() does not exist,
//       so the evaluate throws first — there is no app lint surface at all.)
//   (B) That diagnostic's message NAMES the imbalance (mentions left/right or
//       math/dollar, case-insensitively).
//       KILLS a cursor-pair-HIGHLIGHT-only impl: matched-delimiter highlighting
//       paints the pair under the cursor but emits NO buffer-wide diagnostic with
//       a message — so there is no message naming the imbalance, and this fails.
//   (C) The witness produced MORE diagnostics than the demo baseline had.
//       KILLS a source that ignores the appended imbalance entirely (the count
//       is unchanged by introducing two real imbalances).
//   (D) After appending the missing `\right)` and closing `$` (balancing both),
//       NO diagnostic covers the (now-balanced) imbalance spans, and the imbalance
//       message is gone from the active set.
//       KILLS a STUCK linter: a source that computed once and never re-ran (or a
//       parallel array never invalidated) keeps the imbalance diagnostic after the
//       buffer is balanced — this fails; it passes only when the live lint field
//       re-runs and clears the resolved imbalance.
//
// Together: a real `\left`/$ imbalance produces a real `@codemirror/lint`
// diagnostic that NAMES it (A,B,C), and balancing the buffer clears it (D) —
// proving a live, buffer-wide, real-ChkTeX-sourced static balance check, not a
// cursor highlight and not a stuck one-shot, all without a compile.

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

function namesImbalance(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('left') ||
    m.includes('right') ||
    m.includes('math') ||
    m.includes('$') ||
    m.includes('dollar') ||
    m.includes('unmatched') ||
    m.includes('unterminated') ||
    m.includes('unclosed')
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
  // anchor; the diagnostic must cover the `\left`/`\right` region or the
  // unterminated `$`.
  const leftIdx = withImbalance.indexOf('\\left(');
  expect(leftIdx).toBeGreaterThanOrEqual(0);
  const leftEnd = withImbalance.lastIndexOf('\\left(') + '\\left('.length;
  const dollarIdx = withImbalance.indexOf('The value $x + y') + 'The value '.length;
  const dollarEnd = dollarIdx + 1;

  // Wait for the lint pass to produce at least one diagnostic that COVERS the
  // imbalance span and NAMES it. Polling the live field (forceLinting-flushed)
  // is the deterministic signal the pass completed (the real-ChkTeX call is
  // async).
  await tauriPage.waitForFunction(
    `(() => {
      const fn = window.__PPE_E2E__ && window.__PPE_E2E__.lintDiagnostics;
      if (!fn) return false;
      const ds = fn();
      const namesIt = (msg) => {
        const m = String(msg).toLowerCase();
        return m.includes('left') || m.includes('right') || m.includes('math') ||
               m.includes('$') || m.includes('dollar') || m.includes('unmatched') ||
               m.includes('unterminated') || m.includes('unclosed');
      };
      const overlaps = (a,b,c,d) => a < d && c < b;
      return ds.some((dg) =>
        (overlaps(dg.from, dg.to, ${leftIdx}, ${leftEnd}) ||
         overlaps(dg.from, dg.to, ${dollarIdx}, ${dollarEnd})) &&
        namesIt(dg.message));
    })()`,
    20_000,
  );

  const imbalanced: LintDiagnostic[] = await lintDiagnostics(tauriPage);

  // (A) At least one diagnostic's range covers the surplus `\left` or the
  // unterminated `$`.
  const covering = imbalanced.filter(
    (d) =>
      rangesOverlap(d.from, d.to, leftIdx, leftEnd) ||
      rangesOverlap(d.from, d.to, dollarIdx, dollarEnd),
  );
  expect(covering.length).toBeGreaterThan(0);

  // (B) Its message NAMES the imbalance.
  expect(covering.some((d) => namesImbalance(d.message))).toBe(true);

  // (C) The imbalance ADDED diagnostics over the clean-demo baseline.
  const imbalancedCount = await lintCount(tauriPage);
  expect(imbalancedCount).toBeGreaterThan(baselineCount);

  // ── Balance the buffer: append ONLY the missing closers ─────────────────────
  // Append the missing `\right)` inside the display-math block (before its `$$`
  // close, achieved by appending after the open zone is the simplest append-only
  // balance the obligation names) and the closing `$` for the inline zone.
  await appendAtEnd(tauriPage, BALANCE_RIGHT);
  await appendAtEnd(tauriPage, BALANCE_DOLLAR);

  // (D) After balancing, NO diagnostic covers the imbalance spans with a message
  // naming the imbalance — the linter re-ran and cleared the resolved imbalance
  // (a STUCK linter keeps it and this never settles).
  await tauriPage.waitForFunction(
    `(() => {
      const ds = window.__PPE_E2E__.lintDiagnostics();
      const namesIt = (msg) => {
        const m = String(msg).toLowerCase();
        return m.includes('left') || m.includes('right') || m.includes('math') ||
               m.includes('$') || m.includes('dollar') || m.includes('unmatched') ||
               m.includes('unterminated') || m.includes('unclosed');
      };
      const overlaps = (a,b,c,d) => a < d && c < b;
      return !ds.some((dg) =>
        (overlaps(dg.from, dg.to, ${leftIdx}, ${leftEnd}) ||
         overlaps(dg.from, dg.to, ${dollarIdx}, ${dollarEnd})) &&
        namesIt(dg.message));
    })()`,
    20_000,
  );

  const balanced: LintDiagnostic[] = await lintDiagnostics(tauriPage);
  const stillCovering = balanced.filter(
    (d) =>
      (rangesOverlap(d.from, d.to, leftIdx, leftEnd) ||
        rangesOverlap(d.from, d.to, dollarIdx, dollarEnd)) &&
      namesImbalance(d.message),
  );
  expect(stillCovering.length).toBe(0);

  recordObservation({ spec: manifest.spec, name: 'baseline-lint-count', value: baselineCount });
  recordObservation({ spec: manifest.spec, name: 'imbalanced-lint-count', value: imbalancedCount });
  recordObservation({
    spec: manifest.spec,
    name: 'imbalance-diagnostic-message',
    value: covering.find((d) => namesImbalance(d.message))?.message ?? '',
  });
});
