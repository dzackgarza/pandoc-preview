import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';

// P17 — Exported HTML renders math offline (self-contained, no remote MathJax).
// (mathjax-offline-local-source-decision.md, decision A 2026-06-13.)
//
// The shipped `[export.html]` default must inline a LOCAL MathJax bundle
// (`--mathjax=<local>` + `--embed-resources`), not a CDN link, so a user on an
// airplane exports an HTML file that typesets math with no network.
//
// WHY ONLINE "no remote ref" DOES NOT DISCRIMINATE. Run ONLINE, the CURRENT
// default `--embed-resources --mathjax` already fetches the CDN bundle and
// inlines it, leaving no `<script src="https://...">` reference. (The inlined
// MathJax JS *text* still contains literal `https://cdn.jsdelivr.net/...`
// strings — speech-rule-engine runtime URLs — so a bare `cdn.jsdelivr`
// substring match is a FALSE discriminator and is deliberately NOT used here.)
// The real discriminator is running the export OFFLINE:
//   - CURRENT default, offline: exit 0 but `[WARNING] Could not fetch resource
//     https://cdn.jsdelivr.net/...mathjax...`, a dead `<script src="https://
//     cdn.jsdelivr...">` left in a file labelled self-contained, ~3 KB, math
//     broken offline. (Verified with pandoc 3.6 under `unshare -rn`.)
//   - decision-A default, offline: exit 0, NO fetch warning, the local MathJax
//     bundle inlined directly into a <script>, math renders offline.
//
// This spec proves it as an INDEPENDENT-PROCESS offline run of the SHIPPED
// `[export.html]` command, decoupled from the app (P12 already proves the app
// runs the configured argv verbatim; P7 proves the app drives [export.html]).
// The command is READ from the hermetic config the harness provisioned (not
// hard-coded), so this spec tracks whatever first-run.sh / provisioning ships.
//
// Discriminator (what each assertion kills) — every one is RED on the current
// shipped default when run offline:
//   - exit 0                          : a hard failure would be a different bug.
//   - stderr has NO "Could not fetch" : current offline emits the CDN fetch
//                                        warning; decision-A's local file does not.
//   - no `<script src="https://...">` : current offline leaves the dead CDN
//                                        <script src>; local inlining has none.
//   - substantial inlined MathJax JS  : current offline inlines nothing (~3 KB,
//                                        no MathJax body); local bundle is large.
//   - GOLD: the artifact, opened in a network-blocked plain Playwright page
//     (context.setOffline(true) — a real BrowserContext genuinely honors it),
//     typesets the P4 shape (mjx-container). Current offline artifact cannot:
//     its only MathJax loader is a dead CDN <script src> that an offline
//     browser cannot fetch, so no mjx-container ever appears.

test('shipped [export.html] inlines local MathJax and renders math offline', async ({}) => {
  const manifest = loadRunManifest();

  // ── Read the SHIPPED [export.html] command from the provisioned config ──
  // Independent process (python tomllib), mirroring support/toml.ts: the spec
  // must not trust any in-app report of what the command is, and must track
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
  const cfg = JSON.parse(cfgJson) as { export?: { html?: { command?: unknown } } };
  const command = cfg.export?.html?.command;
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    !command.every((a) => typeof a === 'string')
  ) {
    throw new Error(
      `provisioned config ${manifest.configPath} has no string[] [export.html].command; ` +
        `got ${JSON.stringify(command)}`,
    );
  }
  const shippedArgv = command as string[];

  // ── Resolve {input}/{output} exactly as render.rs::export_sync does ─────
  // Per-argument substring substitution of the placeholders against the real
  // witness demo.md and a chosen output path under the run dir.
  const inputPath = manifest.demoFile;
  const outputPath = join(manifest.runDir, 'export-offline-witness.html');
  const resolved = shippedArgv.map((arg) =>
    arg.replace('{input}', inputPath).replace('{output}', outputPath),
  );
  const [program, ...args] = resolved;

  // ── Run the shipped command OFFLINE as an independent process ───────────
  // `unshare -rn` runs the command in a fresh, network-isolated namespace
  // (precedent: scripts/provision-proof.sh p08 font-cache warmup, which runs
  // the shipped [export.pdf] command under the same hermetic env). cwd = the
  // source file's parent, mirroring the app's export contract (render.rs sets
  // current_dir to the source's parent). The hermetic HOME/XDG mirror what
  // proof-run.sh launches the app with, so resource resolution matches.
  //
  // spawnSync (not execFileSync) so stderr is captured even on a zero exit:
  // pandoc's offline fail-open exits 0 WITH the fetch warning on stderr, which
  // is the discriminating signal. spawnSync never throws on non-zero either.
  const run = spawnSync('unshare', ['-rn', program, ...args], {
    cwd: manifest.project,
    env: {
      ...process.env,
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

  // exit 0: the shipped export must succeed. (Current default offline ALSO
  // exits 0 — fail-open — so this alone is not the discriminator; the stderr
  // and artifact assertions below are.)
  expect(run.status).toBe(0);

  // No CDN fetch warning. Current default offline emits
  //   "[WARNING] Could not fetch resource https://cdn.jsdelivr.net/...mathjax..."
  // decision-A's local --mathjax=file://... emits none. Match the pandoc
  // warning phrasing case-insensitively.
  expect(/could not fetch/i.test(stderr)).toBe(false);

  // ── Parse the produced artifact ─────────────────────────────────────────
  const htmlText = readFileSync(outputPath, 'utf-8');

  // No external <script src="https://..."> MathJax loader. Current default
  // offline leaves a dead `<script src="https://cdn.jsdelivr.net/...">`; a
  // local inlining has no remote <script src> at all. Match a script tag whose
  // src is an https URL (the broken-offline signature), independent of host.
  const remoteScript = /<script\b[^>]*\bsrc\s*=\s*"https:\/\/[^"]*"/i.test(htmlText);
  expect(remoteScript).toBe(false);

  // A <script> carries SUBSTANTIAL inlined MathJax JS — the local bundle was
  // embedded. Current default offline inlines nothing (the ~3 KB dead-link
  // file has no MathJax body); the embedded bundle is hundreds of KB. Require
  // both a MathJax marker inside a script body AND a large script payload.
  const scriptBodies = [...htmlText.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (m) => m[1],
  );
  const mathjaxBody = scriptBodies.find(
    (body) => /MathJax/.test(body) && body.length > 50_000,
  );
  expect(typeof mathjaxBody).toBe('string');

  // ── GOLD: render the artifact in a network-blocked plain Playwright page ─
  // A real BrowserContext genuinely honors setOffline(true) (verified), so
  // this proves the artifact typesets math with NO network. The current
  // offline artifact cannot: its only MathJax loader is a dead CDN <script
  // src> the offline browser cannot fetch, so no mjx-container appears.
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
    // SVG bundle (tex-svg-full.js) fetches nothing. We abort any non-local
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
    expect((mmlRaw as string).replace(/\s+/g, '')).toBe('ζ(2)=π2/6');
  } finally {
    await browser.close();
  }

  recordObservation({
    spec: manifest.spec,
    name: 'offline-export-bytes',
    value: Buffer.byteLength(htmlText, 'utf-8'),
  });
});
