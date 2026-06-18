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

// ── P72 — A config-owned user-regex lint rule surfaces as a diagnostic, and a
//          DIFFERENT rule set surfaces THAT rule instead (ChkTeX UserWarnRegex) ──
//
// THE OBLIGATION (Phase A plan, A.3; proposed proof P72, exact intent):
//   A config-owned list of house-style rules `{pattern, message, severity?}` is
//   surfaced as live `@codemirror/lint` diagnostics via ChkTeX's `UserWarnRegex`
//   (warning 44) — NOT an app-owned regex engine. With a rule
//   `{pattern: "\\bTODO\\b", message: "resolve before submission"}` in the config,
//   typing `TODO` into the buffer yields a diagnostic whose range covers the
//   `TODO` token and whose message is EXACTLY `resolve before submission`. Pointing
//   the config at a DIFFERENT rule set (a different pattern + message) makes the
//   buffer surface THAT rule's diagnostic instead — proving the config, not a
//   hardcoded rule list, drives the matcher.
//
// ── LINT IS A FIREWALL PLUGIN — THE CONFIG LIVES IN THE PLUGIN SECTION ─────────
// Per the user ruling, the editor owns ZERO lint knowledge: all lint config AND
// logic live in the `pandoc-md-lint` firewall plugin. The user-regex rule list is
// therefore part of the PLUGIN's config section `[plugin.pandoc-md-lint]` in the
// hermetic `config.toml` (validated by the plugin's own `config_schema`, delivered
// to the plugin on `PPE_PLUGIN_CONFIG` by the existing generic `run_plugin`
// firewall). There is NO `[editor.lint]` section in the app-core `config.rs`. The
// plugin's `lint.sh` consumes its `lint_rules` to GENERATE a `chktexrc` with one
// `UserWarnRegex` entry per rule and runs the real `/usr/bin/chktex` on the
// pandoc-emitted `.tex`; the resulting warning-44 record is anchored back to the
// markdown buffer and carries the rule's declared message. The regex engine is
// ChkTeX's (PCRE), not a re-authored matcher.
//
// ── WHY THE APP IS RED TODAY (the implementation facts this proof pins) ────────
// The shipped `pandoc-md-lint` plugin (GREEN for P70/P71) accepts ONLY the keys
// `{command, operator_as_variable, script_grouping}` — its `schema.json` declares
// `additionalProperties: false` and does NOT include `lint_rules`, and its
// `lint.sh` reads ONLY those three keys: it generates NO `chktexrc` UserWarnRegex
// entry and consults NO user-rule config. There is therefore no user-regex engine
// at all. A `lint_rules` rule for `\bTODO\b` is INERT — `chktex` runs with its
// built-in warnings only (which never flag a literal `TODO` word), so NO
// diagnostic ever covers a typed `TODO`. The class is neither emitted NOR
// config-driven. This spec is RED on the FIRST arm (the typed `TODO` is never
// marked with the declared message) before the second rule set is even reached.
//
// (Verified independently: `/usr/bin/chktex` v1.7.8 IS compiled with PCRE support
// and, GIVEN a `chktexrc` carrying `UserWarnRegex { PCRE:\bTODO\b }`, DOES emit a
// warning-44 record on a line containing `TODO`. The missing piece is entirely the
// plugin: it neither accepts `lint_rules` in its schema nor renders it into a
// `chktexrc`, so the real engine is never given the user rule.)
//
// ── THE OBSERVABLE CONTRACT (hooks + observable, BLIND to implementation) ──────
// Observed through the SAME live `@codemirror/lint` field the gutter renders, via
// the established harness hooks (GREEN for P70/P71):
//   __PPE_E2E__.lintDiagnostics(): {from,to,severity,message,source}[]  [reused]
//     The live, `forceLinting`-flushed diagnostics; `from`/`to` are character
//     offsets into the buffer, `message` is the human-readable text the gutter
//     shows, `source` carries the producing rule id (here the `chktex:44`
//     UserWarnRegex id the plugin emits for a user rule).
//   __PPE_E2E__.getEditorText()  [reused]  — the live editor buffer text.
//   __PPE_E2E__.appendAtEnd(text) [reused] — append through the REAL CM update
//     pipeline (docChanged path) so the lint source re-runs as it does for typing.
//
// The config is driven through the hermetic `config.toml`'s `[plugin.pandoc-md-lint]`
// section (the manifest's `configPath`): this spec writes RULE SET A there for the
// first arm, then OVERWRITES it with RULE SET B on disk and forces a fresh lint
// pass for the second arm. `run_plugin` reloads the config (`config::load()`) on
// EVERY invocation, so a disk rewrite is picked up by the next pass — flipping the
// rule set and re-reading proves the config is load-bearing.
//
// ── THE WITNESSES (two distinct house-style tokens, each owned by ONE rule) ────
//   RULE SET A: a single rule {pattern: "\\bTODO\\b", message: "resolve before
//     submission"}. The witness token is the prose word `TODO`.
//   RULE SET B (different pattern AND message): {pattern: "\\bFIXME\\b", message:
//     "address this defect before merge"}. The witness token is the prose word
//     `FIXME`.
//   Both witness words are APPENDED to the demo buffer (so the spans are NEW, not
//   pre-existing) through the real CM update pipeline. The demo buffer contains
//   neither word, so any diagnostic on them is the user rule's product.
//
// ── WHAT EACH ASSERTION KILLS ─────────────────────────────────────────────────
//   RULE-SET-A ARM (rule A in the plugin config):
//   (A) A diagnostic's range covers the typed `TODO` AND its message is EXACTLY
//       the rule's declared string `resolve before submission`.
//       KILLS "no user-regex engine": today the plugin neither accepts `lint_rules`
//       nor renders a `UserWarnRegex`, so `chktex` never flags the literal `TODO`
//       and nothing covers that span.
//       KILLS a message mismatch: the diagnostic's message must be the
//       CONFIG-DECLARED string verbatim, not ChkTeX's built-in `User Regex: ...`
//       boilerplate nor a generic label — the rule's `message` is load-bearing.
//   (B) NO diagnostic covers the typed `FIXME` (rule B's token) while rule set A is
//       active. KILLS a hardcoded rule list that flags every house-style token
//       regardless of which rules the config declares.
//
//   RULE-SET-B ARM (the SAME plugin config OVERWRITTEN with rule B, on disk):
//   (C) After replacing the rule set on disk with rule B and forcing a fresh lint
//       pass, a diagnostic's range covers the typed `FIXME` AND its message is
//       EXACTLY rule B's declared string `address this defect before merge`.
//       KILLS a hardcoded/dead-config rule list: a different config rule set must
//       produce a DIFFERENT diagnostic — the config gate is load-bearing.
//   (D) After the swap, NO diagnostic covers the typed `TODO` with rule A's
//       message. KILLS a rule engine that ignores config removals (a stuck rule
//       that keeps firing after its rule was removed from the config).

// Rule set A: a single user rule whose token is the prose word `TODO`.
const RULE_A_PATTERN = '\\bTODO\\b';
const RULE_A_MESSAGE = 'resolve before submission';
// Rule set B: a DIFFERENT pattern AND message, token is the prose word `FIXME`.
const RULE_B_PATTERN = '\\bFIXME\\b';
const RULE_B_MESSAGE = 'address this defect before merge';

// The witness lines: each carries exactly one of the two house-style tokens, as a
// plain prose word (the demo buffer contains neither word).
const TODO_LINE = '\n\nA prose line carrying the word TODO as a literal token.\n';
const FIXME_LINE = '\n\nAnother prose line carrying the word FIXME as a literal token.\n';

// True iff `[a,b)` and `[c,d)` overlap — a diagnostic "covers" a span when its
// marked range intersects the span's character range.
function rangesOverlap(a: number, b: number, c: number, d: number): boolean {
  return a < d && c < b;
}

// Set the user-regex rule list in the on-disk `[plugin.pandoc-md-lint]` config
// section to EXACTLY the given rules, preserving every other line verbatim. A
// targeted line-based injection (find the `[plugin.pandoc-md-lint]` header, drop
// any prior `lint_rules` assignment in that section, insert a single
// `lint_rules = [ {inline table}, ... ]` line immediately after the header) — NOT
// a full-config re-emit, so no other table or value can be lost. `run_plugin`
// reloads config on every pass, so the next lint reads this. The key the plugin
// config OWNS for the user-regex rules: `lint_rules`, an array of
// `{pattern, message}` tables rendered into ChkTeX `UserWarnRegex` entries.
function setLintRules(
  configPath: string,
  rules: { pattern: string; message: string }[],
): void {
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
  // Body of the section minus any pre-existing `lint_rules` assignment (so a re-set
  // replaces rather than duplicates it — a duplicate key is a TOML error).
  const body = lines
    .slice(headerIdx + 1, sectionEnd)
    .filter(
      (l) =>
        !l.trimStart().startsWith('lint_rules ') &&
        !l.trimStart().startsWith('lint_rules='),
    );
  // A single-line TOML array of inline tables. Each pattern/message is JSON-encoded
  // (TOML basic strings share JSON's double-quote + backslash-escape rules), so a
  // backslash in the pattern (`\\bTODO\\b`) survives the round-trip into the file.
  const inlineRules = rules
    .map(
      (r) =>
        `{ pattern = ${JSON.stringify(r.pattern)}, message = ${JSON.stringify(r.message)} }`,
    )
    .join(', ');
  const ruleLine = `lint_rules = [ ${inlineRules} ]`;
  const rebuilt = [
    ...lines.slice(0, headerIdx + 1),
    ruleLine,
    ...body,
    ...lines.slice(sectionEnd),
  ];
  writeFileSync(configPath, rebuilt.join('\n'));
}

test('A config-owned user-regex lint rule surfaces a diagnostic with its declared message, and a different rule set surfaces that rule instead', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // Install RULE SET A in the plugin config section on disk BEFORE the first lint
  // pass. `run_plugin` reloads config every call, so the next pass reads this.
  setLintRules(manifest.configPath, [
    { pattern: RULE_A_PATTERN, message: RULE_A_MESSAGE },
  ]);

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // Append BOTH witness lines through the real CM update pipeline so both tokens
  // exist in the buffer for the whole test (only the active rule set decides which
  // one is flagged).
  await appendAtEnd(tauriPage, TODO_LINE);
  await appendAtEnd(tauriPage, FIXME_LINE);

  const buffer = await editorText(tauriPage);
  const todoIdx = buffer.indexOf('word TODO as') + 'word '.length;
  const todoEnd = todoIdx + 'TODO'.length;
  const fixmeIdx = buffer.indexOf('word FIXME as') + 'word '.length;
  const fixmeEnd = fixmeIdx + 'FIXME'.length;
  expect(todoIdx).toBeGreaterThan('word '.length - 1);
  expect(fixmeIdx).toBeGreaterThan('word '.length - 1);

  // ── RULE-SET-A ARM ──────────────────────────────────────────────────────────
  // Wait for the lint pass to surface, in the live field, a diagnostic covering the
  // typed `TODO` whose message is EXACTLY rule A's declared string. RED today: the
  // plugin neither accepts `lint_rules` nor renders a `UserWarnRegex`, so chktex
  // never flags `TODO` and this poll times out.
  await tauriPage.waitForFunction(
    `(() => {
      const fn = window.__PPE_E2E__ && window.__PPE_E2E__.lintDiagnostics;
      if (!fn) return false;
      const ds = fn();
      const overlaps = (a,b,c,d) => a < d && c < b;
      return ds.some((dg) =>
        overlaps(dg.from, dg.to, ${todoIdx}, ${todoEnd}) &&
        dg.message === ${JSON.stringify(RULE_A_MESSAGE)});
    })()`,
    20_000,
  );

  const arenaA: LintDiagnostic[] = await lintDiagnostics(tauriPage);

  // (A) A diagnostic covers the typed `TODO` and its message is EXACTLY rule A's
  // declared string.
  const coveringTodoA = arenaA.filter(
    (d) => rangesOverlap(d.from, d.to, todoIdx, todoEnd) && d.message === RULE_A_MESSAGE,
  );
  expect(coveringTodoA.length).toBeGreaterThan(0);

  // (B) NO diagnostic covers the typed `FIXME` (rule B's token) while rule set A is
  // active — the matcher fires only on the config-declared rules.
  const coveringFixmeA = arenaA.filter(
    (d) => rangesOverlap(d.from, d.to, fixmeIdx, fixmeEnd) && d.message === RULE_B_MESSAGE,
  );
  expect(coveringFixmeA.length).toBe(0);

  // ── RULE-SET-B ARM ──────────────────────────────────────────────────────────
  // OVERWRITE the rule list in the SAME plugin config section on disk with rule B
  // (a different pattern AND message). `run_plugin` reloads config on the next
  // pass, so a fresh lint must drop rule A's diagnostic and surface rule B's.
  setLintRules(manifest.configPath, [
    { pattern: RULE_B_PATTERN, message: RULE_B_MESSAGE },
  ]);

  // Force a fresh lint pass over the (witness-unchanged) buffer by an append that
  // fires the docChanged path. A trailing newline does not move the witness spans.
  await appendAtEnd(tauriPage, '\n');

  // (C) After the swap, a diagnostic covers the typed `FIXME` whose message is
  // EXACTLY rule B's declared string. The config gate is load-bearing.
  await tauriPage.waitForFunction(
    `(() => {
      const ds = window.__PPE_E2E__.lintDiagnostics();
      const overlaps = (a,b,c,d) => a < d && c < b;
      return ds.some((dg) =>
        overlaps(dg.from, dg.to, ${fixmeIdx}, ${fixmeEnd}) &&
        dg.message === ${JSON.stringify(RULE_B_MESSAGE)});
    })()`,
    20_000,
  );

  const arenaB: LintDiagnostic[] = await lintDiagnostics(tauriPage);

  const coveringFixmeB = arenaB.filter(
    (d) => rangesOverlap(d.from, d.to, fixmeIdx, fixmeEnd) && d.message === RULE_B_MESSAGE,
  );
  expect(coveringFixmeB.length).toBeGreaterThan(0);

  // (D) After the swap, NO diagnostic covers the typed `TODO` with rule A's message
  // — rule A was removed from the config and its diagnostic must be gone.
  const coveringTodoB = arenaB.filter(
    (d) => rangesOverlap(d.from, d.to, todoIdx, todoEnd) && d.message === RULE_A_MESSAGE,
  );
  expect(coveringTodoB.length).toBe(0);

  recordObservation({
    spec: manifest.spec,
    name: 'rule-a-diagnostic-message',
    value: coveringTodoA.find((d) => d.message === RULE_A_MESSAGE)?.message ?? '',
  });
  recordObservation({
    spec: manifest.spec,
    name: 'rule-b-diagnostic-message',
    value: coveringFixmeB.find((d) => d.message === RULE_B_MESSAGE)?.message ?? '',
  });
});
