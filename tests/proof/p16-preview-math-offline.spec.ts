import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, previewQuery, waitForPreview } from './support/app';

// P16 — Preview math renders with no network (local MathJax).
// (mathjax-offline-local-source-decision.md, decision A 2026-06-13.)
//
// The live preview must typeset its math from a LOCALLY-BUNDLED MathJax shipped
// with the app, addressed through Tauri's asset protocol — never a CDN. The
// asset protocol serves a local file, so it is network-free by construction; an
// app that loads MathJax this way renders math on an airplane (a normal use
// case), whereas the current bare `--mathjax` preview (render.rs:12 emits
// `<script src="https://cdn.jsdelivr.net/...mathjax...">`) leaves raw
// `$\zeta(2)` text whenever there is no network.
//
// This spec asserts BOTH halves of that obligation against the live preview
// iframe after opening demo.md:
//
//   (1) The element that loads MathJax has a src that does NOT reference any
//       remote host (no `https://`, no `cdn.jsdelivr`, no `http://` to a real
//       network host). Asserted via the NEGATIVE "no remote URL" rather than a
//       hard-coded asset scheme, because the implementer has not finalized the
//       exact local scheme (it may surface as `asset://localhost/...` or
//       `http://asset.localhost/...`). Any of those is network-free; a CDN URL
//       is not.
//
//   (2) The P4 render shape still holds: `span.math mjx-container` is present,
//       the assistive MathML flattens to exactly `ζ(2)=π2/6`, and the literal
//       `$\zeta(2)` does not survive as visible text. "No remote src" alone
//       would pass on an app that simply dropped MathJax and rendered nothing;
//       requiring the math to ACTUALLY render kills that. The conjunction
//       proves a local-sourced, offline-capable preview.
//
// Discriminator (what each assertion kills):
//   - assertion (1) kills the CURRENT impl: its MathJax `<script src>` is
//     `https://cdn.jsdelivr.net/...tex-chtml-full.js` (a remote CDN load).
//   - assertion (2) kills any "fix" that achieves no-remote-src by removing
//     MathJax entirely (raw `$\zeta(2)` text, no mjx-container).
//   Both must hold simultaneously → local MathJax that genuinely typesets.
//
// PROOF DEBT — in-app webview network isolation. The strongest proof would
// additionally cut the real Tauri webview's network (so even a CDN-sourced
// MathJax could not render) and still observe typeset math. Playwright's
// `context.setOffline(true)` operates on a Playwright BrowserContext, but in
// tauri mode the harness drives the REAL webview through a plugin socket
// (fixtures.ts: createTauriTest({ mcpSocket })); the TauriPage transport
// exposes no `context()`/`setOffline()` reaching that native webview, so there
// is no honest way to block the real webview's network from this spec. Faking
// it (e.g. routing the plugin's own request interceptor) would not block the
// in-webview `<script src>` of the same-origin srcdoc iframe and would prove
// nothing. Rather than weaken the proof with a fake, this spec relies on the
// no-remote-src + actually-renders discriminator above, which already fails on
// the CDN-bound current implementation. Recorded as explicit proof debt.

test('preview typesets math from a local (non-remote) MathJax source', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);

  // Wait for the MathJax typeset container to appear inside pandoc's own math
  // span — proves the formula went through pandoc's math pathway AND that the
  // (local) MathJax script loaded and ran. On the current CDN-bound impl with
  // no network this never appears; with network it appears but assertion (1)
  // below still fails on the remote src. Either way the current impl is red.
  await waitForPreview(
    tauriPage,
    `return d.querySelector('span.math mjx-container') !== null;`,
  );

  // ── (1) The MathJax loader's src must reference NO remote host ───────────
  // Collect the src of every <script> in the preview document that references
  // mathjax (case-insensitive). There must be at least one such script (the
  // MathJax bootstrap), and none of them may point at a remote URL.
  const mathScriptSrcs = (await previewQuery(
    tauriPage,
    `return Array.from(d.querySelectorAll('script[src]'))
      .map((s) => s.getAttribute('src'))
      .filter((src) => src && /mathjax/i.test(src));`,
  )) as string[];

  // There is a MathJax loader script at all (pandoc's --mathjax injects one).
  expect(Array.isArray(mathScriptSrcs)).toBe(true);
  expect(mathScriptSrcs.length).toBeGreaterThan(0);

  // None of the MathJax script srcs is a remote reference. A remote reference
  // is: an https:// URL, an http:// URL to a real network host (NOT the
  // asset-protocol host `asset.localhost`), or any reference to a known CDN.
  for (const src of mathScriptSrcs) {
    const lower = src.toLowerCase();
    expect(lower.startsWith('https://')).toBe(false);
    expect(lower.includes('cdn.jsdelivr')).toBe(false);
    expect(lower.includes('//cdnjs.')).toBe(false);
    expect(lower.includes('unpkg.com')).toBe(false);
    // An http:// URL is only acceptable when it is Tauri's asset-protocol host
    // (http://asset.localhost/...), which serves a bundled local file. An
    // http:// URL to any other host is a real network load and is rejected.
    if (lower.startsWith('http://')) {
      expect(lower.startsWith('http://asset.localhost')).toBe(true);
    }
  }

  // ── (2) The P4 render shape holds: math actually typeset ────────────────
  // Assistive MathML flattens \zeta(2) = \pi^2/6 to the exact character
  // sequence ζ(2)=π2/6 (superscript position lost in textContent). Whitespace
  // stripped only to neutralize MathML pretty-printing; still fails on wrong
  // TeX, an unwired engine, or junk.
  const mmlRaw = await previewQuery(
    tauriPage,
    `return d.querySelector('span.math mjx-container mjx-assistive-mml')?.textContent ?? null;`,
  );
  expect(typeof mmlRaw).toBe('string');
  const mml = (mmlRaw as string).replace(/\s+/g, '');
  expect(mml).toBe('ζ(2)=π2/6');

  // The raw dollar-delimited source must not survive as visible text — the
  // offline failure mode of a CDN-bound preview leaves exactly this literal.
  const rawPresent = await previewQuery(
    tauriPage,
    `return d.body.textContent.includes('$\\\\zeta(2)');`,
  );
  expect(rawPresent).toBe(false);

  recordObservation({
    spec: manifest.spec,
    name: 'mathjax-script-src',
    value: mathScriptSrcs.join(' | '),
  });
});
