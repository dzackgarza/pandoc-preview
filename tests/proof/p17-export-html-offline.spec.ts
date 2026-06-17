import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';

// P17 — Exported HTML renders math offline (self-contained, no remote MathJax).
// (mathjax-offline-local-source-decision.md, decision A 2026-06-13.)
//
// Export-as-plugin migration (export-plugins-contract.md; proof-obligations.md
// migration rulings 2026-06-17): HTML export is the shipped pandoc-html-export
// EXPORT-CATEGORY PLUGIN, not a core [export.html] table. The plugin owns the
// self-contained-offline flags: its export.sh layers `--mathjax=<plugin-local>`
// (the MathJax bundle vendored INSIDE the plugin dir, ruling 1) onto the raw
// pandoc command, so a user on an airplane exports an HTML file that typesets
// math with no network. The app core owns no pandoc/export command knowledge.
//
// WHY ONLINE "no remote ref" DOES NOT DISCRIMINATE. Run ONLINE, a bare
// `--embed-resources --mathjax` (the pre-decision default) already fetches the
// CDN bundle and inlines it, leaving no `<script src="https://...">` reference.
// (The inlined MathJax JS *text* still contains literal `https://cdn.jsdelivr
// .net/...` strings — speech-rule-engine runtime URLs — so a bare `cdn.jsdelivr`
// substring match is a FALSE discriminator and is deliberately NOT used here.)
// The real discriminator is running the export OFFLINE:
//   - a CDN-bound default, offline: exit 0 but `[WARNING] Could not fetch
//     resource https://cdn.jsdelivr.net/...mathjax...`, a dead `<script
//     src="https://cdn.jsdelivr...">` left in a file labelled self-contained,
//     ~3 KB, math broken offline. (Verified with pandoc 3.6 under `unshare -rn`.)
//   - the shipped plugin, offline: exit 0, NO fetch warning, the plugin-local
//     MathJax bundle inlined directly into a <script>, math renders offline.
//
// This spec proves it as an INDEPENDENT-PROCESS offline run of the SHIPPED
// pandoc-html-export PLUGIN command, decoupled from the app (P12 already proves
// the app runs the configured argv verbatim; P7 proves the app drives the
// pandoc-html-export plugin through the firewall). The command is READ from the
// plugin's manifest + its provisioned config section (not hard-coded), so this
// spec tracks whatever first-run.sh / provisioning ships.
//
// Discriminator (what each assertion kills) — every one is RED on a CDN-bound
// export when run offline:
//   - exit 0                          : a hard failure would be a different bug.
//   - stderr has NO "Could not fetch" : a CDN-bound offline run emits the fetch
//                                        warning; the plugin-local file does not.
//   - no `<script src="https://...">` : a CDN-bound offline run leaves the dead
//                                        CDN <script src>; local inlining has none.
//   - substantial inlined MathJax JS  : a CDN-bound offline run inlines nothing
//                                        (~3 KB, no MathJax body); local is large.
//   - GOLD: the artifact, opened in a network-blocked plain Playwright page
//     (context.setOffline(true) — a real BrowserContext genuinely honors it),
//     typesets the P4 shape (mjx-container). A CDN-bound offline artifact cannot:
//     its only MathJax loader is a dead CDN <script src> that an offline
//     browser cannot fetch, so no mjx-container ever appears.

test('shipped pandoc-html-export plugin inlines local MathJax and renders math offline', async ({}) => {
  const manifest = loadRunManifest();

  // ── Read the [plugins].dir + [plugin.pandoc-html-export] section from the
  // provisioned config (independent process, python tomllib; mirroring
  // support/toml.ts). The spec must not trust any in-app report and must track
  // whatever the harness shipped rather than hard-coding the flags.
  const cfgJson = execFileSync(
    'python3',
    [
      '-c',
      'import sys,tomllib,json;print(json.dumps(tomllib.load(open(sys.argv[1],"rb"))))',
      manifest.configPath,
    ],
    { encoding: 'utf-8' },
  );
  const cfg = JSON.parse(cfgJson) as {
    plugins?: { dir?: unknown };
    plugin?: Record<string, { command?: unknown }>;
  };
  const pluginsDir = cfg.plugins?.dir;
  if (typeof pluginsDir !== 'string' || pluginsDir.length === 0) {
    throw new Error(
      `provisioned config ${manifest.configPath} has no [plugins].dir string; ` +
        `got ${JSON.stringify(pluginsDir)}`,
    );
  }
  // The plugin's own config section, delivered to the plugin on
  // PPE_PLUGIN_CONFIG exactly as plugins.rs::run_plugin_sync / config_json do:
  // the raw pandoc command STRING the plugin's export.sh shlex-tokenizes and
  // runs verbatim (richness ruling 2). The schema marks `command` required.
  const pluginSection = cfg.plugin?.['pandoc-html-export'];
  const rawCommand = pluginSection?.command;
  if (typeof rawCommand !== 'string' || rawCommand.length === 0) {
    throw new Error(
      `provisioned config ${manifest.configPath} has no [plugin.pandoc-html-export].command ` +
        `string; got ${JSON.stringify(rawCommand)}`,
    );
  }
  const pluginConfigJson = JSON.stringify({ command: rawCommand });

  // ── Read the SHIPPED command from the installed plugin's MANIFEST ──────
  // The command source is the plugin's [exec].command (the firewall's argv,
  // ["{plugin_dir}/export.sh", "{file}", "{artifact}"]), NOT a core
  // [export.html] table — the app core owns no pandoc/export command knowledge.
  const pluginDir = join(pluginsDir, 'pandoc-html-export');
  const manifestPath = join(pluginDir, 'plugin.toml');
  const manifestJson = execFileSync(
    'python3',
    [
      '-c',
      'import sys,tomllib,json;print(json.dumps(tomllib.load(open(sys.argv[1],"rb"))))',
      manifestPath,
    ],
    { encoding: 'utf-8' },
  );
  const pluginManifest = JSON.parse(manifestJson) as {
    id?: unknown;
    category?: unknown;
    exec?: { command?: unknown };
  };
  if (pluginManifest.id !== 'pandoc-html-export' || pluginManifest.category !== 'export') {
    throw new Error(
      `installed plugin manifest ${manifestPath} is not the export-category ` +
        `pandoc-html-export plugin; got ${JSON.stringify(pluginManifest)}`,
    );
  }
  const manifestCommand = pluginManifest.exec?.command;
  if (
    !Array.isArray(manifestCommand) ||
    manifestCommand.length === 0 ||
    !manifestCommand.every((a) => typeof a === 'string')
  ) {
    throw new Error(
      `plugin manifest ${manifestPath} has no string[] [exec].command; ` +
        `got ${JSON.stringify(manifestCommand)}`,
    );
  }
  const shippedArgv = manifestCommand as string[];

  // ── Resolve the PLUGIN-LOCAL MathJax bundle ───────────────────────────
  // Ruling 1: the MathJax bundle is vendored INSIDE the plugin dir, never an
  // AppHandle resource path or a CDN. export.sh resolves it itself at
  // <plugin_dir>/mathjax/tex-full-svg-a11y.min.js and layers `--mathjax=<that>`
  // onto the raw command; the manifest command carries no {mathjax} token. This
  // spec asserts the plugin ships that bundle so the offline run can succeed.
  const mathjaxBundlePath = join(pluginDir, 'mathjax', 'tex-full-svg-a11y.min.js');
  if (!existsSync(mathjaxBundlePath)) {
    throw new Error(
      `pandoc-html-export plugin does not ship its local MathJax bundle at ` +
        `${mathjaxBundlePath}; export.sh cannot inline math offline`,
    );
  }

  // ── Substitute {plugin_dir}/{file}/{artifact} exactly as run_plugin_sync ─
  // Per-argument substring substitution of the firewall placeholders against
  // the installed plugin dir, the real witness demo.md, and a chosen output
  // path under the run dir.
  const inputPath = manifest.demoFile;
  const outputPath = join(manifest.runDir, 'export-offline-witness.html');
  const resolved = shippedArgv.map((arg) =>
    arg
      .replace('{plugin_dir}', pluginDir)
      .replace('{file}', inputPath)
      .replace('{artifact}', outputPath),
  );
  const [program, ...args] = resolved;

  // ── Run the shipped plugin command OFFLINE as an independent process ─────
  // `unshare -rn` runs the command in a fresh, network-isolated namespace
  // (precedent: scripts/provision-proof.sh p08 font-cache warmup, which runs
  // the shipped export command under the same hermetic env). cwd = the source
  // file's parent, mirroring the firewall's contract (run_plugin_sync sets
  // current_dir to the source's parent). PPE_PLUGIN_CONFIG carries the plugin's
  // own config section ({"command": "..."}), exactly as run_plugin_sync delivers
  // it. The hermetic HOME/XDG mirror what proof-run.sh launches with.
  //
  // spawnSync (not execFileSync) so stderr is captured even on a zero exit:
  // pandoc's offline fail-open exits 0 WITH the fetch warning on stderr, which
  // is the discriminating signal. spawnSync never throws on non-zero either.
  const run = spawnSync('unshare', ['-rn', program, ...args], {
    cwd: dirname(inputPath),
    env: {
      ...process.env,
      PPE_PLUGIN_CONFIG: pluginConfigJson,
      HOME: join(manifest.runDir, 'home'),
      XDG_CONFIG_HOME: manifest.xdgConfigHome,
      XDG_CACHE_HOME: join(manifest.runDir, 'xdg-cache'),
      XDG_STATE_HOME: join(manifest.runDir, 'xdg-state'),
    },
    encoding: 'utf-8',
  });

  // The namespace/exec layer itself must have launched the command. A spawn
  // error (e.g. unshare unavailable) is an environment fault, surfaced loudly
  // rather than silently passing.
  if (run.error) {
    throw new Error(`offline export spawn failed: ${run.error.message}`);
  }
  const stderr = run.stderr ?? '';

  // exit 0: the shipped export must succeed. (A CDN-bound offline run ALSO
  // exits 0 — fail-open — so this alone is not the discriminator; the stderr
  // and artifact assertions below are.)
  expect(run.status).toBe(0);

  // No CDN fetch warning. A CDN-bound offline run emits
  //   "[WARNING] Could not fetch resource https://cdn.jsdelivr.net/...mathjax..."
  // the plugin-local --mathjax=<plugin_dir>/mathjax/... emits none. Match the
  // pandoc warning phrasing case-insensitively.
  expect(/could not fetch/i.test(stderr)).toBe(false);

  // ── Parse the produced artifact ─────────────────────────────────────────
  const htmlText = readFileSync(outputPath, 'utf-8');

  // No external <script src="https://..."> MathJax loader. A CDN-bound offline
  // run leaves a dead `<script src="https://cdn.jsdelivr.net/...">`; a local
  // inlining has no remote <script src> at all. Match a script tag whose src is
  // an https URL (the broken-offline signature), independent of host.
  const remoteScript = /<script\b[^>]*\bsrc\s*=\s*"https:\/\/[^"]*"/i.test(htmlText);
  expect(remoteScript).toBe(false);

  // A <script> carries SUBSTANTIAL inlined MathJax JS — the local bundle was
  // embedded. A CDN-bound offline run inlines nothing (the ~3 KB dead-link file
  // has no MathJax body); the embedded bundle is hundreds of KB. Require both a
  // MathJax marker inside a script body AND a large script payload.
  const scriptBodies = [...htmlText.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (m) => m[1],
  );
  const mathjaxBody = scriptBodies.find(
    (body) => /MathJax/.test(body) && body.length > 50_000,
  );
  expect(typeof mathjaxBody).toBe('string');

  // ── GOLD: render the artifact in a network-blocked plain Playwright page ─
  // A real BrowserContext genuinely honors setOffline(true) (verified), so
  // this proves the artifact typesets math with NO network. A CDN-bound offline
  // artifact cannot: its only MathJax loader is a dead CDN <script src> the
  // offline browser cannot fetch, so no mjx-container appears.
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.setOffline(true);
    const page = await context.newPage();
    // Record every request that leaves the local file: a TRULY self-contained
    // artifact makes none. This is the discriminator the decision flagged
    // (mathjax-offline-local-source-decision.md): MathJax CHTML output loads
    // woff fonts at runtime from the MathJax path, so a tex-chtml bundle would
    // still produce mjx-container + assistive MathML (those are built by the JS)
    // while silently fetching fonts — visually broken offline. A self-contained
    // SVG bundle (tex-full-svg-a11y.min.js) fetches nothing. We abort any non-local
    // request AND assert zero such attempts occurred.
    const remoteAttempts: string[] = [];
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('blob:')) {
        route.continue();
      } else {
        remoteAttempts.push(url);
        route.abort();
      }
    });
    await page.goto(pathToFileURL(outputPath).href, { waitUntil: 'load' });
    // MathJax typesets client-side after the (inlined) script runs; the P4
    // shape must appear with no network. A CDN-bound artifact never reaches it.
    await page.waitForSelector('span.math mjx-container', { timeout: 30_000 });

    // The offline render attempted NO remote fetch — the bundle is genuinely
    // self-contained, not a CHTML bundle quietly reaching for fonts. (Joined
    // for a legible failure listing the offending URLs.)
    expect(remoteAttempts.join(' | ')).toBe('');

    const mmlRaw = await page.evaluate(
      () =>
        document.querySelector('span.math mjx-container mjx-assistive-mml')?.textContent ?? null,
    );
    expect(typeof mmlRaw).toBe('string');
    expect((mmlRaw as string).replace(/[\s\u2061-\u2064]/g, '')).toBe('ζ(2)=π2/6');
  } finally {
    await browser.close();
  }

  recordObservation({
    spec: manifest.spec,
    name: 'offline-export-bytes',
    value: Buffer.byteLength(htmlText, 'utf-8'),
  });
});
