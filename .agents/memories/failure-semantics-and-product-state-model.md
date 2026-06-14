# Failure Semantics and Product State Model

# Failure Semantics and Product State Model

**When this applies:** implementing any error path, dialog, or state transition.
Source: the original repo's normative requirements authority (`.agents/memories/REQUIREMENTS.md` + `docs/testing-proof-obligations.md` + design-constraints, branch feature/tauri-first-architecture) — the most precise spec layer recovered.

**Failure semantics are TIERED, not uniformly fatal:**

- **App logic failures** → crash loudly (internal bugs).
- **Render failures** → **NON-FATAL by requirement (REQ-001)**: surface the raw error dump in a scrollable log within the preview pane, "similar to Overleaf."
  And they must **recover cleanly**: after the user restores a valid render command, the diagnostics panel disappears and preview/status return to ready.
  Fail-loud means visible diagnostics, never app death.
- **Plugin failures** → structured errors surfaced via toasts; state transitions (running → idle) always visible, never stuck.
- **External tool contract failures** → fail loudly at the extraction boundary.
  **Version pinning of TikZ tools is FORBIDDEN (ANTI-004):** track current tool versions and break loudly when an update violates the contract — drift detection over freezing.

**The product state model (enumerated, REQUIREMENTS.md §5):** `currentDocument: none | unsavedBuffer | savedFile(path)` · `bufferStatus: clean | dirty` · `renderStatus: idle | rendering | rendered | failed(log)` · `gitStatus: noRepo | untracked | trackedDirty | trackedClean` · `workspace: unset | root(path)` · `configuration: valid | invalid`. Save: dirty→clean + document update, plus commit when gitStatus permits.

**Forbidden-behavior inventory (user-surprise table, §9):** silent config fallback; hidden render failure (stale preview while user thinks it updated); best-effort save; temporary file used as identity for plugins/exports; suppressed stderr; **warning-only conflict handling** — concurrent/external edits must REFUSE the action, not warn-and-overwrite.

**Exact behavioral specs (proof-obligation grade):**

- **External modification protection:** if the active file changed on disk outside the app, the next save is rejected visibly (mtime + content-hash conflict detection); never overwrite the external change.
- **Dirty-buffer replacement dialog, three exact branches:** Cancel = editor/preview/identity/disk all unchanged; Discard = swap to new target without writing the old buffer; Save = persist first, then complete the requested action.
- **Workspace root moves atomically with Save As:** saving inside the workspace keeps the root; saving outside moves root + explorer state + reload identity together.
- **Quick Open launcher contract:** launcher cancellation is cancellation, not an error; missing launcher = visible failure.
- **Citation insertion uses the citation boundary, NOT the save gate** — it inserts at cursor and must never trigger save or file-selection UI (plugins are save-gated; citations are not).
- **beforeunload warning matches dirty state** exactly (dirty warns, clean doesn't).
- **Tool discovery: once at startup**, cached, exposed to the UI which grays out unavailable tools; the launch boundary still hard-fails if a missing tool is requested.
  (This is the resolved design after a relaxed-probe regression was reverted.)

Related: [Contract Invariants and Ownership Boundaries](contract-invariants-and-ownership-boundaries), [Recovery and Git-State Requirements](recovery-and-git-state-requirements), [Renderer Invariant and Slop Gates](renderer-invariant-and-slop-gates).
