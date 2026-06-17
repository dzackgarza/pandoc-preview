# Phase B — Snippet Engine Depth + quicktex Migration (implementation plan)

Durable, resumable roadmap for the SECOND phase of the Competitive Parity Roadmap:
turning the flat config-dictionary snippet model (P52 popup path / P59 bar-dropdown
path) into a real snippet ENGINE — the LuaSnip/UltiSnips capability layer the heritage
vim workflow actually used — and pinning the canonical quicktex dictionary as a
versioned, provenance-tracked data asset.

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
| Canonical 281-entry quicktex dict as a versioned data asset + a vim-dict→config converter; pin provenance (OSOT) — the catalogue says "migrated" but never pins WHERE or "verbatim" | net-new gap | High |
| Snippet variables (`$CLIPBOARD`, `$CURRENT_DATE`, TextMate dynamic vars) | refines P52/P59 | Med |
| Transform/function nodes (derive a label from a title; case transforms) | net-new gap | Med |
| Visual-selection wrap (`${VISUAL}`: select → wrap in `\emph{}`/environment) | net-new gap | Med |

**Excluded (recorded so no future synthesis re-proposes them):** UltiSnips shell/Python/
Vimscript interpolation (banned security/portability surface, gimmick); LuaSnip dynamic/
restore nodes (heavy, Low). The vim-keystroke-sequence bodies (`\<CR>`, `\<Right>`) are
NOT ported as a keystroke interpreter — they map to CM6 `${1}`/`${2}` template syntax.

## Discipline

Identical to `render-rebuild-plan.md` and `proof-obligations.md`:

- TDD per sub-milestone: design → RED proof obligation (user-ratified) → commit RED →
  GREEN → commit. Each sub-milestone gates on its proof green before the next starts.
  RED must FAIL FOR THE RIGHT REASON (the absent capability), verified before GREEN.
- **Existing obligations P1–P62 stay green throughout.** A sub-milestone that would break
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
- RESERVED obligation block **P70–P76** (proposed below; do NOT edit
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

- **`src-tauri/resources/snippets/quicktex.json`** (the migrated asset) +
  **`scripts/convert-quicktex.py`** (the committed reproducible converter). The asset holds
  **262 entries today** (`python3 -c 'import json;len(...)'`), NOT 281 — the roadmap says
  "281-entry" and `editor-experience-targets...` calls it "281-entry"; the converter drops
  pure vim-keystroke macros (`\<ESC>`, `:call`) and `COMMENT` dividers. **The 262-vs-281
  discrepancy is unpinned provenance** — B-PROV below resolves it (pin the source commit,
  document which entries the converter drops and why, and decide whether the 19-entry gap is
  intentional exclusions or a lossy conversion). The converter currently collapses
  `<+++>`→`$0` and DELETES `<++>` — that deletion is the mirrored-tabstop data loss Phase B
  must reverse at the converter level (preserve `<++>` as ordered `${1}`/`${2}` tabstops).

## Work items (ordered sub-milestones)

Ordered by dependency. The math gate (B1) is the keystone and unblocks the rest; the
converter/provenance work (B5) is data-only and can land in parallel but is sequenced after
B4 (mirrors) because the converter's tabstop mapping must match the engine's tabstop model.

**B-DESIGN-0 (settle before B1 RED, no proof).** Decide the dictionary entry schema. The
flat `trigger→string` shape cannot carry per-entry `mode` (prose/math/both), `autotrigger`,
or `regex` flags. Options: (a) value becomes an object `{ body, mode?, auto?, regex? }`
with the bare-string form rejected (breaking change — fine, pre-launch, fail loud on the old
shape); (b) two sibling config paths (`snippet_dictionary` prose + `math_snippet_dictionary`).
Lean (a) — one dictionary, per-entry metadata, matches the quicktex single-file-with-two-maps
heritage better and keeps OSOT. Record the ruling in [[parity-research/quicktex]] and update
`config.rs` + `parseSnippetDictionary` to the chosen schema (fail-loud on the old shape).

**B1 — Math-mode-only expansion (THE KEYSTONE).** Export the fork's `isInMathMode` (or a
state+pos wrapper) from `vendor/codemirror-lang-latex/src/index.ts`; rebuild the fork dist.
Gate the snippet completion source: a math-mode entry is offered ONLY when the cursor is in
a math zone; a prose entry ONLY in prose; a `both` entry always. The same short trigger
resolves to different bodies in `$…$` vs prose. Proof: **P70**.

**B2 — Autotrigger / space-trigger auto-expansion.** A non-popup expansion path: when the
token immediately before the cursor is an autotrigger entry and the user types the trigger's
terminator (space), the engine expands the body in place WITHOUT a completion popup or accept
keypress, and **re-arms** so a subsequent autotrigger fires immediately (chained expansion).
Attaches as an input handler / updateListener in `EditorPane`, reusing `runSnippet`'s
expansion path; gated by B1's math predicate. Proof: **P71** (includes the re-arm/chain
clause — two expansions in one fluid stroke).

**B3 — Regex / postfix triggers with capture groups.** Entries flagged `regex` match a
pattern against the text before the cursor; capture groups substitute into the body
(`([a-z])bar`→`\bar{$1}`, `phat`→`\hat{p}`). Capture-group `$1` in the body is distinct from
a tabstop `${1}` — the matcher resolves captures first, then the residual `${N}` are
tabstops. Postfix is the regex case where the trigger trails an operand. Gated by B1. Proof:
**P72**.

**B4 — Mirrored tabstops.** A tabstop number repeated in a body updates every occurrence
live as the user types into the first (CM6 `snippetCompletion` already mirrors repeated
`${N}` — verify and PROVE it, then ensure the converter/authoring path emits mirrored
numbers for the env-name→`\end` / open-fence→close-fence case). Refines P52 (single tabstop
only). Proof: **P73** (type env name once, observe it mirrored into the closing fence).

**B5 — Canonical quicktex dict as a versioned, provenance-pinned asset + converter
faithfulness.** (a) Pin the source: the converter's input is the user's
`dotfiles/.../quicktex_dict.vim` at a specific commit — record the commit SHA + path in the
asset header / a sibling provenance file (OSOT). (b) Resolve the **262-vs-281** count: audit
which entries the converter drops (vim-keystroke macros, `COMMENT` dividers, empty triggers)
and document the exclusion set so the count is explained, not mysterious. (c) Restore `<++>`
secondary tabstops as ordered `${1}`/`${2}` (currently DELETED — the B4 mirror data lives in
the source markers and the converter is throwing it away). (d) Re-run the committed converter
reproducibly. Proof: **P74** (the asset's entry count + a discriminating multi-tabstop entry
round-trip through the converter; a chosen entry expands with its tabstops intact).

**B6 — Snippet variables (`$CLIPBOARD`, `$CURRENT_DATE`).** Bodies may contain variable
tokens resolved at expansion time: `$CLIPBOARD` → system clipboard text (via the existing
clipboard backend the P62 paste-image path uses), `$CURRENT_DATE`/`$CURRENT_YEAR` → host
date. Resolved in `runSnippet`'s body before `snippetCompletion`, so both the popup-accept
path and the insertion-bar path get variables. Refines P52/P59. Proof: **P75**.

**B7 — Transform/function nodes + visual-selection wrap.** (a) Transform: a mirror with a
regex substitution (`${1/pattern/replace/flags}`) derives one slot from another (label from
title; case transform). (b) Visual wrap: with a selection active, an entry containing
`${VISUAL}` wraps the selection in the expansion (select → `\emph{selection}` / environment).
Visual wrap reuses CM6's selection state in `runSnippet`. Proof: **P76** (a transform entry
derives the dependent slot; a visual-wrap entry wraps a real selection).

## Proposed proof obligations (P70–P76)

PROPOSALS — ratify with the user before writing RED. Each is an exact externally observable
happy-path state, admissible only if it FAILS on a plausibly broken app. Do NOT edit
`proof-obligations.md`; these go in once ratified.

- **P70 — Math-mode-only expansion (keystone).** Config declares a dictionary with the SAME
  trigger mapped to a prose body and a math body (mode-tagged). With the cursor in prose,
  typing the trigger and accepting expands the PROSE body. With the cursor inside `$…$` (or a
  math environment), typing the SAME trigger and accepting expands the MATH body; the prose
  body never appears in math and vice versa. A math-only trigger is NOT offered at all in
  prose. Admissible because it fails on a mode-blind engine (the same body expands in both
  zones, or a math-only trigger fires in prose), and on an engine that drops one mode
  entirely (the trigger is offered in neither zone).

- **P71 — Autotrigger space-expansion, re-arming for chains.** Config declares an autotrigger
  entry. Typing the trigger followed by a space expands the body IN PLACE with no completion
  popup and no accept keypress (the trigger text is gone, the expansion is at the cursor).
  Immediately typing a SECOND autotrigger + space expands again (the engine re-armed). Admissible
  because it fails on a popup-only engine (the trigger stays literal until an explicit accept),
  on a one-shot engine (the first autotrigger fires but the second does not, proving no re-arm),
  and on a no-op (the trigger + space leaves the literal trigger in the buffer).

- **P72 — Regex/postfix trigger with capture group.** Config declares a regex entry whose body
  references a capture group (e.g. `([a-z])bar` → `\bar{$1}`). Typing `pbar` and triggering
  expansion yields `\bar{p}` at the cursor (the captured `p` substituted into the body), with
  the matched trigger text gone. Admissible because it fails on a literal-trigger engine (no
  regex match, `pbar` stays in the buffer), on a capture-blind engine (the body inserts a
  literal `$1` instead of the captured `p`), and on a no-op.

- **P73 — Mirrored tabstops.** Config declares an entry whose body repeats a tabstop number in
  two positions (e.g. an environment whose name is mirrored into its closing fence/`\end`).
  Expanding the entry and typing the environment name into the first slot makes the SAME text
  appear at the mirrored position live, without a second keystroke there. Admissible because it
  fails on a single-tabstop engine (the second position stays empty or holds the literal `${N}`),
  and on a no-mirror engine (typing into the first slot does not update the second).

- **P74 — Canonical dict is a provenance-pinned versioned asset with faithful tabstops.** The
  shipped `quicktex.json` is produced by the committed converter from the pinned-provenance
  source, its entry count matches the documented expectation (the 262/281 discrepancy resolved
  and recorded), and a discriminating multi-tabstop entry (one that carried `<+++>` + `<++>` in
  the vim source) expands in the editor with its ordered tabstops intact (the secondary `<++>`
  is a real `${N}` slot, not deleted). Admissible because it fails on an asset that does not
  match the converter's output (drift between the committed JSON and the reproducible converter),
  on an unpinned source (no recorded provenance), and on a lossy conversion (the multi-tabstop
  entry expands with its secondary slot deleted).

- **P75 — Snippet variables resolve at expansion.** Config declares an entry whose body
  contains `$CLIPBOARD` and `$CURRENT_DATE`. With known text on the system clipboard, expanding
  the entry inserts a body where `$CLIPBOARD` is replaced by the real clipboard text and
  `$CURRENT_DATE` by the host date (not the literal tokens). Admissible because it fails on a
  literal-token engine (`$CLIPBOARD` appears verbatim in the buffer), and on a no-op.

- **P76 — Transform node + visual-selection wrap.** (a) An entry with a transform mirror
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
- **P1–P62 stay green** every commit — especially P51 (composable completion), P52 (popup
  expansion), P59 (bar dropdown): the engine wraps the source, it must not displace the LaTeX
  completions or the bar path. Re-run the P51/P52/P59 specs as the regression gate after each B.
- The converter (B5) is verified reproducibly: re-running `scripts/convert-quicktex.py` on the
  pinned source reproduces the committed `quicktex.json` byte-for-byte (a drift check, agent-
  facing in `.agents/`, not a proof-suite meta-assertion).
- `bun run check` clean; the arch gate (`.agents/check-no-pandoc-in-core.sh`) stays green
  (this phase is entirely editor-side, no core/pandoc surface).

## Sequencing & dependencies

- **B-DESIGN-0 → B1.** The entry schema must be settled before the math gate, because the gate
  reads a per-entry `mode` flag.
- **B1 is the keystone** — B2 (autotrigger), B3 (regex), B6 (variables), B7 (transform/visual)
  all expand only inside the math/prose gate B1 establishes. B1 first, hard dependency.
- **B4 (mirrors) → B5 (converter restores `<++>`).** The converter's tabstop mapping must
  match the engine's mirror model, so B4 lands before B5 rewires the `<++>` handling.
- **B2/B3/B6/B7 are parallel-capable** after B1, but autotrigger (B2) is the highest-value
  ergonomic ([[parity-research/quicktex]] "the single most important behavior to port"), so
  sequence it next after B1.
- **No cross-phase dependency on Phase A** (lint) or Phase C (citations); Phase B is self-
  contained on the P51/P52/P59 base. It does depend on the vendored fork being app-owned
  (already true — submodule, app is source of truth) so `isInMathMode` can be exported.
- **Excluded items create no work**: UltiSnips interpolation and LuaSnip dynamic/restore nodes
  are not implemented; record the exclusion in the relevant memory if a future ask resurfaces.

## Status / resume here

- **2026-06-16: Phase B plan authored.** Not started. Prerequisite GREEN baseline: P1–P62
  (the snippet base P51/P52/P59 is implemented and green; Milestone G insertion bar P55–P62
  complete on `milestone-g-insertion-bar`).
- **Keystone already half-built:** `vendor/codemirror-lang-latex/src/completion.ts::isInMathMode`
  (lines 35–93) is the prose/math detector — module-private today; B1's first move is to
  EXPORT it (OSOT — do not reimplement a second detector).
- **Converter data-loss flagged:** `scripts/convert-quicktex.py` currently DELETES `<++>`
  secondary tabstops (`body.replace("<++>", "")`, line 48) — this is the mirrored/multi-tabstop
  data Phase B (B4/B5) must restore.
- **Provenance discrepancy flagged:** the shipped `src-tauri/resources/snippets/quicktex.json`
  holds **262 entries**; the roadmap and [[editor-experience-targets-conceals-folding-expansion]]
  say **281**. B5 must resolve and pin this (source commit + documented exclusion set), per
  the OSOT directive.
- **Schema decision open (B-DESIGN-0):** the flat `trigger→string` dict cannot carry per-entry
  `mode`/`auto`/`regex` metadata; the leading option is an object-valued entry schema (breaking
  change, fail loud on the old shape — fine pre-launch). Settle before B1 RED.
- **NEXT:** ratify B-DESIGN-0 schema + P70 (math-mode keystone) with the user, then RED for B1.
