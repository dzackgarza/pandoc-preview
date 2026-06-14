# Recovery and Git-State Requirements

**When this applies:** designing or reviewing anything touching persistence, save, autosave, recovery, or repo state.
User-stated 2026-06-13; the deepest priority in the app.

**Backups and restoration pathways are the HIGHEST priority** — the app exists partly to obviate a separate Sparkleshare/Dropbox-class store.
The core guarantee: **never permanently lose more than several seconds of work**, even if that means app-owned backup repos consuming gigabytes.
"Compute/energy/storage are wildly cheap compared to lost research work, corrupted papers."
Never trade recovery durability for storage frugality; retention pruning is not a feature request.

**Git-repo editing is the happy path**, and file state is an explicit machine with specific expectations per state:

- **Not in a git repo** — a recognized, gated state with an app shortcut to set up a proper repo immediately.
- **In a repo but untracked** — prominent indicator; shortcut to start tracking.
- **Tracked** — Save = real commit; full recovery semantics.
  Concrete Save semantics for a recovery-backed buffer (user, verbatim, May 21 session): "hitting Ctrl-S: saves the temp file, but then also forces a file naming/selection prompt where the REAL file should go, copies it there, and then THAT location becomes the editable file going forward.
  Similarly, plugin runs are gated by this — you can't export to PDF without first specifying a REAL place to save the file, and THAT is what's passed into the plugin."

The app provides quick paths OUT of degraded states, not accommodations for living in them: **"hard gating on correct academic workflows is far preferable than allowing muddied editing states that are partially tracked, partially recoverable, partially connected to canonical references."** Partial states are bugs to exit, never modes to support.

**Storage substrate rules (original design-constraints, the Anti-Sandbox Rule):** never store unsaved buffers or drafts in browser storage (localStorage/sessionStorage/IndexedDB) — sandboxed, volatile, invisible to host processes.
Backups live on the host filesystem (the recovery repo), continuously synchronized with a debounced loop; frequent loopback/disk writes are NOT "thrashing" — kernel-cached and near-free.
The model is explicitly swap-file-like: on startup the backend scans the recovery store and offers to restore the last active unsaved session.

**Fail-fast rationale (the user's own framing):** silent errors that can corrupt research work or surprise the user at a publishing deadline are FAR more damaging than a crash — a crash is expected behavior that "can be given to an agent to immediately repair the bug."
Crashes are recoverable by agents in minutes; corrupted manuscripts are not.

This deepens (does not replace) the mechanics in [Contract Invariants and Ownership Boundaries](contract-invariants-and-ownership-boundaries) and [Reference: Autosave and Git Recovery (SoloMD, mx)](reference-autosave-and-git-recovery-solomd-mx); the seconds-bound and gigabytes-are-fine stance govern every retention/cadence parameter in the config.
