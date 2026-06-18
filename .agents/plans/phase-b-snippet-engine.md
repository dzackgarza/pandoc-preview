# Phase B — Snippet Engine Depth + quicktex Migration (implementation plan)

Durable, resumable roadmap for the SECOND phase of the Competitive Parity Roadmap:
turning the flat config-dictionary snippet model (P52 popup path / P59 bar-dropdown
path) into a real snippet ENGINE — the LuaSnip/UltiSnips capability layer the heritage
vim workflow actually used, realized by LEVERAGING CodeMirror 6's own snippet machinery
and the standard TextMate snippet body format — and replacing the bespoke flattened
`quicktex.json` asset with DIRECT interop: consuming the standard quicktex definition-file
format (`g:quicktex_prose`/`g:quicktex_math`) so the user's existing dict is supported with
zero porting.

This is a **repo artifact** (future-work + current-state), NOT a memory. It matches the
style of `.agents/render-rebuild-plan.md`. The durable *decisions* and the parity
*evidence* live in memory: [[competitive-parity-roadmap]] (Phase B = the exact
deliverables), [[parity-research/quicktex]] (the source format + its trigger/jump/mode
semantics), [[parity-research/snippet-and-lint-ecosystem]] (the LuaSnip/UltiSnips engine
capabilities being generalized), [[parity-research/zettlr]] (snippet variables),
[[lineage-vim-live-texing-setup]] (the Castel "as fast as the blackboard" ideal this
serves), [[feature-catalogue-and-implementation-status]] (Tier-0 snippets),
[[editor-experience-targets-conceals-folding-expansion]] (the 281-entry dict as the
personal authoring vocabulary spec).

If interrupted, resume from the **Status / resume here** section at the bottom.

**Deliverable + priority rationale.** Phase B is *second* in the parity push (after the
Phase A static-lint cluster) because snippets/autocomplete are the next daily-friction
win and the heritage workflow's core ergonomic ([[competitive-parity-roadmap]] Phase B
intro). The single keystone is **math-mode-only expansion**: a math-zone predicate
gating which snippets are live. Without it, the short single-letter math triggers (`m`,
`M`, `st`) the quicktex prose/math split depends on are unsafe — they would fire in
prose. Everything else in this phase (autotrigger, regex/postfix, mirrors, variables)
composes on top of that gate. Phase B does NOT re-plan P51 (composable completion), P52
(flat-dict popup expansion), or P59 (bar dropdown) — those are already GREEN; this phase
builds the engine layer on top of the seams they established.

## Source items (from the roadmap)

Copied verbatim from [[competitive-parity-roadmap]] "## Phase B", with status tags:

| Item | Status | Rel |
| --- | --- | --- |
| Math-mode-only expansion (a math-zone predicate gating which snippets/dict entries are live) — the keystone capability | net-new gap | High |
| Autotrigger / space-trigger auto-expansion (expand on next space, no accept keypress, re-arms for chained expansion) — quicktex's defining "as fast as the blackboard" ergonomic | net-new gap | High |
| Regex / postfix triggers with capture groups (`phat`→`\hat{p}`, `([a-z])bar`→`\bar{$1}`) | net-new gap | High |
| Mirrored tabstops (type env name once → mirrored into the closing fence/`\end`) | refines P52 (single tabstop only) | High |
| **Support standard quicktex definition files directly** — consume the source `g:quicktex_prose`/`g:quicktex_math` format so the user brings their existing dict with ZERO porting; the flat shipped `quicktex.json` is a degraded one-way flattening (prose/math split lost, 281→262) to be REPLACED by direct interop, not maintained as a fork or produced by a one-way converter | net-new gap (interop) | High |
| Snippet variables (`$CLIPBOARD`, `$CURRENT_DATE`, TextMate dynamic vars) | refines P52/P59 | Med |
| Transform/function nodes (derive a label from a title; case transforms) | net-new gap | Med |
| Visual-selection wrap (`${VISUAL}`: select → wrap in `\emph{}`/environment) | net-new gap | Med |

**Excluded (recorded so no future synthesis re-proposes them):** UltiSnips shell/Python/
Vimscript interpolation (banned security/portability surface, gimmick); LuaSnip dynamic/
restore nodes (heavy, Low). The vim-keystroke-sequence bodies (`\<CR>`, `\<Right>`) are
NOT ported as a keystroke interpreter — they map to CM6 `${1}`/`${2}` template syntax.

## Discipline

Identical to `render-rebuild-plan.md` and `proof-obligations.md`:

- **Interop-first / research-first (AGENTS.md HARD RULE #0) governs EVERY work item.** The
  FIRST action of each B-item below is the research step: name the existing tool / library /
  binary / standard data-format / reference implementation that already does this, and state
  what is leveraged, supported (its native files consumed directly), or ported. Greenfield is
  rejected — "write a new X" with no such anchor is sent back for the research step, and a
  "converter that flattens an existing format into a bespoke shape" is the specific red flag
  this phase must avoid (it is exactly what the shipped flat `quicktex.json` is). The engine is
  CodeMirror 6's own `@codemirror/autocomplete` snippet machinery; the body grammar is the
  established TextMate/VSCode snippet format; the dictionary source is the standard quicktex
  definition file. Imitation of these is rejected in favour of consuming/using them directly.
- TDD per sub-milestone: design → RED proof obligation (user-ratified) → commit RED →
  GREEN → commit. Each sub-milestone gates on its proof green before the next starts.
  RED must FAIL FOR THE RIGHT REASON (the absent capability), verified before GREEN.
- **Existing obligations P1–P69 stay green throughout.** A sub-milestone that would break
  one must be re-scoped. P51/P52/P59 are the direct neighbours — the engine layer EXTENDS
  them and must not regress the popup-accept path or the bar-dropdown path.
- Proof obligations are EXACT externally observable happy-path states — real display, real
  CM6 editor, real config, real filesystem. Admissible only if they would FAIL on a
  plausibly broken app (no-op source, mode-blind expansion, ignored dictionary). A test
  that still passes on a mode-blind or no-op engine is banned (see global red-flag rules).
- No fallbacks / runtime defaults / mocks; fail loud. A declared-but-unparseable
  dictionary is a hard toast error, never a silently-empty source (the existing P52
  contract in `snippets.ts::parseSnippetDictionary`). Single-user Linux; opinionated
  config only.
- **No source-content meta-assertions in the proof suite.** Behavioral subsumption only —
  e.g. the math-mode gate is proven by a trigger firing in math and NOT in prose, never by
  grepping for a predicate call.
- RESERVED obligation block **P77–P83** (proposed below; do NOT edit
  `proof-obligations.md` — these are PROPOSALS to ratify before RED).
- Verification vehicle: the real app via `tauri-plugin-playwright` under Xvfb, the
  existing webview proof harness (`tests/proof/pNN-*.spec.ts`), the same E2E bridge
  (`window.__PPE_E2E__` + the `EditorPane` exported harness methods). New specs are
  webview-class (`p33+` family is taken; this phase uses `p55`-adjacent NN free of the
  insertion-bar block — concrete spec numbers settled by the test author at RED time).

## Current code seams (what gets touched/extended)

The flat-dict model is fully implemented and GREEN. Phase B attaches the engine layer at
these exact seams:

- **`src/lib/editor/snippets.ts`** (the P52 source). Today: `parseSnippetDictionary(json)`
  → `SnippetMap` (flat `Record<trigger, body>`, fail-loud on non-string bodies);
  `normalizeTabstops(body)` rewrites bare `$N`→`${N}` so CM6's parser sees tabstops;
  `snippetCompletionSource(map)` returns a `CompletionSource` that, on `matchBefore(/\S+/)`,
  offers every trigger the typed token is a prefix of via `snippetCompletion(...)`;
  `runSnippet(view, body)` expands a body at the cursor through the SAME
  `snippetCompletion().apply` path (this is what the insertion bar reuses). **This is the
  attach point for the engine.** The flat-dict expansion works by building one
  `snippetCompletion` per entry; the math gate, autotrigger, and regex triggers wrap or
  replace `snippetCompletionSource`'s body without changing `runSnippet`'s expansion path.
  The converter ALREADY collapses `<+++>`→`$0` and DROPS `<++>` secondary placeholders
  (the mirrored/multi-tabstop gap — Phase B restores them as `${1}`/`${2}` mirrors).

- **`vendor/codemirror-lang-latex/src/completion.ts`** (the vendored fork — submodule, app
  is source of truth). Contains `function isInMathMode(context: CompletionContext): boolean`
  (lines 35–93) — a full prose/math-zone detector tracking `$`/`$$`/`\(`/`\[` and
  `\begin{env}` math environments (`MATH_ENVIRONMENTS`, line 23). **This is the keystone
  detector and it ALREADY EXISTS** — but it is module-private (not in `index.ts` exports;
  `index.ts` re-exports `latexCompletionSource`, `snippets`, `markdownOutline`, etc., not
  `isInMathMode`). B1 EXPORTS it (or a thin `inMathMode(state, pos)` wrapper that does not
  require a `CompletionContext`) so the app's snippet source can gate on the SAME predicate
  the LaTeX command completion already uses (`completion.ts:413,438`). Do NOT reimplement a
  second math detector in the app — OSOT: one predicate, used by both layers.

- **`src/lib/components/EditorPane.svelte`** (the composition core). `appCompletionSources:
  CompletionSource[]` is the mutable registry; `delegatingCompletionSource` fans out to it
  and is folded into `latex({ extraCompletionSources: [...] })` (P51). `registerSnippetDictionary(c)`
  (lines 256–266) reads `c.editor.snippet_dictionary`, parses it, retains `snippetMap`,
  pushes `snippetCompletionSource(map)`, and calls `onSnippetsLoaded(triggers)`.
  `ensureSyntaxTree`/`resolveInner` are already imported (lines 23, 430–490) — available
  for a tree-based math gate if the textual `isInMathMode` is insufficient. Autotrigger
  attaches as a `EditorView.updateListener` or an input-handling keymap entry alongside the
  existing `Ctrl-e` Emmet binding (line 216) — NOT inside the completion source (autotrigger
  fires WITHOUT the popup). `runSnippet`/`insertSnippet` is the shared expansion path the
  insertion bar and accept both use.

- **`src-tauri/src/config.rs`** (`Editor` struct, lines 218–248). `snippet_dictionary:
  Option<ExistingFile>` is the config-declared path (fail-loud `ExistingFile` validation;
  absent = no user snippets). The dict is a JSON object today. Phase B's variable/transform
  metadata and the math/prose split need either (a) a richer per-entry schema (object value
  with `body`/`mode`/`autotrigger`/`regex` fields) replacing the flat string value, or (b)
  a sibling math-dictionary path. The schema choice is B-DESIGN-0 below.

- **`src-tauri/resources/snippets/quicktex.json`** (the degraded flattened asset) +
  **`scripts/convert-quicktex.py`** (the one-way converter) — **both to be DELETED by B5**, not
  extended. They are the concrete instance of the HARD RULE #0 red flag ("flatten an existing
  format into a bespoke shape"): the flat asset holds **262 entries today**
  (`python3 -c 'import json;len(...)'`), NOT the source's 281, because the converter collapsed the
  two source maps (`g:quicktex_prose` + `g:quicktex_math`) into one flat file (destroying the
  prose/math mode-split) and dropped pure vim-keystroke macros (`\<ESC>`, `:call`) and `COMMENT`
  dividers. It also DELETES `<++>` secondary tabstops (`body.replace("<++>", "")`, line 48) —
  the mirrored/multi-tabstop data loss. B5 REPLACES this whole path with a loader that consumes
  the source `g:quicktex_prose`/`g:quicktex_math` format directly (mode preserved, `<+++>`→`$0`,
  `<++>`→ordered `${N}`); the 262-vs-281 "discrepancy" then dissolves — it was an artifact of the
  flattening, not missing entries. Do NOT pin/version the flat asset as a fork; the SOURCE format
  is the maintained input.

## Work items (ordered sub-milestones)

Ordered by dependency. The math gate (B1) is the keystone and unblocks the rest; the
converter/provenance work (B5) is data-only and can land in parallel but is sequenced after
B4 (mirrors) because the converter's tabstop mapping must match the engine's tabstop model.

**B-DESIGN-0 (settle before B1 RED, no proof).** *Research-first:* the source format already
exists — the user's fork (`github.com/dzackgarza/quicktex`, README) defines exactly two global
dicts `g:quicktex_prose` and `g:quicktex_math`, both `trigger→body` with `<+++>`/`<++>` jump
markers; upstream `josephwright/QuickTeX` is the ancestor. The schema decision is therefore NOT
"design a bespoke per-entry shape" — it is "what loader directly consumes those two source maps
and carries their prose/math distinction + autotrigger/regex flags." Decide the in-app dictionary
representation that the quicktex-source loader produces. The flat `trigger→string` shape cannot
carry per-entry `mode` (prose/math/both), `autotrigger`, or `regex` flags. Options: (a) value
becomes an object `{ body, mode?, auto?, regex? }` with the bare-string form rejected (breaking
change — fine, pre-launch, fail loud on the old shape); (b) two sibling config paths
(`snippet_dictionary` prose + `math_snippet_dictionary`). Lean (a) — one dictionary, per-entry
metadata, matches the quicktex two-maps source (prose + math) best and keeps OSOT. Record the
ruling in [[parity-research/quicktex]] and update `config.rs` + `parseSnippetDictionary` to the
chosen schema (fail-loud on the old shape).

**B1 — Math-mode-only expansion (THE KEYSTONE).** *Research-first:* the math/prose predicate
ALREADY EXISTS in the vendored fork — `vendor/codemirror-lang-latex/src/completion.ts::isInMathMode`
(lines 35–93), the same detector the LaTeX command completion already gates on (`completion.ts:413,438`).
LEVERAGE it (OSOT); do NOT add a second detector. This is the LuaSnip/UltiSnips "math-mode-only
context condition" capability ([[parity-research/snippet-and-lint-ecosystem]]) realized by reusing
the existing predicate, not by writing a new one. Export the fork's `isInMathMode` (or a
state+pos wrapper) from `vendor/codemirror-lang-latex/src/index.ts`; rebuild the fork dist.
Gate the snippet completion source: a math-mode entry is offered ONLY when the cursor is in
a math zone; a prose entry ONLY in prose; a `both` entry always. The same short trigger
resolves to different bodies in `$…$` vs prose. Proof: **P77**.

**B2 — Autotrigger / space-trigger auto-expansion.** *Research-first:* this is an established
capability — LuaSnip `snippetType="autosnippet"` (`enable_autosnippets`) and UltiSnips option `A`
([[parity-research/snippet-and-lint-ecosystem]]), the generalization of quicktex's space-trigger.
The expansion itself REUSES CM6's `snippetCompletion().apply` via the existing `runSnippet` path;
only the *trigger condition* (on-space, no popup, re-arm) is owned here. Do not build a new
expander — own only the input-handler that decides when to call the existing expansion path.
A non-popup expansion path: when the
token immediately before the cursor is an autotrigger entry and the user types the trigger's
terminator (space), the engine expands the body in place WITHOUT a completion popup or accept
keypress, and **re-arms** so a subsequent autotrigger fires immediately (chained expansion).
Attaches as an input handler / updateListener in `EditorPane`, reusing `runSnippet`'s
expansion path; gated by B1's math predicate. Proof: **P78** (includes the re-arm/chain
clause — two expansions in one fluid stroke).

**B3 — Regex / postfix triggers with capture groups.** *Research-first:* the format is the
established LuaSnip `regTrig`/`trigEngine="ecma"` and UltiSnips option `r` capture-group model
([[parity-research/snippet-and-lint-ecosystem]]) — adopt its semantics (JS-regex with
`snippet.captures` substituted into the body), not an invented matcher syntax. Capture
substitution runs against the trigger; the residual body is then expanded through the existing
CM6 snippet path (so capture `$1` and tabstop `${1}` stay the standard TextMate distinction).
Entries flagged `regex` match a
pattern against the text before the cursor; capture groups substitute into the body
(`([a-z])bar`→`\bar{$1}`, `phat`→`\hat{p}`). Capture-group `$1` in the body is distinct from
a tabstop `${1}` — the matcher resolves captures first, then the residual `${N}` are
tabstops. Postfix is the regex case where the trigger trails an operand. Gated by B1. Proof:
**P79**.

**B4 — Mirrored tabstops.** *Research-first:* CM6's own `@codemirror/autocomplete`
`snippetCompletion` ALREADY mirrors repeated `${N}` tabstops natively (the established TextMate
mirror behaviour) — LEVERAGE it; this item OWNS no mirror engine, it PROVES the vendored
behaviour and ensures the dictionary/authoring path emits repeated tabstop numbers for the
env-name→`\end` case. A tabstop number repeated in a body updates every occurrence
live as the user types into the first (CM6 `snippetCompletion` already mirrors repeated
`${N}` — verify and PROVE it, then ensure the converter/authoring path emits mirrored
numbers for the env-name→`\end` / open-fence→close-fence case). Refines P52 (single tabstop
only). Proof: **P80** (type env name once, observe it mirrored into the closing fence).

**B5 — Direct interop with the standard quicktex definition format (REPLACES the bespoke
converter+asset).** *Research-first:* the source format is real and standard — the user's fork
`github.com/dzackgarza/quicktex` (README, read 2026-06-16) ships exactly two global dicts
`g:quicktex_prose` and `g:quicktex_math`, each `trigger→body` with `<+++>` (primary landing) and
`<++>` (secondary) jump markers; the canonical instance lives in the user's dotfiles
(`.config-sync/nvim/after/ftplugin/pandoc/quicktex_dict.vim`), and `josephwright/QuickTeX` is the
upstream ancestor. The correct disposition is to SUPPORT THAT FORMAT DIRECTLY so the user brings
his existing files with ZERO porting and the two-map prose/math split is preserved — NOT to keep a
one-way `vim-dict→flat-json` converter or to maintain `quicktex.json` as a forked, flattened
asset. The shipped flat `quicktex.json` is precisely the red-flagged "flatten an existing format
into a bespoke shape": the prose/math mode-split was destroyed (the 281→262 loss) and `<++>`
secondary tabstops were DELETED. That degraded one-way flattening is to be REPLACED by a loader
that reads the source `g:quicktex_prose`/`g:quicktex_math` maps and produces the
mode-tagged in-app dictionary of B-DESIGN-0, mapping `<+++>`/`<++>` to the standard TextMate
tabstop syntax (`$0` / ordered `${1}`/`${2}`) the CM6 snippet engine consumes. Work:
(a) the loader parses the two source maps directly (mode = which map the entry came from),
fail-loud on a malformed source (no silent flatten); (b) `<+++>`→`$0` and each `<++>`→an ordered
`${N}` tabstop (preserve, do not delete — this carries the B4 mirror/multi-tabstop data);
(c) the formerly-lost prose/math distinction is RECOVERED because the source already carries it
(this dissolves the 281→262 discrepancy: the loss came from collapsing two maps into one flat
file, not from missing entries); (d) the old `scripts/convert-quicktex.py` one-way converter and
the committed flat `quicktex.json` are DELETED (pre-launch, no consumer; the source format is the
maintained input — do not keep a fork). Proof: **P81** (the editor, loading the user's real
two-map source, offers the SAME short trigger to its prose body in prose and its math body in
math — i.e. the mode-split survived interop — and a discriminating multi-tabstop entry that
carried `<+++>`+`<++>` in the source expands with its ordered tabstops intact, the secondary
`<++>` a real `${N}` slot rather than deleted).

**B6 — Snippet variables (`$CLIPBOARD`, `$CURRENT_DATE`).** *Research-first:* these are the
standard TextMate/VSCode snippet variables (`CLIPBOARD`, `CURRENT_DATE`, `CURRENT_YEAR`,
[[parity-research/snippet-and-lint-ecosystem]] LSP/env variables) — adopt the established names
and `$NAME`/`${NAME}` syntax, do not coin bespoke tokens. Resolution reuses the existing
clipboard backend the P62 paste-image path already owns; resolved bodies feed the same CM6
snippet expansion. Bodies may contain variable
tokens resolved at expansion time: `$CLIPBOARD` → system clipboard text (via the existing
clipboard backend the P62 paste-image path uses), `$CURRENT_DATE`/`$CURRENT_YEAR` → host
date. Resolved in `runSnippet`'s body before `snippetCompletion`, so both the popup-accept
path and the insertion-bar path get variables. Refines P52/P59. Proof: **P82**.

**B7 — Transform/function nodes + visual-selection wrap.** *Research-first:* both are established
formats — the transform syntax is the standard TextMate/UltiSnips mirror-transform
`${1/regex/replace/flags}` and `${VISUAL}` is UltiSnips' selection placeholder
([[parity-research/snippet-and-lint-ecosystem]]); adopt both verbatim rather than inventing a
substitution or wrap syntax. The `jonschlinkert/tabstops` JS library implements exactly this
TextMate/VSCode body grammar (tabstops, placeholders, variables, transforms) and is the
candidate to PORT/LEVERAGE for body parsing if CM6's built-in snippet parser does not cover
transforms; visual-wrap reuses CM6's existing selection state in `runSnippet`. (a) Transform: a
mirror with a regex substitution (`${1/pattern/replace/flags}`) derives one slot from another
(label from
title; case transform). (b) Visual wrap: with a selection active, an entry containing
`${VISUAL}` wraps the selection in the expansion (select → `\emph{selection}` / environment).
Visual wrap reuses CM6's selection state in `runSnippet`. Proof: **P83** (a transform entry
derives the dependent slot; a visual-wrap entry wraps a real selection).

## Proposed proof obligations (P77–P83)

PROPOSALS — ratify with the user before writing RED. Each is an exact externally observable
happy-path state, admissible only if it FAILS on a plausibly broken app. Do NOT edit
`proof-obligations.md`; these go in once ratified.

- **P77 — Math-mode-only expansion (keystone).** Config declares a dictionary with the SAME
  trigger mapped to a prose body and a math body (mode-tagged). With the cursor in prose,
  typing the trigger and accepting expands the PROSE body. With the cursor inside `$…$` (or a
  math environment), typing the SAME trigger and accepting expands the MATH body; the prose
  body never appears in math and vice versa. A math-only trigger is NOT offered at all in
  prose. Admissible because it fails on a mode-blind engine (the same body expands in both
  zones, or a math-only trigger fires in prose), and on an engine that drops one mode
  entirely (the trigger is offered in neither zone).

- **P78 — Autotrigger space-expansion, re-arming for chains.** Config declares an autotrigger
  entry. Typing the trigger followed by a space expands the body IN PLACE with no completion
  popup and no accept keypress (the trigger text is gone, the expansion is at the cursor).
  Immediately typing a SECOND autotrigger + space expands again (the engine re-armed). Admissible
  because it fails on a popup-only engine (the trigger stays literal until an explicit accept),
  on a one-shot engine (the first autotrigger fires but the second does not, proving no re-arm),
  and on a no-op (the trigger + space leaves the literal trigger in the buffer).

- **P79 — Regex/postfix trigger with capture group.** Config declares a regex entry whose body
  references a capture group (e.g. `([a-z])bar` → `\bar{$1}`). Typing `pbar` and triggering
  expansion yields `\bar{p}` at the cursor (the captured `p` substituted into the body), with
  the matched trigger text gone. Admissible because it fails on a literal-trigger engine (no
  regex match, `pbar` stays in the buffer), on a capture-blind engine (the body inserts a
  literal `$1` instead of the captured `p`), and on a no-op.

- **P80 — Mirrored tabstops.** Config declares an entry whose body repeats a tabstop number in
  two positions (e.g. an environment whose name is mirrored into its closing fence/`\end`).
  Expanding the entry and typing the environment name into the first slot makes the SAME text
  appear at the mirrored position live, without a second keystroke there. Admissible because it
  fails on a single-tabstop engine (the second position stays empty or holds the literal `${N}`),
  and on a no-mirror engine (typing into the first slot does not update the second).

- **P81 — Standard quicktex format consumed directly, mode-split + tabstops preserved.** The
  editor loads the user's real two-map quicktex source (`g:quicktex_prose` + `g:quicktex_math`)
  directly — no bespoke flattened intermediate. A short trigger present in BOTH maps offers its
  prose body in prose and its math body in math (the prose/math mode-split survived interop, i.e.
  the 281→262 flattening loss is gone), and a discriminating multi-tabstop entry (one that
  carried `<+++>` + `<++>` in the source) expands with its ordered tabstops intact (the secondary
  `<++>` is a real `${N}` slot, not deleted). Admissible because it fails on a flattening loader
  (the mode-split is gone — the same body in both zones), on a loader that drops one source map,
  and on a lossy tabstop mapping (the multi-tabstop entry expands with its secondary slot
  deleted).

- **P82 — Snippet variables resolve at expansion.** Config declares an entry whose body
  contains `$CLIPBOARD` and `$CURRENT_DATE`. With known text on the system clipboard, expanding
  the entry inserts a body where `$CLIPBOARD` is replaced by the real clipboard text and
  `$CURRENT_DATE` by the host date (not the literal tokens). Admissible because it fails on a
  literal-token engine (`$CLIPBOARD` appears verbatim in the buffer), and on a no-op.

- **P83 — Transform node + visual-selection wrap.** (a) An entry with a transform mirror
  (`${1/.../.../}`) derives the dependent slot from the source slot (typing into the source
  produces the transformed text in the dependent position). (b) With a real selection active,
  expanding a `${VISUAL}` entry wraps exactly the selected text in the expansion (select
  `foo`, trigger → `\emph{foo}`). Admissible because it fails on a transform-blind engine (the
  dependent slot shows the untransformed source text or the literal `${1/.../.../}`), and on a
  wrap that discards the selection (the expansion appears but the selected text is gone or not
  wrapped).

## Verification

- Each sub-milestone: RED spec committed (FAILS for the absent capability, verified), then
  GREEN. Webview-class specs under `tests/proof/`, driven through the existing E2E bridge and
  `EditorPane` harness methods (`typeInEditor`, `acceptCompletion`, `appendAtEnd`,
  `insertSnippetByTrigger`, plus new harness surfaces for autotrigger/visual-wrap). Run under
  Xvfb + system pandoc, per `proof-run-environment-setup`.
- **P1–P69 stay green** every commit — especially P51 (composable completion), P52 (popup
  expansion), P59 (bar dropdown): the engine wraps the source, it must not displace the LaTeX
  completions or the bar path. Re-run the P51/P52/P59 specs as the regression gate after each B.
- The source-format loader (B5) is verified against the user's REAL quicktex dict (not a bespoke
  flattened asset): loading the two-map source and asserting a both-maps trigger resolves
  per-mode and a multi-tabstop entry keeps its slots (P81). The deleted `convert-quicktex.py` /
  `quicktex.json` leave no drift check behind — there is no flattened intermediate to drift.
- `bun run check` clean; the arch gate (`.agents/check-no-pandoc-in-core.sh`) stays green
  (this phase is entirely editor-side, no core/pandoc surface).

## Sequencing & dependencies

- **B-DESIGN-0 → B1.** The entry schema must be settled before the math gate, because the gate
  reads a per-entry `mode` flag.
- **B1 is the keystone** — B2 (autotrigger), B3 (regex), B6 (variables), B7 (transform/visual)
  all expand only inside the math/prose gate B1 establishes. B1 first, hard dependency.
- **B4 (mirrors) → B5 (source loader maps `<++>` to ordered tabstops).** The loader's
  `<+++>`/`<++>`→tabstop mapping must match the engine's mirror model, so B4 lands before B5
  builds the source-format loader.
- **B2/B3/B6/B7 are parallel-capable** after B1, but autotrigger (B2) is the highest-value
  ergonomic ([[parity-research/quicktex]] "the single most important behavior to port"), so
  sequence it next after B1.
- **No cross-phase dependency on Phase A** (lint) or Phase C (citations); Phase B is self-
  contained on the P51/P52/P59 base. It does depend on the vendored fork being app-owned
  (already true — submodule, app is source of truth) so `isInMathMode` can be exported.
- **Excluded items create no work**: UltiSnips interpolation and LuaSnip dynamic/restore nodes
  are not implemented; record the exclusion in the relevant memory if a future ask resurfaces.

## Status / resume here

- **2026-06-16: Phase B plan authored.** Not started. Prerequisite GREEN baseline: P1–P69
  (the snippet base P51/P52/P59 is implemented and green; Milestone G insertion bar P55–P62
  complete on `milestone-g-insertion-bar`).
- **Keystone already half-built:** `vendor/codemirror-lang-latex/src/completion.ts::isInMathMode`
  (lines 35–93) is the prose/math detector — module-private today; B1's first move is to
  EXPORT it (OSOT — do not reimplement a second detector).
- **Bespoke flattening to be DELETED (B5):** `scripts/convert-quicktex.py` + the flat
  `src-tauri/resources/snippets/quicktex.json` are the HARD RULE #0 red flag (a one-way flatten of
  an existing format into a bespoke shape). The converter collapsed the two source maps into one
  flat file (destroying prose/math) and DELETES `<++>` (`body.replace("<++>", "")`, line 48). B5
  replaces both with direct interop: a loader for the standard `g:quicktex_prose`/`g:quicktex_math`
  source format.
- **281-vs-262 dissolved, not pinned:** the gap is an artifact of flattening two maps into one,
  not missing entries; consuming the source format directly (B5) recovers the mode-split and
  removes the need to pin/version a forked flat asset.
- **Schema decision open (B-DESIGN-0):** the flat `trigger→string` dict cannot carry per-entry
  `mode`/`auto`/`regex` metadata; the leading option is an object-valued entry schema (breaking
  change, fail loud on the old shape — fine pre-launch). Settle before B1 RED.
- **NEXT:** ratify B-DESIGN-0 schema + P77 (math-mode keystone) with the user, then RED for B1.
