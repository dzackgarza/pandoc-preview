# Snippet & Lint Ecosystem (LuaSnip / UltiSnips / ChkTeX / lacheck) — Parity Research

**When this applies:** scoping (1) the snippet ENGINE capabilities beyond flat tabstops, and (2) LINTING-BEFORE-COMPILE — the class of feedback the app can give faster than a pandoc/latex round-trip.
Cross-links: [[quicktex]] (the flat-dict source format these engines generalize), [[vimtex]] (vimtex's compile-log quickfix is POST-compile; ChkTeX/lacheck are PRE-compile), [[../feature-catalogue-and-implementation-status]] (Tier-0 snippets P52/P59, spellcheck P54, matched-delimiter highlighting), [[../lineage-vim-live-texing-setup]] (UltiSnips math-aware snippets are the heritage ideal).
Sources (read 2026-06-16): LuaSnip `DOC.md`; UltiSnips `doc/UltiSnips.txt`; ChkTeX v1.7.10 manual (`ChkTeX.pdf`, pages 1-2 warning-class list + per-line suppression on page 10); lacheck Ubuntu/Arch man pages.

## What it is

Two capability families the heritage TeX workflow owned and this app must reproduce CodeMirror-natively:

**Snippet engines (LuaSnip, UltiSnips)** — full snippet systems FAR beyond quicktex's flat keyword→body map: mirrored tabstops, regex/transform nodes, choice/dynamic nodes, regex triggers, autotrigger, and — critically for math — **context conditions that gate expansion to math-mode only**. This is the engine layer; quicktex is the dictionary layer.

**LaTeX linters (ChkTeX, lacheck)** — STATIC checkers that catch typographic and structural errors **without compiling**. This is the "feedback faster than a compile" priority directly: unmatched delimiters, math-mode imbalance, bad spacing/punctuation, quote style, dash length — all detected by reading source, before pandoc/latex ever runs. For a markdown-math editor the analogs are: live delimiter matching ($, {}, \left/\right), live math-mode-balance checking, and a configurable typographic-warning layer. Linting-before-compile is the single most under-tracked High-relevance area in the catalogue.

## Feature inventory

### Snippet engine capabilities (LuaSnip / UltiSnips)

- **Mirrored tabstops**: a tabstop repeated elsewhere updates live as you type ($1 mirrored everywhere). UltiSnips `${1}` mirrors; LuaSnip function-node referencing the insert node. `[relevance: High]` (e.g. environment name typed once, mirrored into `\end`/closing fence)
- **Transform / function nodes**: LuaSnip function nodes (`f`) compute text from other nodes' content; UltiSnips mirror transforms `${1/regex/replace/options}` apply a regex substitution to a mirror. `[relevance: Med]` (e.g. derive a label from a title; lowercase a name)
- **Choice nodes** (LuaSnip `c`): cycle interactively through alternative expansions at a slot. `[relevance: Med]`
- **Dynamic nodes** (LuaSnip `d`): generate an entire sub-snippet at runtime from user input, with `old_state`/`restore` (`r`) nodes preserving edits across regeneration. `[relevance: Low]` (powerful but heavy; rarely needed for math authoring)
- **Regex triggers**: LuaSnip `trigEngine`/`regTrig` ("pattern" Lua-regex, "ecma" JS-regex, "vim"); UltiSnips option `r`. Capture groups available (`snippet.captures`). Enables e.g. `([a-z])bar` → `\bar{$1}` postfix snippets. `[relevance: High]` (postfix math: `phat`→`\hat{p}` from [[../lineage-vim-live-texing-setup]])
- **Autotrigger / auto-expansion**: LuaSnip `snippetType="autosnippet"` (+ `enable_autosnippets=true`); UltiSnips option `A`. Expands WITHOUT a manual keypress — the quicktex space-trigger ergonomic, generalized. `[relevance: High]`
- **Context conditions = MATH-MODE-ONLY expansion**: LuaSnip `condition`/`show_condition` functions (return bool from line context); UltiSnips `context "..."` keyword (option `e`) with a Python expression. The canonical use is **expand this snippet ONLY when the cursor is in a math zone** — the mechanism that makes single-letter math triggers safe. LuaSnip ships `luasnip.extras.conditions`; UltiSnips users wire a `math()` context predicate. `[relevance: High]`
- **Word-boundary triggers**: LuaSnip `wordTrig` (trigger only at `[%w_]+` boundary); UltiSnips `w`/`i` (word / in-word). `[relevance: Med]`
- **Visual placeholder**: UltiSnips `${VISUAL}` wraps a current selection in the expansion (e.g. select text, trigger → `\emph{selection}`). `[relevance: Med]`
- **LSP/env variables in bodies**: `TM_FILENAME`, `TM_CURRENT_LINE`, custom `snippet.env`. `[relevance: Low]`
- **Interpolation**: UltiSnips embeds shell `` `cmd` ``, Python, and Vimscript inside bodies. `[relevance: Low]` (security/portability surface; not needed for math snippets)

### Linting-before-compile (ChkTeX warning classes — the full enumeration)

ChkTeX "supports over 40 warnings" (manual pages 1-2). The warning CLASSES (what it catches statically, no compile):

- **Unmatched/wrong-matched brackets & parentheses & environments** (warning 17 = `(`/`)`/`[`/`]` counts don't match for the file; 9 = mismatched `]` and `)`; environment begin/end matching). `[relevance: High]`
- **Math-mode on/off detection** — tracks whether `$`/`\[` math is entered/exited correctly; flags math-mode imbalance. `[relevance: High]`
- **Mathematical operators typeset as variables** (e.g. `sin` not `\sin`). `[relevance: Med]`
- **Punctuation inside inner math mode / outside display math mode** — punctuation placement relative to `$…$` vs `\[…\]`. `[relevance: Med]`
- **Use of `x` instead of `$\times$` between numbers.** `[relevance: Med]`
- **Forgetting to group parenthesis characters when sub/superscripting** (e.g. `x^10` vs `x^{10}`). `[relevance: Med]`
- **Italic correction `\/` mistakes** (double, missing, unnecessary). `[relevance: Low]` (LaTeX-specific, rare in markdown)
- **Spacing**: space in front of references (warning ~"use `~` not space" before `\ref`/`\cite`); space before `\label` and similar; space before footnotes; no space in front of/after parenthesis; multiple input spaces rendered as one (undesirable). `[relevance: Med]`
- **Commands terminated with space** (warning 1) — a command swallowing its trailing space (ignores `\tt` etc). `[relevance: Med]`
- **Bogus characters following commands.** `[relevance: Low]`
- **Quote checking** (warning 18): both wrong TYPE (`"` straight quotes) and wrong DIRECTION; demands a consistent quote STYLE (`QuoteStyle = Logical|Traditional`). `[relevance: Med]`
- **Ellipsis detection** — `...` vs `\dots`/`\cdots`/`\ldots`; recommends splitting three quotes in a row. `[relevance: Med]`
- **Wrong length of dash** (warning 8) — `-`/`--`/`---` misuse. `[relevance: Med]`
- **End-of-sentence vs inter-word spacing**: enforce normal space after abbreviation (auto-detects abbreviations); enforce end-of-sentence space when the sentence ended with a capital letter (the `\@` problem). `[relevance: Med]`
- **TeX primitives where LaTeX equivalents exist.** `[relevance: Low]`
- **User-defined regex patterns** (warning 44, `UserWarnRegex` in `chktexrc`, PCRE) — arbitrary custom lint rules (e.g. "Vertical rules in tables are ugly"). `[relevance: High]` (extensible lint layer for house style)
- **Per-line / per-file suppression**: `% chktex N` (or `% chktex-file N`) comments suppress warning N — an in-document opt-out mechanism. `[relevance: Med]`

### Linting-before-compile (lacheck — distinct from ChkTeX)

- **Mismatched groups / environments / math-mode delimiters**, reporting BOTH start and end line numbers of the mismatch. `[relevance: High]` (its core strength; complements ChkTeX delimiter counting)
- **Bad spacing**: missing `\ ` after abbreviation; missing `\@` before punctuation when a sentence ends with a capital; double spaces; bad ellipsis; missing `~` before `\cite`/`\ref`. `[relevance: Med]`
- **Bad quotation characters; tabs in verbatim; TeX primitives; font-specifier-with-argument** (`\em{text}`); `@` in LaTeX macros. `[relevance: Low]`
- Known to be "a crude approximation," confused by advanced/non-standard macros, and provides NO per-warning disable. `[relevance: Low]` (argues for preferring ChkTeX's tunability)

## Parity matrix

| feature | target has it | our status | math-writing relevance | notable mechanism worth porting |
| --- | --- | --- | --- | --- |
| Mirrored tabstops | yes (both engines) | gap (P52 has single tabstop only) | High | type env name once → mirrored into closing fence |
| Regex / postfix triggers | yes (LuaSnip regTrig, UltiSnips `r`) | gap | High | postfix math (`phat`→`\hat{p}`), capture-group bodies |
| Autotrigger (no expand key) | yes (LuaSnip autosnippet, UltiSnips `A`) | gap | High | the quicktex space-trigger ergonomic (see [[quicktex]]) |
| **Math-mode-only context condition** | yes (LuaSnip `condition`, UltiSnips `context`) | gap | High | a math-zone predicate gating expansion — unblocks short single-letter math triggers |
| Transform/function nodes | yes | gap | Med | derive label from title, case transforms |
| Choice / dynamic nodes | yes (LuaSnip) | gap | Low | heavy; defer |
| Visual-selection wrap | yes (UltiSnips `${VISUAL}`) | gap | Med | select → wrap in `\emph{}`/environment |
| **Static delimiter/bracket balance check** | yes (ChkTeX 9/17, lacheck) | partial: matched-delimiter HIGHLIGHTING is Tier0, but no WARN-on-imbalance lint | High | count `{}`/`[]`/`$`/`\left\right`; report imbalance pre-compile |
| **Static math-mode balance check** | yes (ChkTeX math on/off) | gap | High | flag unterminated `$`/`\[` before the user hits compile |
| Typographic warnings (dash, ellipsis, quotes, `x`→`\times`) | yes (ChkTeX) | gap | Med | house-style lints in the editor gutter |
| User-defined regex lint rules | yes (ChkTeX UserWarnRegex/44) | gap | High | extensible config-owned lint layer |
| In-document warning suppression | yes (`% chktex N`) | gap | Med | per-line opt-out for intentional constructs |
| Post-compile log → diagnostics | vimtex/quickfix (POST) | planned: Tier2 (compile log P11) | High | distinct from PRE-compile lint; we have only the POST path tracked |

## Gaps (net-new candidates our catalogue does NOT track)

LINTING-BEFORE-COMPILE is the headline gap cluster — the catalogue tracks matched-delimiter *highlighting* and post-compile *log surfacing*, but NO static pre-compile *diagnostic* layer:

- **Static delimiter-balance WARNINGS** (not just highlighting): count `{}`, `[]`, `$…$`, `\left`/`\right` across the buffer and surface an imbalance as a gutter diagnostic BEFORE compile. Matched-delimiter highlighting (Tier 0) shows the pair under the cursor; it does NOT tell you "you have 3 `\left` and 2 `\right`." ChkTeX warnings 9/17 + lacheck do exactly this. CodeMirror 6 has `@codemirror/lint` (linter gutter + diagnostics) as the native host. `[relevance: High]`
- **Static math-mode balance check**: flag an unterminated `$`/`\(`/`\[` (math entered and not exited) live, before the render fails. This is the most common math-writing error and currently only surfaces as a broken/garbled preview. `[relevance: High]`
- **Configurable typographic lint layer** (dash length, `...`→`\dots`, straight-vs-curly quotes, `x`→`\times`, sub/superscript grouping `x^10`→`x^{10}`, operator-as-variable `sin`→`\sin`): a ChkTeX-class warning set adapted to pandoc-markdown-math, rendered as CM6 lint diagnostics. `[relevance: Med-High]`
- **User-defined regex lint rules** (ChkTeX `UserWarnRegex` analog): a config-owned list of regex→message house-style rules, surfaced as diagnostics. Pairs with the OSOT config philosophy. `[relevance: High]`
- **In-document lint suppression** (`% chktex N` analog): a comment-based per-line/per-file opt-out so intentional constructs don't nag. `[relevance: Med]`
- **Snippet ENGINE (not just dictionary) with math-context conditions, autotrigger, regex triggers, mirrors**: the catalogue's snippet model (P52/P59) is a flat config dict surfaced via tooltip/dropdown — it does NOT track mirrored tabstops, autotrigger, regex/postfix triggers, or math-mode-only expansion. These four are the LuaSnip/UltiSnips capabilities the heritage workflow actually used ([[../lineage-vim-live-texing-setup]]). Math-mode-only conditional expansion is the keystone (it makes the quicktex prose/math split possible). `[relevance: High]`
- **Actually running ChkTeX/lacheck on a transient `.tex`**: pandoc can emit `.tex`; a plugin could run ChkTeX against the intermediate and map diagnostics back. Worth evaluating vs reimplementing the checks natively on markdown-math (mapping line numbers back through pandoc is the hard part — relates to the `sourcepos` problem in [[../feature-catalogue-and-implementation-status]] Tier-2 scroll-sync). `[relevance: Med]`

## Dispositions

- **UltiSnips shell/Python/Vimscript interpolation in snippet bodies** — *gimmick — deprioritized*: arbitrary code execution inside snippets is a portability + (banned) security surface and is unnecessary for math authoring; tabstops + transforms cover the real needs.
- **LuaSnip dynamic/restore nodes** — *deprioritized (Low relevance)*: powerful runtime sub-snippet generation, but heavy and rarely needed for theorem/math snippets; revisit only if a concrete need appears. NOT a gimmick, just low priority.
- **ChkTeX italic-correction `\/`, TeX-primitive, bogus-character-after-command warnings** — *deprioritized (Low relevance)*: LaTeX-source-specific; in pandoc-markdown the user rarely writes raw `\/` or TeX primitives. Port the delimiter/math-balance/typographic classes, skip the LaTeX-internals classes.
- **lacheck as the chosen linter** — *deprioritized vs ChkTeX*: lacheck is self-described as "a crude approximation," is confused by macros, and offers NO per-warning disable. Prefer ChkTeX's tunable, suppressible, user-extensible model; keep lacheck only as a complementary group/environment cross-line mismatch reporter if cheap.
- No banned-non-goal overlap: all of this is local single-user editor tooling. (Running an external linter binary is a plugin-firewall candidate, consistent with [[../feature-catalogue-and-implementation-status]] Tier-4 plugin doctrine.)
