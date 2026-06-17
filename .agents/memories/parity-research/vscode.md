# VSCode — Parity Research

## What it is

VSCode is a general-purpose code editor; for this research only FOUR surfaces are in scope (per task): the **file tree / Explorer**, **basic markdown editing affordances**, the **Command Palette**, and **Quick Open / recent-files switcher**. The relevance to a math-research markdown editor is purely navigational + command-discovery ergonomics: VSCode's two-key model (one key to fuzzy-jump to any file, one key to run any command) is the canonical pattern our Tier 3 "Ctrl+P workspace file browser" and a future command surface should emulate. Everything else about VSCode (debugging, extensions marketplace, language servers, integrated terminal, source control UI) is out of scope and largely banned-non-goal territory (generic git client UI, full IDE) for us. Researched from `code.visualstudio.com/docs/getstarted/userinterface`.

## IMPORTANT keybinding correction (user-flagged)

The task prompt records the user's phrasing as "Ctrl+P for commands and Ctrl+Shift+P for recent files." **VSCode's ACTUAL bindings are the REVERSE**, confirmed from the official docs:

- **Ctrl+P = Quick Open / "Go to File"** — the fuzzy file finder / quick-open / recent-files switcher.
- **Ctrl+Shift+P = Command Palette** — runs editor commands (and, with `>` prefix logic, is the command surface).

The user's INTENT is unambiguous and correct: they want BOTH a command palette AND a fuzzy quick-open / recent-files switcher. Only the key labels were transposed. **Synthesis must record the correct bindings** (Ctrl+P = quick-open file finder, Ctrl+Shift+P = command palette) and treat the user's request as "give me these two surfaces," not as a literal keybinding spec. Our catalogue already names a "Ctrl+P workspace file browser" (Tier 3) — that matches VSCode's REAL Ctrl+P (quick-open), so our existing naming is already consistent with VSCode's actual binding, not the transposed phrasing.

## Feature inventory

- **Quick Open / Go to File (Ctrl+P)** `[relevance: High]` — fuzzy file finder over the workspace; type a partial name to jump to any file without the mouse; doubles as a recent-files list (the list seeds with recently opened files when opened empty). This is the surface our Tier 3 Ctrl+P browser replicates (we deliver it via fzf/dmenu behind the plugin firewall).
- **Command Palette (Ctrl+Shift+P)** `[relevance: Med]` — single fuzzy input to run any command; also reachable file/symbol/outline via prefix tokens (`>` commands, `@` symbols, `:` line, `#` workspace symbols, `?` help). For us, a command surface is a productivity nicety, not a tracked core feature — most of our actions live on the insertion bar + menus.
- **Explorer / file tree side bar** `[relevance: High]` — project files/folders in a left side bar; create/delete/rename/drag/context-menu; collapsible folders. Maps directly to our Tier 3 tree (P6) and the VSCode-style activity-bar + collapsible side bar we already adopted (P18).
- **Explorer filter (Ctrl+Alt+F) / fuzzy match in tree** `[relevance: High]` — type-to-filter within the file tree. Maps to our Tier 3 "file explorer filtering."
- **Activity bar + collapsible side bar model** `[relevance: High]` — vertical strip of view controls + a side bar showing the active view; controls persist when the side bar collapses. We already encoded this exactly in P18.
- **Recent files** `[relevance: Med]` — File menu recent list + seeded into Quick Open. Maps to our Tier 0 recent-files affordance.
- **Ctrl+Tab recent-file cycling** `[relevance: Med]` — cycles through recently opened editors (MRU order).
- **Go to Symbol (Ctrl+Shift+O)** `[relevance: Med]` — jumps to a symbol/heading within the file; the markdown analogue is jumping between headings — overlaps our outline/TOC jump shortcuts (Tier 0).
- **Go to Line (Ctrl+G)** `[relevance: Low]` — jump to line number.
- **Basic markdown editing affordances** `[relevance: Low]` — markdown syntax highlighting, built-in markdown preview (NOT pandoc — irrelevant to our loop), snippet support, bracket matching, folding. The trivial-formatting parts are Low by definition; the structural ones (folding, bracket matching) we already track in Tier 0.

## Parity matrix

| feature | target has it | our status | math-writing relevance | notable mechanism worth porting |
| --- | --- | --- | --- | --- |
| Quick Open / Go to File (Ctrl+P, fuzzy) | yes | planned: Tier 3 Ctrl+P workspace browser | High | fuzzy file jump = our exact pattern (delivered via fzf/dmenu plugin) |
| Recent files in quick-open | yes | planned: Tier 0 recent files + Tier 3 browser | Med | seed the quick-open list with MRU files |
| Command Palette (Ctrl+Shift+P) | yes | gap (not tracked) | Med | single fuzzy command surface with prefix tokens |
| Explorer / file tree side bar | yes | planned: Tier 3 tree (P6); activity bar P18 | High | create/rename/delete/context-menu in tree |
| Type-to-filter in tree (Ctrl+Alt+F) | yes | planned: Tier 3 file-explorer filtering | High | filter-as-you-type |
| Activity bar + collapsible side bar | yes | have-ish: P18 already specifies this exactly | High | already ported (P18) |
| Right-click context menu in tree | yes | planned: Tier 3 right-click menu (xdg-open + file ops) | High | ours adds xdg-open for unknown types |
| Ctrl+Tab MRU editor cycling | yes | gap (relevant once editor tabs land, Tier 3) | Med | MRU cycle across open tabs |
| Go to Symbol / heading jump | yes | planned: Tier 0 outline/TOC jump shortcuts | High | within-file heading navigation |
| Markdown folding / bracket matching | yes | planned: Tier 0 (folding, matched-delimiter highlight) | Med | CodeMirror extensions |
| Built-in markdown preview | yes (NOT pandoc) | planned: Tier 0 (ours = real pandoc, P1/P4) | High | anti-pattern; do NOT port VSCode's preview |

## Gaps

Features VSCode has (within the four in-scope surfaces) that our catalogue does NOT track — net-new candidates:

- **Command Palette (single fuzzy command surface)** `[relevance: Med]` — our catalogue routes actions through native menus, the insertion bar, and keyboard shortcuts, but has NO single fuzzy "run any command" surface. For a power user navigating a large thesis, a command palette (with prefix tokens: `>` commands, `@` symbols, `:` line) is a coherent net-new candidate — and it could itself live behind the plugin firewall (fzf-driven), consistent with our "OS-integration-as-plugin" doctrine. Record as a net-new candidate.
- **Quick Open prefix-token reuse** `[relevance: Low–Med]` — VSCode overloads one input (Ctrl+P) with `@` (go to symbol), `:` (go to line), `#` (workspace symbol). Our Ctrl+P browser is file-only; folding symbol/line jumps into the same fuzzy surface is a small net-new ergonomic idea.
- **Ctrl+Tab MRU editor cycling** `[relevance: Med]` — most-recently-used cycling across open editors. Becomes relevant only once our Tier 3 editor-tabs land; not tracked as a shortcut. Minor net-new.

Negative finding:

- Searched: VSCode userinterface docs (Command Palette, Quick Open, Explorer) — only the four in-scope surfaces.
- Found: the in-scope surfaces map almost entirely onto features we already track (Tier 0 affordances, Tier 3 tree + Ctrl+P browser + filtering + context menu, P18 activity bar); the only genuinely untracked items are the command palette, prefix-token overloading, and MRU cycling.
- Conclusion: I believe VSCode contributes little net-new to our roadmap beyond the command-palette concept and the keybinding correction; its main value is confirming our existing Tier 3 navigation design matches the canonical VSCode pattern and fixing the transposed bindings.
- Confidence: High (official docs; scope deliberately narrow).
- Gaps: I did not survey VSCode's markdown EXTENSIONS (out of scope); any markdown-specific affordances beyond the built-ins were not researched.

## Dispositions

- **Built-in (non-pandoc) markdown preview** — excluded as a core-loop approach. Reason: our P1/P4 invariant requires the preview to be real pandoc output; VSCode's markdown-it preview is the same anti-pattern as pandoc-editor's react-markdown preview.
- **Extensions marketplace, language servers, integrated terminal, debugging, source control UI** — out of scope per task; the source control UI specifically is a banned non-goal (generic Git client UI) ([[../product-destination-what-done-looks-like]]). We keep git local-only with a tracked/untracked indicator (Tier 1), not a git client.
- **Full IDE / file-manager surface** — excluded — banned non-goals (full file manager). Our tree is workspace-scoped with guarded Rust file ops, not a general file manager.
- **Command palette** — recorded as a net-new candidate (not a gimmick); if adopted it should live behind the plugin firewall (fzf/dmenu) per our OS-integration-as-plugin doctrine ([[../plugins-diagrams-figures-requirements]]), not as app-owned chrome.
