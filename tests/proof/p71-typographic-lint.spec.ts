import { test, expect } from './fixtures';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  appendAtEnd,
  editorText,
  lintDiagnostics,
  type LintDiagnostic,
} from './support/app';

// ── P71 — ChkTeX typographic classes fire only when their PLUGIN config enables
//          them, scoped to math, and vanish when the config disables them ───────
//
// THE OBLIGATION (Phase A plan, A.2; proposed proof P71, exact intent):
//   The typographic ChkTeX warning classes — operator-as-variable (`sin`→`\sin`,
//   ChkTeX warning 35) and sub/superscript grouping (`x^10`→`x^{10}`, ChkTeX
//   warning 25) — are surfaced as live `@codemirror/lint` diagnostics in the
//   editor gutter, each class toggleable from config, and math-scoped exactly as
//   ChkTeX scopes them. With the classes ENABLED, a MATH line containing `sin x`
//   and `x^10` yields diagnostics whose ranges cover `sin` and `x^10` and whose
//   messages NAME the corrections; the SAME tokens in PROSE (outside `$…$`) yield
//   NONE; with those classes DISABLED in config, the math-line diagnostics are
//   ABSENT.
//
// ── LINT IS A FIREWALL PLUGIN — THE CONFIG LIVES IN THE PLUGIN SECTION ─────────
// Per the user ruling, the editor owns ZERO lint knowledge: all lint config AND
// logic live in the `pandoc-md-lint` firewall plugin. The typographic toggles are
// therefore part of the PLUGIN's config section `[plugin.pandoc-md-lint]` in the
// hermetic `config.toml` (validated by the plugin's own `config_schema`, delivered
// to the plugin on `PPE_PLUGIN_CONFIG` by the existing generic `run_plugin`
// firewall). There is NO `[editor.lint]` section in the app-core `config.rs`. The
// plugin's `lint.sh` consumes its config to drive the REAL chktex — passing
// `chktex -n <num>` per-warning disable flags (warnings 35 and 25) and running the
// real `/usr/bin/chktex` on the pandoc-emitted `.tex`. The checks are ChkTeX's,
// not a re-authored matcher.
//
// ── WHY THE APP IS RED TODAY (the implementation facts this proof pins) ────────
// The shipped `pandoc-md-lint` plugin (GREEN for P70) runs the real chktex on the
// pandoc-emitted `.tex`, and chktex DOES emit warnings 35/25 on a math line (we
// verified: the markdown `Inline math: $sin x$ with $x^10$.` emits the `.tex`
// `Inline math: \(sin x\) with \(x^10\).` and chktex reports `35` at the `sin`
// column and `25` at the `x^10` column, scoped to the math zone — prose `sin` /
// `x^10` produce neither). BUT the plugin's anchoring step
// (`anchor_tex_line`, lint.sh) finds the offending `.tex` line VERBATIM in the
// markdown buffer (`buffer.find(text)`). Pandoc REWRITES the math delimiters
// `$…$` → `\(…\)`, so the `.tex` line `… \(sin x\) with \(x^10\).` is NOT present
// verbatim in the buffer (which still reads `… $sin x$ with $x^10$.`); the
// `buffer.find` MISSES and the chktex 35/25 records are DROPPED. The typographic
// diagnostics therefore NEVER reach the editor. Independently, the plugin's
// `schema.json` accepts ONLY `{"command": ...}` and its `lint.sh` reads ONLY the
// command — it passes NO `chktex -n` disable flags and consults NO typographic
// config, so there is no config gate at all. The class is neither emitted NOR toggleable.
// This spec is RED on the ENABLED arm (the math `sin`/`x^10` are never marked)
// before the DISABLED arm is even reached.
//
// ── THE OBSERVABLE CONTRACT (hooks + observable, BLIND to implementation) ──────
// Observed through the SAME live `@codemirror/lint` field the gutter renders, via
// the established harness hooks (GREEN for P70):
//   __PPE_E2E__.lintDiagnostics(): {from,to,severity,message,source}[]  [reused]
//     The live, `forceLinting`-flushed diagnostics; `from`/`to` are character
//     offsets into the buffer, `source` carries the producing rule id (here the
//     `chktex:35` / `chktex:25` ids the plugin emits for the typographic classes).
//   __PPE_E2E__.getEditorText()  [reused]  — the live editor buffer text.
//   __PPE_E2E__.appendAtEnd(text) [reused] — append through the REAL CM update
//     pipeline (docChanged path) so the lint source re-runs as it does for typing.
//
// The config is driven through the hermetic `config.toml`'s `[plugin.pandoc-md-lint]`
// section (the manifest's `configPath`): this spec ENABLES the typographic classes
// there for the enabled arm, then DISABLES them on disk and forces a fresh lint
// pass for the disabled arm. `run_plugin` reloads the config (`config::load()`) on
// EVERY invocation, so a disk rewrite is picked up by the next pass — flipping the
// config and re-reading proves the config is load-bearing.
//
// ── THE WITNESS (a real math line + a real prose line; chktex math-scopes) ─────
//   MATH line:  an inline math zone `$sin x$` and `$x^10$` — chktex emits warning
//     35 (operator-as-variable) covering `sin` and warning 25 (sub/superscript
//     grouping) covering `x^10`, scoped to the math zone.
//   PROSE line: the SAME tokens `sin` and `x^10` OUTSIDE any `$…$` — pandoc keeps
//     `sin` a literal word and escapes `x^10` → `x\^{}10`, so chktex emits NEITHER
//     35 nor 25. The prose arm proves the layer respects math scope.
// Both lines are APPENDED to the demo buffer (so the spans are NEW, not pre-
// existing) through the real CM update pipeline.
//
// ── WHAT EACH ASSERTION KILLS ─────────────────────────────────────────────────
//   ENABLED ARM (classes on in the plugin config):
//   (A) A diagnostic's range covers the MATH `sin` AND its message NAMES the
//       operator correction (mentions `\sin` / sin / operator).
//       KILLS "no typographic layer": today the chktex 35 record is dropped at
//       anchoring (math-rewritten line not found verbatim) and no config enables
//       the class, so nothing covers the math `sin`.
//   (B) A diagnostic's range covers the MATH `x^10` AND its message NAMES the
//       sub/superscript-grouping correction (mentions `{}` / superscript / group).
//       KILLS the same missing layer for the grouping class.
//   (C) NO diagnostic covers the PROSE `sin` with an operator-correction message,
//       and NO diagnostic covers the PROSE `x^10` with a grouping message.
//       KILLS a layer that ignores math scope (a naive whole-buffer matcher that
//       flags the prose tokens too) — chktex math-scopes natively, so a faithful
//       chktex-driven layer marks ONLY the math tokens.
//
//   DISABLED ARM (classes turned off in the SAME plugin config, on disk):
//   (D) After rewriting `[plugin.pandoc-md-lint]` to DISABLE the typographic
//       classes and forcing a fresh lint pass, NO diagnostic covers the math `sin`
//       with an operator message and NO diagnostic covers the math `x^10` with a
//       grouping message.
//       KILLS a layer that ignores config (a hardcoded/dead-config class that
//       keeps marking the tokens even when the config disables it) — the gate must
//       be load-bearing.

// The math line: an inline zone with `sin x` (→ \sin) and `x^10` (→ x^{10}).
const MATH_LINE = '\n\nInline math here: $sin x$ with $x^10$.\n';
// The prose line: the SAME tokens, outside any math zone.
const PROSE_LINE = '\n\nA prose paragraph mentioning sin as a word and x^10 as plain text.\n';

// True iff `[a,b)` and `[c,d)` overlap — a diagnostic "covers" a span when its
// marked range intersects the span's character range.
function rangesOverlap(a: number, b: number, c: number, d: number): boolean {
  return a < d && c < b;
}

// Names the OPERATOR-as-variable correction (ChkTeX 35 → `\sin`): the message must
// speak to the operator / the `\sin` form.
function namesOperator(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('\\sin') || m.includes('sin') || m.includes('operator');
}

// Names the SUB/SUPERSCRIPT-grouping correction (ChkTeX 25 → `x^{10}`): the
// message must speak to grouping / braces / sub- or superscript.
function namesGrouping(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('{}') ||
    m.includes('braces') ||
    m.includes('superscript') ||
    m.includes('subscript') ||
    m.includes('group') ||
    m.includes('pair of')
  );
}

// Set the typographic toggles in the on-disk `[plugin.pandoc-md-lint]` config
// section, preserving every other line verbatim. A targeted line-based injection
// (find the `[plugin.pandoc-md-lint]` header, drop any prior typographic keys in
// that section, insert the two toggles immediately after the header) — NOT a
// full-config re-emit, so no other table or value can be lost. `run_plugin`
// reloads config on every pass, so the next lint reads this. The keys the plugin
// config OWNS for the two classes: operator-as-variable (ChkTeX 35) and
// sub/superscript grouping (ChkTeX 25).
function setTypographicToggles(configPath: string, enabled: boolean): void {
  const raw = readFileSync(configPath, 'utf-8');
  const lines = raw.split('\n');
  const header = '[plugin.pandoc-md-lint]';
  const headerIdx = lines.indexOf(header);
  if (headerIdx < 0) {
    throw new Error(`config has no ${header} section to gate: ${configPath}`);
  }
  // The section spans from the header to the next `[`-table header (or EOF).
  let sectionEnd = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('[')) {
      sectionEnd = i;
      break;
    }
  }
  const TOGGLE_KEYS = ['operator_as_variable', 'script_grouping'];
  // Body of the section minus any pre-existing toggle keys (so a re-set replaces
  // rather than duplicates them — a duplicate key is a TOML error).
  const body = lines
    .slice(headerIdx + 1, sectionEnd)
    .filter((l) => !TOGGLE_KEYS.some((k) => l.trimStart().startsWith(`${k} `) || l.trimStart().startsWith(`${k}=`)));
  const toggles = TOGGLE_KEYS.map((k) => `${k} = ${enabled ? 'true' : 'false'}`);
  const rebuilt = [
    ...lines.slice(0, headerIdx + 1),
    ...toggles,
    ...body,
    ...lines.slice(sectionEnd),
  ];
  writeFileSync(configPath, rebuilt.join('\n'));
}

test('ChkTeX typographic classes (sin→\\sin, x^10→x^{10}) fire only when enabled in the lint plugin config, scoped to math', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // ENABLE the typographic classes in the plugin config section on disk BEFORE
  // the first lint pass. `run_plugin` reloads config every call, so the next pass
  // reads this.
  setTypographicToggles(manifest.configPath, true);

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // Append the math line and the prose line through the real CM update pipeline.
  await appendAtEnd(tauriPage, MATH_LINE);
  await appendAtEnd(tauriPage, PROSE_LINE);

  const buffer = await editorText(tauriPage);
  // The MATH spans: `sin` and `x^10` inside the inline `$…$` zone.
  const mathSinIdx = buffer.indexOf('$sin x$') + '$'.length;
  const mathSinEnd = mathSinIdx + 'sin'.length;
  const mathScriptIdx = buffer.indexOf('$x^10$') + '$'.length;
  const mathScriptEnd = mathScriptIdx + 'x^10'.length;
  // The PROSE spans: the SAME tokens outside any math zone.
  const proseSinIdx = buffer.indexOf('mentioning sin as') + 'mentioning '.length;
  const proseSinEnd = proseSinIdx + 'sin'.length;
  const proseScriptIdx = buffer.indexOf('and x^10 as plain') + 'and '.length;
  const proseScriptEnd = proseScriptIdx + 'x^10'.length;
  expect(mathSinIdx).toBeGreaterThan('$'.length - 1);
  expect(mathScriptIdx).toBeGreaterThan('$'.length - 1);
  expect(proseSinIdx).toBeGreaterThan('mentioning '.length - 1);
  expect(proseScriptIdx).toBeGreaterThan('and '.length - 1);

  // ── ENABLED ARM ─────────────────────────────────────────────────────────────
  // Wait for the lint pass to surface, in the live field, a diagnostic covering the
  // MATH `sin` with an operator-correction message AND a diagnostic covering the
  // MATH `x^10` with a grouping message. RED today: the chktex 35/25 records are
  // dropped at anchoring (the math-rewritten `.tex` line is not found verbatim in
  // the buffer) and no config enables the class, so this poll times out.
  await tauriPage.waitForFunction(
    `(() => {
      const fn = window.__PPE_E2E__ && window.__PPE_E2E__.lintDiagnostics;
      if (!fn) return false;
      const ds = fn();
      const overlaps = (a,b,c,d) => a < d && c < b;
      const namesOp = (msg) => {
        const m = String(msg).toLowerCase();
        return m.includes('\\\\sin') || m.includes('sin') || m.includes('operator');
      };
      const namesGrp = (msg) => {
        const m = String(msg).toLowerCase();
        return m.includes('{}') || m.includes('braces') || m.includes('superscript') ||
               m.includes('subscript') || m.includes('group') || m.includes('pair of');
      };
      const op = ds.some((dg) =>
        overlaps(dg.from, dg.to, ${mathSinIdx}, ${mathSinEnd}) && namesOp(dg.message));
      const grp = ds.some((dg) =>
        overlaps(dg.from, dg.to, ${mathScriptIdx}, ${mathScriptEnd}) && namesGrp(dg.message));
      return op && grp;
    })()`,
    20_000,
  );

  const enabled: LintDiagnostic[] = await lintDiagnostics(tauriPage);

  // (A) A diagnostic covers the MATH `sin` and NAMES the operator correction.
  const opCoveringMath = enabled.filter(
    (d) => rangesOverlap(d.from, d.to, mathSinIdx, mathSinEnd) && namesOperator(d.message),
  );
  expect(opCoveringMath.length).toBeGreaterThan(0);

  // (B) A diagnostic covers the MATH `x^10` and NAMES the grouping correction.
  const grpCoveringMath = enabled.filter(
    (d) =>
      rangesOverlap(d.from, d.to, mathScriptIdx, mathScriptEnd) && namesGrouping(d.message),
  );
  expect(grpCoveringMath.length).toBeGreaterThan(0);

  // (C) NO diagnostic covers the PROSE `sin`/`x^10` with the typographic messages —
  // the layer respects math scope (chktex math-scopes these natively).
  const opCoveringProse = enabled.filter(
    (d) => rangesOverlap(d.from, d.to, proseSinIdx, proseSinEnd) && namesOperator(d.message),
  );
  expect(opCoveringProse.length).toBe(0);
  const grpCoveringProse = enabled.filter(
    (d) =>
      rangesOverlap(d.from, d.to, proseScriptIdx, proseScriptEnd) && namesGrouping(d.message),
  );
  expect(grpCoveringProse.length).toBe(0);

  // ── DISABLED ARM ────────────────────────────────────────────────────────────
  // Turn the typographic classes OFF in the SAME plugin config section on disk.
  // `run_plugin` reloads config on the next pass, so a fresh lint must drop the
  // class entirely.
  setTypographicToggles(manifest.configPath, false);

  // Force a fresh lint pass over the (unchanged) buffer by a no-op-shaped edit that
  // fires the docChanged path. Append a trailing newline (does not move the witness
  // spans) so the lint source re-runs with the new config.
  await appendAtEnd(tauriPage, '\n');

  // (D) After disabling, NO diagnostic covers the math `sin` with an operator
  // message and NO diagnostic covers the math `x^10` with a grouping message. The
  // config gate is load-bearing. KILLS a hardcoded/dead-config class.
  await tauriPage.waitForFunction(
    `(() => {
      const ds = window.__PPE_E2E__.lintDiagnostics();
      const overlaps = (a,b,c,d) => a < d && c < b;
      const namesOp = (msg) => {
        const m = String(msg).toLowerCase();
        return m.includes('\\\\sin') || m.includes('sin') || m.includes('operator');
      };
      const namesGrp = (msg) => {
        const m = String(msg).toLowerCase();
        return m.includes('{}') || m.includes('braces') || m.includes('superscript') ||
               m.includes('subscript') || m.includes('group') || m.includes('pair of');
      };
      const opStuck = ds.some((dg) =>
        overlaps(dg.from, dg.to, ${mathSinIdx}, ${mathSinEnd}) && namesOp(dg.message));
      const grpStuck = ds.some((dg) =>
        overlaps(dg.from, dg.to, ${mathScriptIdx}, ${mathScriptEnd}) && namesGrp(dg.message));
      return !opStuck && !grpStuck;
    })()`,
    20_000,
  );

  const disabled: LintDiagnostic[] = await lintDiagnostics(tauriPage);

  const opStillCovering = disabled.filter(
    (d) => rangesOverlap(d.from, d.to, mathSinIdx, mathSinEnd) && namesOperator(d.message),
  );
  expect(opStillCovering.length).toBe(0);
  const grpStillCovering = disabled.filter(
    (d) =>
      rangesOverlap(d.from, d.to, mathScriptIdx, mathScriptEnd) && namesGrouping(d.message),
  );
  expect(grpStillCovering.length).toBe(0);

  recordObservation({
    spec: manifest.spec,
    name: 'math-operator-diagnostic-message',
    value: opCoveringMath.find((d) => namesOperator(d.message))?.message ?? '',
  });
  recordObservation({
    spec: manifest.spec,
    name: 'math-grouping-diagnostic-message',
    value: grpCoveringMath.find((d) => namesGrouping(d.message))?.message ?? '',
  });
});
