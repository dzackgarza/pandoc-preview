import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, waitForPreview, sleep } from './support/app';

// ── P96 — D-7: a registered NON-tikz figure's edit action launches the editor on
//    the tracked editable SOURCE — never the included render — and the pairing
//    persists across an app restart ───────────────────────────────────────────
//
// THE OBLIGATION (proof-obligations.md, P96 — exact behaviour, verbatim intent):
//   With a NON-tikz figure registered — a DUAL asset whose editable SOURCE (an
//   .ipe/.svg) is tracked ALONGSIDE the included RENDER (the PDF/SVG actually
//   embedded in the document) — invoking that figure's edit action launches the
//   diagram-tool editor, via the plugin firewall, on the tracked editable SOURCE:
//   the path the launched diagram-tool plugin receives is the SOURCE path, NOT
//   the included render path. NO tikz extraction is attempted on a non-tikz
//   figure (Ipe owns no tikz — there is no owned parser in this path). The
//   source↔render pairing is held in a host-filesystem registry sidecar, so
//   after an app RESTART the SAME figure still resolves to the SAME editable
//   source. A missing tracked source is a LOUD error — never a silent
//   fall-through to opening the render.
//
// ── WHY THE WIRING IS PROVEN THROUGH A REAL RECORDING PLUGIN ──────────────────
// A real Ipe/Inkscape GUI cannot be asserted headless, so the WIRING is proven
// through the REAL plugin firewall by a REAL diagram-tool plugin (NOT a mock)
// whose launch command is a thin script that RECORDS the {file} argv it received
// to a sentinel file. The plugin (tests/proof/fixtures/plugins/
// recording-diagram-tool) declares `category = "diagram-tool"` and an [exec]
// launch command `launch.sh {file} {config_dir}`; the firewall substitutes the
// figure's tracked editable SOURCE into {file} and spawns it. launch.sh writes
// the SOURCE path it was handed to <config_dir>/recording-diagram-tool.launched-on.
// The DECISIVE observable is that this recorded path — read by an INDEPENDENT
// process below — is the editable SOURCE (fig.svg), NOT the included render
// (fig-render.svg). The recorded path cannot be fabricated: it is whatever the
// edit action actually launched the editor on.
//
// ── THE DUAL ASSET ON DISK (provision-proof.sh, p106 branch) ──────────────────
//   <project>/fig.svg         — the editable SOURCE (the .svg the editor opens)
//   <project>/fig-render.svg  — the included RENDER (the asset embedded in the
//                               document; a DIFFERENT file with different bytes)
// They are distinct files; the figure tracks the source ALONGSIDE the render.
//
// ── THE OBSERVABLE CONTRACT (hooks + observables, BLIND to implementation) ────
// To drive this deterministically the harness must (1) register the figure's
// source↔render pairing into the host-FS registry sidecar, (2) invoke the
// figure's edit action, and (3) let the recording diagram-tool plugin launch via
// the real firewall and write its sentinel. Webview clicks into an edit control
// are flaky (the reason P52–P62 / P104 drive actions through harness hooks), so
// the registration and the edit action are NEW harness hooks (BLIND to how they
// are built; only the observables matter):
//
//   __PPE_E2E__.registerFigureAssets(render, source)   [NEW for P106 / D-7]
//     Registers the dual-asset pairing for a non-tikz figure: the included RENDER
//     path and its editable SOURCE path. The pairing is persisted to the host-FS
//     registry SIDECAR (an XDG-state JSON, the session.json/fold-state.json
//     read-/save-state pattern — NOT browser storage), so a restarted app reads
//     it back. Fire-and-forget; returns null. The decisive observable of
//     persistence is the sidecar file ON DISK, read INDEPENDENTLY below.
//
//   __PPE_E2E__.editFigure(render)   [NEW for P106 / D-7]
//     Performs the SAME action a user's "edit this figure" control fires for the
//     figure whose included render is `render`: resolves that render to its
//     tracked editable SOURCE via the registry sidecar, then launches the
//     diagram-tool plugin (firewall, configure_plugin-shaped detached spawn) on
//     the SOURCE — substituting the source path into the plugin's {file}. NO tikz
//     extraction is attempted (the figure is non-tikz; there is no owned parser
//     in this path). A missing tracked source is a LOUD error, never a silent
//     fall-through to launching on the render. Fire-and-forget; returns null. The
//     decisive observable afterwards is the recording plugin's sentinel, read
//     INDEPENDENTLY off the host filesystem below.
//
// ── WHAT EACH ASSERTION KILLS ─────────────────────────────────────────────────
//   (A) After editFigure(render), the recording plugin's sentinel exists and its
//       recorded path is the editable SOURCE (fig.svg).
//       KILLS an app that never launches the diagram-tool plugin (no sentinel)
//       and an app that does not substitute the figure's source into {file}.
//   (B) The recorded path is NOT the included render (fig-render.svg).
//       KILLS the render-launched bug: the edit action launches the editor on the
//       embedded render instead of the tracked editable source, so the dual-asset
//       tracking does not actually route the editor to the source.
//   (C) The source↔render pairing is PERSISTED in the host-FS registry sidecar on
//       disk (the editable source path appears in a sidecar JSON under
//       XDG_STATE_HOME, keyed to / paired with the render). Because the pairing
//       lives on the host filesystem (the place a restarted app reads), it
//       survives a restart.
//       KILLS a pairing held only in browser storage / in-memory (no on-disk
//       sidecar — the pairing would be lost across restart) and a registry that
//       never records the editable source.
//
// RED today: __PPE_E2E__.registerFigureAssets / editFigure do not exist — there
// is no dual-asset registry, no edit-this-figure action, and no diagram-tool
// launch — so the registerFigureAssets evaluate throws (the hook is absent). Even
// were a partial surface present, the sentinel is never written (no launch) and
// no registry sidecar appears on disk. The failure below is the MISSING
// dual-asset-registry / edit-launches-source behaviour, not a boot error: the app
// + preview are brought up first.

// Distinctive content markers committed into the two assets by provisioning, so
// an independent read can tell which file the editor was launched on.
const SOURCE_MARKER = '__P106_EDITABLE_SOURCE__';
const RENDER_MARKER = '__P106_INCLUDED_RENDER__';

// The recording plugin writes the {file} path it was launched on here, under the
// app's real config dir. A fixed name the spec reconstructs independently (see
// tests/proof/fixtures/plugins/recording-diagram-tool/launch.sh).
const SENTINEL_NAME = 'recording-diagram-tool.launched-on';

test('a registered non-tikz figure edit launches the editor on the tracked SOURCE (not the render), with the pairing persisted on the host filesystem', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // The app + preview must be alive first, so a later failure is the missing
  // dual-asset-registry behaviour, not a boot/setup error.
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // The dual asset on disk: a distinct editable SOURCE and included RENDER, both
  // staged in the hermetic project by provisioning. Confirm they exist and carry
  // their distinctive markers, so "launched on the source, not the render" is a
  // real distinction between two real files — not an artifact of one being absent.
  const figSource = join(manifest.project, 'fig.svg');
  const figRender = join(manifest.project, 'fig-render.svg');
  if (!existsSync(figSource)) {
    throw new Error(`provisioning did not stage the editable source at ${figSource}`);
  }
  if (!existsSync(figRender)) {
    throw new Error(`provisioning did not stage the included render at ${figRender}`);
  }
  expect(readFileSync(figSource, 'utf-8')).toContain(SOURCE_MARKER);
  expect(readFileSync(figRender, 'utf-8')).toContain(RENDER_MARKER);

  // The recording plugin records its launch path under the app's REAL config dir
  // (the dir the app was launched against). Reconstruct it independently from the
  // manifest's configPath.
  const configDir = dirname(manifest.configPath);
  const sentinel = join(configDir, SENTINEL_NAME);
  // Baseline: no launch has happened, so no sentinel exists yet. A pre-existing
  // sentinel would make the post-edit read meaningless.
  if (existsSync(sentinel)) {
    throw new Error(`recording-diagram-tool sentinel already present before edit: ${sentinel}`);
  }

  // Register the dual-asset pairing into the host-FS registry sidecar. RED today:
  // __PPE_E2E__.registerFigureAssets does not exist (there is no dual-asset
  // registry), so this evaluate throws — there is no surface to track a figure's
  // editable source alongside its included render.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.registerFigureAssets(${JSON.stringify(figRender)}, ${JSON.stringify(figSource)}); return null; })()`,
  );

  // Invoke the figure's edit action for the figure whose included render is
  // fig-render.svg. RED today: __PPE_E2E__.editFigure does not exist — there is no
  // edit-this-figure action and no diagram-tool launch — so this evaluate throws.
  // The edit action must resolve the render to its tracked SOURCE via the registry
  // and launch the diagram-tool plugin on the SOURCE.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.editFigure(${JSON.stringify(figRender)}); return null; })()`,
  );

  // The launch is async (registry resolve + detached firewall spawn + the plugin
  // writing its sentinel). Poll for the sentinel to appear on the host filesystem.
  for (let i = 0; i < 80 && !existsSync(sentinel); i++) {
    await sleep(250);
  }
  if (!existsSync(sentinel)) {
    throw new Error(
      `recording-diagram-tool sentinel never appeared at ${sentinel}. The edit ` +
        `action did not launch the diagram-tool plugin on the figure's source ` +
        `through the plugin firewall.`,
    );
  }

  // (A)+(B) THE DECISIVE OBSERVABLE: the recorded launch path is the editable
  // SOURCE (fig.svg), NOT the included render (fig-render.svg). Read INDEPENDENTLY
  // off disk — never from the app's own report of what it launched.
  const launchedOn = readFileSync(sentinel, 'utf-8').trim();
  // (A) The editor was launched on the tracked editable source.
  expect(launchedOn).toBe(figSource);
  // (B) ...and NOT on the included render. KILLS the render-launched bug.
  expect(launchedOn).not.toBe(figRender);

  // (C) The source↔render pairing is PERSISTED in a host-FS registry sidecar — an
  // XDG-state JSON under XDG_STATE_HOME (the session.json/fold-state.json
  // read-/save-state pattern), NOT browser storage. Because it lives on the host
  // filesystem (where a restarted app reads), the pairing survives a restart.
  // Discover the sidecar under the app's hermetic XDG_STATE_HOME (the spec does
  // NOT hardcode the sidecar filename — any JSON under the app's state dir whose
  // parsed content pairs THIS render with THIS source), read INDEPENDENTLY.
  const stateDir = join(manifest.xdgStateHome, 'pandoc-preview');
  const sidecar = findRegistrySidecar(stateDir, figRender, figSource);
  if (sidecar === null) {
    throw new Error(
      `no host-FS registry sidecar under ${stateDir} pairs the render ` +
        `${figRender} with its editable source ${figSource}. The dual-asset ` +
        `pairing was not persisted to the host filesystem, so it would be lost ` +
        `across an app restart.`,
    );
  }

  recordObservation({ spec: manifest.spec, name: 'p106-launched-on', value: launchedOn });
  recordObservation({ spec: manifest.spec, name: 'p106-registry-sidecar', value: sidecar });
});

// Search the app's host-FS state dir for a registry sidecar JSON whose parsed
// content pairs `render` with `source` (the editable source the render resolves
// to). Returns the sidecar path, or null if none records the pairing. This is the
// INDEPENDENT, restart-faithful read: the pairing must be readable from a real
// file on disk (the place a relaunched app reads), not from the live app's
// in-memory state. The exact sidecar filename/shape is the implementer's choice
// (the session.json/fold-state.json pattern), so this discovers any JSON under
// the state dir that, parsed, contains BOTH paths — proving the editable source
// is durably paired with the render, not merely the render alone.
function findRegistrySidecar(stateDir: string, render: string, source: string): string | null {
  if (!existsSync(stateDir)) return null;
  for (const candidate of walkJson(stateDir)) {
    let raw: string;
    try {
      raw = readFileSync(candidate, 'utf-8');
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A malformed registry is the implementer's loud-parse concern, not this
      // discovery's — skip non-JSON state files (e.g. session.json with a
      // different shape).
      continue;
    }
    // The pairing is present iff the parsed registry mentions BOTH the render and
    // its editable source (so the source is tracked ALONGSIDE the render, not the
    // render alone). Serialize the parsed structure and require both paths appear
    // — agnostic to whether the registry keys by render, by figure id, or as an
    // array of {render, source} entries.
    const flat = JSON.stringify(parsed);
    if (flat.includes(render) && flat.includes(source)) {
      return candidate;
    }
  }
  return null;
}

// Yield every .json file under `dir`, recursively. The registry sidecar is a JSON
// file under the app's XDG-state pandoc-preview dir.
function* walkJson(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkJson(full);
    } else if (st.isFile() && name.endsWith('.json')) {
      yield full;
    }
  }
}
