# Preview Iframe and Asset Resolution

# Preview Iframe and Asset Resolution

**When this applies:** implementing or modifying the preview pane, asset loading, or render-output injection. These are original-repo lessons (May 2026, Express + Tauri eras) that directly underpin the current P1/P5 obligations.

**Why the preview is an iframe:** pandoc `--standalone` output carries its own document-level CSS (e.g. `body { max-width: 36em }`) which, injected as `innerHTML`, bleeds into and constrains the whole app page (original commit 5f0a183: "restore iframe for preview"). The iframe confines the template's document semantics. Note the first greenfield iteration used same-document injection instead — but only because its harness lacked `frameLocator` ([Decision Provenance: User-Owned vs Framework-Forced](decision-provenance-user-owned-vs-framework-forced)); the current obligations (P1 "preview iframe document") restore the iframe model.

**The base-href trap:** a sandboxed `srcdoc` iframe's base URL defaults to `about:srcdoc`, so document-relative asset paths (images, figures) silently fail. The original fix (`.agents/memories/pandoc-preview-design-constraints.md`): inject a fully qualified absolute `<base href>` into the pandoc HTML before srcdoc assignment. In Tauri the equivalent is the asset-protocol URL chain — exactly what P5 asserts (`img` decodes to real pixel dimensions through the asset-protocol `<base href>` chain). Any preview change must keep this chain provable.

**Update discipline:** push-based updates only (the 300 ms nvim poll loop was the app's first burned performance mistake); debounced render requests with latest-wins coalescing ([Reference: Render Lifecycle (Tideflow, mdTeX)](reference-render-lifecycle-tideflow-mdtex)); scroll position captured before injection and restored post-layout in `requestAnimationFrame` with a programmatic-scroll guard.

Related: [Proof Obligations (P1–P11)](proof-obligations), [Contract Invariants and Ownership Boundaries](contract-invariants-and-ownership-boundaries).
