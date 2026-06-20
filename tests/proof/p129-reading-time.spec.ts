import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { parseTomlFile } from './support/toml';
import { openAndSelectDemo, waitForHarness, waitForPreview, appendAtEnd, sleep } from './support/app';

// P129 (Phase H / H.4) — READING-TIME METRIC IN THE STATUS CLUSTER (obligation P123).
//
// RESEARCH-FIRST: this is a DERIVED metric over surfaces that already ship, NOT a
// new buffer scan or new App state. The status cluster (StatusBar.svelte) already
// renders the live word count as a `<span>{wordCount} words</span>` fed by
// App.svelte's `wordCount` $state (recomputed on every edit via
// content.split(/\s+/).filter(Boolean).length). The reading-time metric is a
// SIBLING `<span>` derived as ceil(wordCount / reading_wpm), where reading_wpm is
// CONFIG-OWNED ([editor].reading_wpm — config.rs Editor, range-validated in
// validate() like font_size/debounce_ms, round-tripped by save_config, the P9
// class). No new scan: it reuses the SAME word count the app already displays.
//
// WHAT THIS SPEC PROVES (P123 observable clauses — nothing about wiring):
//   (1) DERIVED VALUE. With a buffer of a known word count (read from the status
//       cluster's own `{N} words` span) and the config-owned reading_wpm (read
//       INDEPENDENTLY from the on-disk config.toml by python tomllib), the status
//       cluster shows a reading-time value equal to ceil(words / reading_wpm).
//   (2) LIVE UPDATE. Editing the buffer to change the word count (appendAtEnd —
//       the real docChanged pipeline) updates the displayed reading time to
//       ceil(newWords / reading_wpm). The metric is not stale.
//   (3) CONFIG-OWNED (NOT HARDCODED). The provisioned reading_wpm is a
//       DISTINCTIVE, non-round 137 (provision-proof.sh p129 case), so
//       ceil(words/137) cannot coincide with the value a hardcoded default (e.g.
//       200 wpm) would yield. Clause (1)'s equality to ceil(words/configWpm) — for
//       the WPM read from disk, not a literal — therefore fails on a dead/hardcoded
//       config. The same buffer provisioned against a DIFFERENT reading_wpm would
//       show a DIFFERENT reading time (a re-run with another WPM flips the expected
//       value), which is exactly the "different config → different result" the
//       obligation names.
//
// The word count is read from the app's OWN status-cluster span (so the metric is
// proven derived from the SAME count the app shows, not a recount); the WPM is read
// independently of the app by parseTomlFile.
//
// ADMISSIBLE because it FAILS on a plausibly broken app:
//   - NO reading-time metric (the status cluster shows ONLY the word count):
//     there is no status-cluster span carrying a reading time, so the lookup
//     returns null and the clause-(1) assertion fails — the faithful "metric is
//     absent" failure.
//   - HARDCODED WPM (the config is dead): a metric computed from a baked-in WPM
//     would NOT equal ceil(words/137) for the provisioned distinctive 137 — clause
//     (1)/(3) fails.
//   - STALE metric (does not track the live word count): after appendAtEnd changes
//     the word count, a metric that does not recompute would still show the old
//     ceil — clause (2) fails.
//   - An existence-only span (e.g. a "0 min" placeholder unrelated to words/wpm)
//     would match none of clauses (1)–(3), which pin the EXACT ceil(words/wpm).
//
// RED EXPECTATION today: there is NO reading-time metric. StatusBar.svelte renders
// only `Ln/Col` and `{wordCount} words` — no reading-time sibling span — and
// config.rs Editor has NO reading_wpm field. So the status cluster carries no
// reading-time span, readingTime(...) below returns null, and clause (1)'s
// assertion (`expect(reading).not.toBeNull()` then the ceil equality) fails — the
// faithful "no reading-time metric in the status cluster" failure. The app BOOTS
// cleanly, the project opens, demo.md renders (its <h1> is present) and the word
// count is shown BEFORE the reading-time lookup, so the failure is the MISSING
// metric, never a boot or config-schema error.

// Read the live word count the status cluster itself shows. The status bar is the
// bottom `border-t` strip (StatusBar.svelte); the word count is the span whose
// text is `{N} words`. Returns the integer N, or null if absent.
async function shownWordCount(
  page: { evaluate(expr: string): Promise<unknown> },
): Promise<number | null> {
  const value = await page.evaluate(`(() => {
    const spans = Array.from(document.querySelectorAll('span'));
    const wc = spans.find((s) => /^\\s*\\d+\\s+words\\s*$/.test(s.textContent || ''));
    if (!wc) return null;
    const m = (wc.textContent || '').match(/(\\d+)/);
    return m ? Number(m[1]) : null;
  })()`);
  return value === null ? null : Number(value);
}

// Read the reading-time value the status cluster shows, as an integer count of
// minutes. The reading time is a status-cluster span carrying a time unit
// ("min"); we parse its leading integer. Scoped to the status bar (the bottom
// `border-t` strip) and required to be DISTINCT from the `{N} words` span so a
// word-count span is never misread as a reading time. Returns null if no such
// reading-time span exists (today's RED state).
async function readingTimeMinutes(
  page: { evaluate(expr: string): Promise<unknown> },
): Promise<number | null> {
  const value = await page.evaluate(`(() => {
    const bar = Array.from(document.querySelectorAll('div')).find(
      (d) => /border-t/.test(d.className) &&
        Array.from(d.querySelectorAll('span')).some((s) => /\\bwords\\b/.test(s.textContent || '')),
    );
    if (!bar) return null;
    const spans = Array.from(bar.querySelectorAll('span'));
    const rt = spans.find(
      (s) => /\\bmin\\b/.test(s.textContent || '') && !/\\bwords\\b/.test(s.textContent || ''),
    );
    if (!rt) return null;
    const m = (rt.textContent || '').match(/(\\d+)/);
    return m ? Number(m[1]) : null;
  })()`);
  return value === null ? null : Number(value);
}

test('reading-time metric reflects the word count and the config WPM', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // Bring the app + project + HTML preview up FIRST, so a RED failure below is
  // demonstrably the missing READING-TIME metric, not a boot/open/render error.
  await waitForHarness(tauriPage);
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Baseline: the status cluster ALREADY shows the live word count (the existing
  // shipped surface, proving the app booted and a file is open — so a failure
  // below is the MISSING reading-time metric, never a boot/open error). The
  // reading-time metric must be DERIVED from THIS count.
  const words0 = await shownWordCount(tauriPage);
  expect(words0).not.toBeNull();
  expect(words0 as number).toBeGreaterThan(0);

  // ── Clause (1): DERIVED VALUE — the status cluster shows ceil(words / wpm) ──
  // FIRST the metric must EXIST in the status cluster. RED today: StatusBar.svelte
  // renders only `Ln/Col` and `{wordCount} words` — there is NO reading-time
  // sibling span — so readingTimeMinutes() returns null and THIS assertion fails.
  // The faithful "no reading-time metric in the status cluster" failure, observed
  // AFTER the word count has rendered (so it is not a boot error). This gate fires
  // before the config-WPM read below, so the RED cause is the absent metric, not a
  // missing config key.
  const reading0 = await readingTimeMinutes(tauriPage);
  expect(reading0).not.toBeNull();

  // The config-owned WPM, read INDEPENDENTLY of the app from the on-disk
  // config.toml (python tomllib). The GREEN impl adds [editor].reading_wpm
  // (config.rs Editor, range-validated, round-tripped — the P9 class) and the
  // matching p129 provisioning case writes a DISTINCTIVE, non-round
  // reading_wpm = 137, so ceil(words/137) cannot coincide with the value a
  // hardcoded default (e.g. 200 wpm) would yield — a dead/hardcoded metric fails
  // the equality below. The same buffer provisioned against a DIFFERENT
  // reading_wpm would change the expected value (a re-run with another WPM flips
  // it), which is the "different config → different result" the obligation names.
  const cfg = parseTomlFile(manifest.configPath);
  const wpm = (cfg.editor as Record<string, unknown> | undefined)?.reading_wpm;
  expect(typeof wpm).toBe('number');
  const readingWpm = wpm as number;
  expect(readingWpm).toBe(137);
  const expected0 = Math.ceil((words0 as number) / readingWpm);

  // Clause (3) folded in: the displayed value equals ceil(words / configWpm) for
  // the WPM read from disk (137) — a hardcoded WPM would not satisfy this.
  expect(reading0).toBe(expected0);

  // ── Clause (2): LIVE UPDATE — editing the buffer updates the reading time ──
  // Append enough distinctive words to push the word count over the next
  // ceil(words/137) boundary, so a recomputing metric MUST change its displayed
  // value while a stale one would not. 200 added words ⇒ at least one more minute.
  const ADDED = 200;
  const extra = ' ' + Array.from({ length: ADDED }, (_, i) => `lattice${i}`).join(' ');
  await appendAtEnd(tauriPage, extra);

  // Wait for the status cluster's own word count to reflect the edit, then assert
  // the reading time tracks the NEW count.
  let words1: number | null = null;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    words1 = await shownWordCount(tauriPage);
    if (words1 !== null && words1 >= (words0 as number) + ADDED) break;
    await sleep(100);
  }
  expect(words1).not.toBeNull();
  expect(words1 as number).toBeGreaterThanOrEqual((words0 as number) + ADDED);
  const expected1 = Math.ceil((words1 as number) / readingWpm);
  // The added words crossed a minute boundary, so the expected reading time
  // genuinely changed — a stale metric (still showing expected0) fails here.
  expect(expected1).toBeGreaterThan(expected0);

  const reading1 = await readingTimeMinutes(tauriPage);
  expect(reading1).not.toBeNull();
  expect(reading1).toBe(expected1);

  recordObservation({ spec: manifest.spec, name: 'reading-wpm', value: readingWpm });
  recordObservation({ spec: manifest.spec, name: 'words-before', value: words0 as number });
  recordObservation({ spec: manifest.spec, name: 'reading-minutes-before', value: expected0 });
  recordObservation({ spec: manifest.spec, name: 'words-after', value: words1 as number });
  recordObservation({ spec: manifest.spec, name: 'reading-minutes-after', value: expected1 });
});
