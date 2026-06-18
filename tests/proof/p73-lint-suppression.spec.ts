import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  appendAtEnd,
  editorText,
  lintDiagnostics,
  type LintDiagnostic,
} from './support/app';

// ── P73 — An in-document directive suppresses a SPECIFIC lint rule on a SPECIFIC
//          line, leaving the same construct on another line still flagged ──────
//
// THE OBLIGATION (Phase A plan, A.4; proposed proof P73, exact intent):
//   The author can silence a single, intentional lint hit IN THE DOCUMENT, with a
//   line-scoped suppression directive that names the rule. A markdown directive
//   `<!-- ppe-lint-disable-line <ruleId> -->` placed on (or for) a line removes
//   ONLY that rule's diagnostic on THAT line; the SAME construct on a DIFFERENT
//   line — with no directive — still warns; and REMOVING the directive RESTORES
//   the suppressed diagnostic. `<ruleId>` is the ChkTeX warning number / the
//   plugin's emitted rule id (here `25`, the sub/superscript-grouping class the
//   plugin surfaces as `source = "chktex:25"`). The suppression is handled IN THE
//   PLUGIN SCRIPT — translating the directive into ChkTeX's native `% chktex 25`
//   on the emitted `.tex` line, or filtering the plugin's emitted diagnostics by
//   (line, ruleId) — never an app-core feature.
//
// ── LINT IS A FIREWALL PLUGIN — SUPPRESSION LIVES IN THE PLUGIN SCRIPT ─────────
// Per the user ruling, the editor owns ZERO lint knowledge: all lint config AND
// logic — INCLUDING in-document suppression — live in the `pandoc-md-lint`
// firewall plugin. The directive is markdown the plugin reads off its stdin
// buffer; the plugin decides, per line, whether the named rule's diagnostic is
// emitted. There is NO `[editor.lint]` section in the app-core `config.rs` and NO
// suppression code in `src-tauri/src` — the diagnostic stream the editor renders
// is whatever the plugin emits, and the plugin alone honors the directive.
//
// ── WHY THE APP IS RED TODAY (the implementation fact this proof pins) ─────────
// The shipped `pandoc-md-lint` plugin (GREEN for P70/P71/P72) emits the
// sub/superscript-grouping class (ChkTeX warning 25) on a math `x^10` and anchors
// it to the markdown line, with NO knowledge of any suppression directive. Its
// `lint.sh` does not scan the buffer for `ppe-lint-disable-line`, does not pass
// `% chktex 25` to the emitted `.tex`, and does not filter its emitted diagnostics
// by (line, ruleId). A `<!-- ppe-lint-disable-line 25 -->` directive on the math
// line is therefore INERT: the chktex:25 diagnostic still covers the directed
// line's `x^10`, exactly as it covers the un-directed line's `x^10`. The class is
// emitted but NOT suppressible. This spec is RED on the FIRST arm — the directive
// does NOT remove the diagnostic on its own line — before the restore arm is even
// reached.
//
// (Verified independently: `/usr/bin/chktex` v1.7.8 emits warning 25 on a math
// line containing `x^10` — markdown `Inline math: $x^10$.` → `.tex`
// `Inline math: \(x^10\).`, on which chktex reports `25` with the message
// "You might wish to put this between a pair of `{}'" at the `x^10` column. The
// missing piece is entirely the plugin: it never consumes the in-document
// directive to suppress that warning-25 record on the directed line.)
//
// ── THE OBSERVABLE CONTRACT (hooks + observable, BLIND to implementation) ──────
// Observed through the SAME live `@codemirror/lint` field the gutter renders, via
// the established harness hooks (GREEN for P70/P71/P72):
//   __PPE_E2E__.lintDiagnostics(): {from,to,severity,message,source}[]  [reused]
//     The live, `forceLinting`-flushed diagnostics; `from`/`to` are character
//     offsets into the buffer, `message` is the gutter text, `source` carries the
//     producing rule id (here the `chktex:25` the plugin emits for the grouping
//     class — the id a directive names).
//   __PPE_E2E__.getEditorText()  [reused]  — the live editor buffer text.
//   __PPE_E2E__.appendAtEnd(text) [reused] — append through the REAL CM update
//     pipeline (docChanged path) so the lint source re-runs as it does for typing.
//
// The suppression is exercised purely in the document buffer: the spec appends a
// DIRECTED math line (carrying the suppression directive) and an UN-DIRECTED math
// line (the same `x^10` construct, no directive), then later EDITS the directed
// line to REMOVE the directive — all through the real CM update pipeline, so the
// plugin re-runs on each change and re-reads the directive state from the buffer.
// The plugin config ships `script_grouping = true` (provisioned), so warning 25 is
// ENABLED — the directive, not a disabled class, must do the line-scoped silencing.
//
// ── THE WITNESS (two math lines, ONE construct, ONE directive) ─────────────────
//   DIRECTED line:   an inline math zone `$x^10$` PLUS the directive
//     `<!-- ppe-lint-disable-line 25 -->`. The grouping warning (chktex:25) on its
//     `x^10` must be SUPPRESSED by the directive while the directive is present.
//   UN-DIRECTED line: the SAME inline math zone `$x^10$`, NO directive. Its
//     grouping warning must STILL fire — proving the suppression is LINE-SCOPED,
//     not a global silencing of the whole class.
//   Both lines are APPENDED to the demo buffer (so the spans are NEW). The demo
//   buffer carries no `x^10`, so any grouping diagnostic on these spans is the
//   plugin's product on these specific lines.
//
// ── WHAT EACH ASSERTION KILLS ─────────────────────────────────────────────────
//   SUPPRESSED ARM (directive present on the directed line):
//   (A) NO grouping diagnostic (a chktex:25 / grouping-message diagnostic) covers
//       the DIRECTED line's `x^10`.
//       KILLS "inert directive": today the plugin ignores the directive and the
//       chktex:25 record still covers the directed `x^10`, so this fails. It
//       passes only when the plugin honors the directive on that line.
//   (B) A grouping diagnostic STILL covers the UN-DIRECTED line's `x^10`.
//       KILLS an OVER-BROAD suppression: a directive that silenced the whole
//       grouping class (e.g. by passing `-n 25` globally, or dropping every
//       chktex:25 record) would also clear the un-directed line — this fails it.
//       The suppression must be scoped to the directed line ONLY.
//
//   RESTORE ARM (the directive removed from the directed line):
//   (C) After EDITING the directed line to remove the directive and forcing a
//       fresh lint pass, a grouping diagnostic AGAIN covers the (formerly directed)
//       line's `x^10`.
//       KILLS a NEVER-RESTORES suppression: a directive that latched the line off
//       permanently (or a plugin that computed once and never re-read the buffer's
//       directive state) keeps the line silent after the directive is gone — this
//       fails it. The diagnostic must come back when the directive is removed.

// The grouping construct (ChkTeX warning 25: `x^10` → `x^{10}`), inside inline math.
const GROUPING_CONSTRUCT = '$x^10$';
// The line-scoped suppression directive naming the grouping rule (chktex warning 25).
const DISABLE_DIRECTIVE = '<!-- ppe-lint-disable-line 25 -->';

// The DIRECTED line: the grouping construct carrying the suppression directive. The
// directive is appended on the SAME markdown line as the construct (the directive is
// an HTML comment, inert to the rendered preview), so it is unambiguously the line
// the directive scopes.
const DIRECTED_LINE = `\n\nInline math directed: ${GROUPING_CONSTRUCT} ${DISABLE_DIRECTIVE}\n`;
// The DIRECTED line WITHOUT the directive — the restore-arm replacement content.
const DIRECTED_LINE_NO_DIRECTIVE = `\n\nInline math directed: ${GROUPING_CONSTRUCT}\n`;
// The UN-DIRECTED line: the SAME construct, no directive — must always warn.
const UNDIRECTED_LINE = `\n\nInline math undirected: ${GROUPING_CONSTRUCT}\n`;

// True iff `[a,b)` and `[c,d)` overlap — a diagnostic "covers" a span when its
// marked range intersects the span's character range.
function rangesOverlap(a: number, b: number, c: number, d: number): boolean {
  return a < d && c < b;
}

// Names the SUB/SUPERSCRIPT-grouping correction (ChkTeX 25 → `x^{10}`): the message
// must speak to grouping / braces / sub- or superscript, OR the diagnostic's source
// must be the grouping rule id (chktex:25). Either marks it as the grouping class.
function isGroupingDiagnostic(d: LintDiagnostic): boolean {
  if (d.source === 'chktex:25') return true;
  const m = d.message.toLowerCase();
  return (
    m.includes('{}') ||
    m.includes('braces') ||
    m.includes('superscript') ||
    m.includes('subscript') ||
    m.includes('group') ||
    m.includes('pair of')
  );
}

test('An in-document ppe-lint-disable-line directive suppresses the named rule on its own line only, and removing it restores the diagnostic', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // Append the UN-DIRECTED line first (a plain grouping construct that must always
  // warn — the control), then the DIRECTED line (the same construct plus the
  // suppression directive). Both go through the real CM update pipeline so the
  // plugin re-runs and reads the directive off the buffer.
  await appendAtEnd(tauriPage, UNDIRECTED_LINE);
  await appendAtEnd(tauriPage, DIRECTED_LINE);

  const buffer = await editorText(tauriPage);
  // The DIRECTED line's `x^10` span (the one the directive scopes).
  const directedConstructIdx =
    buffer.indexOf('Inline math directed: $x^10$') + 'Inline math directed: $'.length;
  const directedConstructEnd = directedConstructIdx + 'x^10'.length;
  // The UN-DIRECTED line's `x^10` span (the control — must keep warning).
  const undirectedConstructIdx =
    buffer.indexOf('Inline math undirected: $x^10$') + 'Inline math undirected: $'.length;
  const undirectedConstructEnd = undirectedConstructIdx + 'x^10'.length;
  expect(directedConstructIdx).toBeGreaterThan('Inline math directed: $'.length - 1);
  expect(undirectedConstructIdx).toBeGreaterThan('Inline math undirected: $'.length - 1);

  // ── SUPPRESSED ARM ──────────────────────────────────────────────────────────
  // Wait for the lint pass to reach the post-suppression steady state: a grouping
  // diagnostic STILL covers the UN-DIRECTED `x^10` (the control fired) AND NO
  // grouping diagnostic covers the DIRECTED `x^10` (the directive silenced it).
  // Both conditions together prove the pass completed and the suppression is
  // line-scoped — not "lint hasn't run yet" (which would also leave the directed
  // line clear). RED today: the directive is inert, so the directed `x^10` stays
  // flagged and this poll times out.
  await tauriPage.waitForFunction(
    `(() => {
      const fn = window.__PPE_E2E__ && window.__PPE_E2E__.lintDiagnostics;
      if (!fn) return false;
      const ds = fn();
      const overlaps = (a,b,c,d) => a < d && c < b;
      const isGrouping = (dg) => {
        if (dg.source === 'chktex:25') return true;
        const m = String(dg.message).toLowerCase();
        return m.includes('{}') || m.includes('braces') || m.includes('superscript') ||
               m.includes('subscript') || m.includes('group') || m.includes('pair of');
      };
      const directedHit = ds.some((dg) =>
        overlaps(dg.from, dg.to, ${directedConstructIdx}, ${directedConstructEnd}) && isGrouping(dg));
      const undirectedHit = ds.some((dg) =>
        overlaps(dg.from, dg.to, ${undirectedConstructIdx}, ${undirectedConstructEnd}) && isGrouping(dg));
      return undirectedHit && !directedHit;
    })()`,
    20_000,
  );

  const suppressed: LintDiagnostic[] = await lintDiagnostics(tauriPage);

  // (A) NO grouping diagnostic covers the DIRECTED `x^10` — the directive silenced
  // its line. KILLS an inert directive.
  const groupingOnDirected = suppressed.filter(
    (d) =>
      rangesOverlap(d.from, d.to, directedConstructIdx, directedConstructEnd) &&
      isGroupingDiagnostic(d),
  );
  expect(groupingOnDirected.length).toBe(0);

  // (B) A grouping diagnostic STILL covers the UN-DIRECTED `x^10` — the suppression
  // is line-scoped, not a whole-class silencing. KILLS an over-broad suppression.
  const groupingOnUndirected = suppressed.filter(
    (d) =>
      rangesOverlap(d.from, d.to, undirectedConstructIdx, undirectedConstructEnd) &&
      isGroupingDiagnostic(d),
  );
  expect(groupingOnUndirected.length).toBeGreaterThan(0);

  // ── RESTORE ARM ─────────────────────────────────────────────────────────────
  // Remove the directive from the directed line by replacing the WHOLE buffer with
  // the directive stripped out, through the real CM update pipeline (a full-doc
  // replace fires the docChanged path the same way typing does), so the plugin
  // re-runs and re-reads the now-directive-free buffer. The construct's text is
  // unchanged; only the trailing directive comment is gone.
  const restored = buffer.replace(` ${DISABLE_DIRECTIVE}`, '');
  expect(restored).not.toContain(DISABLE_DIRECTIVE);
  await tauriPage.evaluate(
    `window.__PPE_E2E__.setEditorText(${JSON.stringify(restored)})`,
  );

  // Recompute the directed `x^10` span in the restored buffer (removing the
  // directive does not move the construct, which precedes it on the line, but the
  // tail of the line shrank — recompute to be exact).
  const restoredBuffer = await editorText(tauriPage);
  const restoredDirectedIdx =
    restoredBuffer.indexOf('Inline math directed: $x^10$') + 'Inline math directed: $'.length;
  const restoredDirectedEnd = restoredDirectedIdx + 'x^10'.length;
  expect(restoredDirectedIdx).toBeGreaterThan('Inline math directed: $'.length - 1);

  // (C) After removing the directive, a grouping diagnostic AGAIN covers the
  // (formerly directed) `x^10`. KILLS a never-restores suppression.
  await tauriPage.waitForFunction(
    `(() => {
      const ds = window.__PPE_E2E__.lintDiagnostics();
      const overlaps = (a,b,c,d) => a < d && c < b;
      const isGrouping = (dg) => {
        if (dg.source === 'chktex:25') return true;
        const m = String(dg.message).toLowerCase();
        return m.includes('{}') || m.includes('braces') || m.includes('superscript') ||
               m.includes('subscript') || m.includes('group') || m.includes('pair of');
      };
      return ds.some((dg) =>
        overlaps(dg.from, dg.to, ${restoredDirectedIdx}, ${restoredDirectedEnd}) && isGrouping(dg));
    })()`,
    20_000,
  );

  const restoredDiagnostics: LintDiagnostic[] = await lintDiagnostics(tauriPage);
  const groupingOnRestored = restoredDiagnostics.filter(
    (d) =>
      rangesOverlap(d.from, d.to, restoredDirectedIdx, restoredDirectedEnd) &&
      isGroupingDiagnostic(d),
  );
  expect(groupingOnRestored.length).toBeGreaterThan(0);

  recordObservation({
    spec: manifest.spec,
    name: 'undirected-grouping-message',
    value: groupingOnUndirected[0]?.message ?? '',
  });
  recordObservation({
    spec: manifest.spec,
    name: 'restored-grouping-message',
    value: groupingOnRestored[0]?.message ?? '',
  });
});
