# Founding Philosophy: Exact Pandoc Preview

# Founding Philosophy: Exact Pandoc Preview

**When this applies:** any product, performance, or UX decision — this is the app's reason to exist, in the user's verbatim words (opencode session ses_194d25aecffe, 2026-05-28, plus conception session 2026-05-19).

**The purpose (verbatim):** "The PURPOSE of the app is to get an immediate visual preview of EXACTLY what a pandoc CLI command will produce. That's the ENTIRE philosophy of the app: it is a REPLACEMENT for a manual loop that watches a file, compiles in pandoc, and renders in a separate browser. This is NOT a standard piece of markdown viewing software and should not be compared to one."

**Consequences, each user-stated:**

- **Full re-render is by design, not a defect:** "Inserting a theorem in a section could change the numbering everywhere. You HAVE to re-render the entire doc on changes... 'Optimizations' like re-rendering parts of the document are objectively wrong and produce a document that is NOT a faithful representation of what an independent full pandoc call would produce." Agents reading the pipeline as "thrashing the react tree" are wrong: "This is completely necessary by design." (Overrides any incremental-DOM instinct imported from markdown-it-class references.)
- **No preemptive performance work, ever:** "LLMs should almost never surface performance, timing, or responsiveness. Responsiveness issues are imagined unless there is a specific user-reported bug." And: "no tests should EVER test timing information... completely hallucinated benchmarks with no basis in reality."
- **Blocking UX is sometimes correct:** settings save blocks because "the pandoc command and flags MUST be validated, and you should NOT let the user edit a doc when there's transient state concerning how it's even rendered." Settings are "a thin interface over managing the config file."
- **Tight system integration is the point:** "One does not want 'Ctrl+O lets me select files'. They want 'Ctrl+O opens an extremely familiar tool like fzf or dmenu'... Hand-rolled implementations are slop imitations of tools the users already know and love." Native Tauri dialogs are the floor for standard open/save; familiar-system-tool integration (fzf/dmenu-class quick-open) is the spirit for power workflows.
- **Pandoc is the only parser for pandoc-markdown constructs:** "Fenced divs, bracketed spans, citations, raw TeX, display math, inline math, footnotes, tables, attributes, and metadata blocks are never parsed by custom regex code... Fail closed. If a block cannot be proven safe, leave it to Pandoc/Lua handling. Do not guess." (Stated for the flowmark wrapper; binds this app equally — no app-side regex over document structure.)
- **Shell-layer operations are owned by the shell:** "The app must NEVER implement its own tilde expansion, environment variable substitution, glob expansion." The sanctioned exception is one notation normalization (`~/` → `$HOME/`) before spawning; the shell resolves it.
- **Simplicity over coverage:** "An explicit goal is SIMPLICITY and MAINTAINABILITY and READABILITY of code. Not code that covers a million edge cases, not multi-platform support. Robust code for personal usage always."

Related: [Product Destination: What Done Looks Like](product-destination-what-done-looks-like), [Contract Invariants and Ownership Boundaries](contract-invariants-and-ownership-boundaries), [Original App History: Eras and Burned Mistakes](original-app-history-eras-and-burned-mistakes).
