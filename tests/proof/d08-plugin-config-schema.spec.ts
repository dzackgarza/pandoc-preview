import { test, expect, loadDoctorManifest, spawnDoctor } from './support/process-spec';
import { recordObservation } from './support/observations';

// A2 (d08) — The SAME generic JSON-Schema validator the doctor uses for plugin
// config sections rejects a section that violates its plugin's declared schema
// and accepts one that conforms — with ZERO plugin-specific knowledge in the
// core.
//
// The provisioned config (scripts/provision-proof.sh, d08 branch) declares the
// plugins dir and two discovered fixture plugins with DIFFERENT schemas:
//   [plugin.witness-tool] greeting = "hi"   -> conforms to witness-tool/schema.json
//   [plugin.ratio-tool]   ratio    = 5      -> violates ratio-tool/schema.json (max 1)
// A single hard-coded validator could not simultaneously accept the `greeting`
// section and reject the out-of-range `ratio` section: discriminating it requires
// validating each [plugin.<id>] section against THAT plugin's declared schema.
//
// The doctor surfaces one plugin-config check per discovered plugin (named
// `plugin-config:<id>`), OK when the section conforms and FAIL (naming the
// offending schema location) when it does not. A schema violation fails the
// doctor (exit 1).
//
// RED today: the generic plugin-config validator does not exist. The core Config
// has no notion of [plugins]/[plugin.<id>] sections, no plugin discovery, and no
// per-plugin schema check — the report carries no `plugin-config:*` rows at all.

test('the generic validator rejects a bad plugin section and accepts a good one, per declared schema', async () => {
  const manifest = loadDoctorManifest();
  const result = await spawnDoctor(manifest, ['--doctor']);

  // The doctor consumer must self-terminate, never linger as a window.
  expect(result.killedByTimeout).toBe(false);
  // A plugin-config schema violation fails the doctor.
  expect(result.exitCode).toBe(1);

  const report = result.stdout.length > 0 ? result.stdout : result.stderr;

  // The report renders one line per check as `[MARKER] name: detail` (see
  // doctor.rs Report::render): the status marker directly precedes the name, and
  // the detail follows the name. The doctor surfaces one `plugin-config:<id>`
  // check per discovered plugin.
  //
  // ratio-tool's section violates ITS schema (ratio=5 exceeds maximum 1): the
  // per-plugin check fails.
  expect(/\[FAIL\]\s+plugin-config:ratio-tool\b/.test(report)).toBe(true);
  // The failure detail cites the schema location that was violated (the `ratio`
  // property), which follows the check name on that line.
  expect(/plugin-config:ratio-tool:[\s\S]{0,160}ratio/.test(report)).toBe(true);

  // witness-tool's section conforms to ITS (different) schema: validated OK by
  // the same generic code path that rejected ratio-tool.
  expect(/\[OK\]\s+plugin-config:witness-tool\b/.test(report)).toBe(true);
  // ...and it is not the failing check.
  expect(/\[FAIL\]\s+plugin-config:witness-tool\b/.test(report)).toBe(false);

  recordObservation({ spec: manifest.spec, name: 'doctor-exit-code', value: result.exitCode ?? -1 });
});
