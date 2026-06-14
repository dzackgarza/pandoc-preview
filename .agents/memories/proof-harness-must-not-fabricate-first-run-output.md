---
name: proof-harness-must-not-fabricate-first-run-output
description: The proof harness must exercise what first-run.sh actually leaves behind, never inject artifacts production setup is responsible for.
metadata:
  type: feedback
---

# Proof harness must not fabricate first-run.sh's output

A whole class of "truly basic untested paths" hid behind a green 36/37 suite: the proof harness fabricated exactly the artifacts the real setup path was responsible for producing, so no spec ever exercised the production output.

Concretely (found & fixed 2026-06-15): `scripts/first-run.sh` wrote `[plugins].dir = $CONFIG_DIR/plugins` but never created that dir nor installed the shipped pandoc renderer (the renderer was never vendored — it lived only as a test fixture).
On a real machine `just dev`/`just setup` therefore failed the very next gate, the doctor's `plugins` check (`plugins dir … is not a directory`). The suite stayed green because EVERY real-first-run path (p10/d02/d03/d06/d07) called `install_plugin_fixtures "$CONFIG_DIR/plugins" pandoc-renderer` out-of-band right after running first-run.sh — doing first-run.sh's job for it — and p10 asserted the app booted, never `--doctor`.

**Why:** an injection that follows a real production step and supplies what that step should have produced is laundering: it proves the harness can build the state, not that the product can.
See [[first-run-config-bootstrap-pattern]] and [[renderer-plugin-architecture]].

**How to apply:**
- When a spec runs a real production script (first-run.sh, install-assets.sh, launch.sh, dev.sh), assert on what that script GENUINELY leaves behind.
  Inject nothing afterward that the script itself is supposed to create.
- The shipped pandoc renderer is vendored app-owned code at `src-tauri/resources/vendor/plugins/pandoc-renderer` (single source of truth).
  first-run.sh installs it into the configured plugins dir as a managed symlink.
  Synthetic-config specs copy it from that SAME vendor dir, never a second fixture.
- d14 guards the end-to-end invariant: the real first-run.sh output passes `--doctor` with no harness injection.
  d15 guards that `just dev` ROUTES a `plugins` doctor failure into reconfiguration (lib-recovery.sh classifies `[FAIL] plugins:` as reconfiguration-fixable, not an unrecoverable environment failure).
- Doctor recovery classification lives in `scripts/lib-recovery.sh`: a failure is "config-class" (route into gum first-run) iff reconfiguration can fix it — config-exists/schema/values AND plugins.
  pandoc-executable/invocation/pdf-engine are environment failures it cannot fix.
