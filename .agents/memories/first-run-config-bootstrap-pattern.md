# First-Run Config Bootstrap Pattern

**When this applies:** implementing or reviewing app startup, config loading, or first-run behavior in this project.

**The pattern (user-ratified during the first iteration):** strict fail-loud config in the binary is compatible with conventional XDG first-run UX — the two live at different layers.

- The Rust binary never generates, guesses, or defaults config at runtime. Missing or malformed values are a fatal, named error (P3-style validation). This is non-negotiable.
- First-run bootstrap is a **launcher concern**: a standard `gum`-based walkthrough script runs only when the config file is absent at the XDG path, writes the complete opinionated config (sourced from one place in Rust — the same generator as the explicit `setup-config` subcommand, the script hard-codes nothing), offers a review, then launches the strict binary.
- After bootstrap, every value still comes from the file; fail-loud is unchanged. "No runtime defaults" bans *silent value substitution*, not *a conventional first-run experience* — the first iteration's contract fused these two rules, and the fusion produced a launch-to-fatal-error-screen UX the user called "totally bizarre behaviour regarding XDG-compliant apps."

**Two distinct failure modes to verify against:** (1) the app silently inventing config values — banned, test that missing keys in an existing config are fatal; (2) a fresh launch dead-ending with no path forward — banned, test that a missing config file triggers the walkthrough (the human-runnable check: delete the config, launch, get prompted). The first iteration shipped failure mode 2 while proudly avoiding mode 1.

Related: [Threat Model: Polished Fallback Machine](threat-model-polished-fallback-machine), [Renderer Invariant and Slop Gates](renderer-invariant-and-slop-gates).
