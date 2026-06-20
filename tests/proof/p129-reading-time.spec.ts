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
//   (3) CONFIG-OWNED (NOT HARDCODED) — GENUINELY DISCRIMINATING. The provisioned
//       reading_wpm is a DISTINCTIVE, non-round 137 (provision-proof.sh p129 case),
//       AND the buffer is grown to a word count that lands ceil(words/137) in a
//       minute-bucket that is UNIQUE versus every plausible hardcoded default
//       divisor (100/200/250/300). For reading_wpm=137, EVERY word count in
//       [412, 1199] satisfies this: ceil(words/137) equals NONE of
//       ceil(words/100), ceil(words/200), ceil(words/250), ceil(words/300) on that
//       whole range (verified exhaustively). Concretely at ~454 words
//       ceil(454/137)=4 while ceil(454/200)=3, ceil(454/250)=2, ceil(454/300)=2,
//       ceil(454/100)=5 — so a hardcoded-200 impl would show "3 min", a
//       hardcoded-250/300 impl "2 min", a hardcoded-100 impl "5 min", but the real
//       config-bound impl shows "4 min". Clause (1)'s equality to
//       ceil(words/configWpm) — for the WPM read from disk, not a literal —
//       therefore FAILS on any of those hardcoded divisors, not merely on a
//       coincidence-free count. The spec ASSERTS the live word count falls inside
//       the proven-unique window [412, 1199] (so the discriminator can never
//       silently degenerate to a count where ceil collides with a default), then
//       asserts the displayed reading time EQUALS the unique ceil(words/137). The
//       same buffer provisioned against a DIFFERENT reading_wpm would show a
//       DIFFERENT reading time, which is exactly the "different config → different
//       result" the obligation names.
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
//     would NOT equal ceil(words/137) for the provisioned distinctive 137. Because
//     the buffer is grown into the proven-unique window [412, 1199], ceil(words/137)
//     differs from ceil(words/100), ceil(words/200), ceil(words/250), AND
//     ceil(words/300) — so a hardcoded divisor of ANY of the common defaults yields
//     a DIFFERENT minute and clause (1)/(3) fails (not just a count where the ceils
//     happen to coincide).
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
  // below is the MISSING reading-time metric, never a boot/open error).
  const baseWords = await shownWordCount(tauriPage);
  expect(baseWords).not.toBeNull();
  expect(baseWords as number).toBeGreaterThan(0);

  // The config-owned WPM, read INDEPENDENTLY of the app from the on-disk
  // config.toml (python tomllib). The GREEN impl adds [editor].reading_wpm
  // (config.rs Editor, range-validated, round-tripped — the P9 class) and the
  // matching p129 provisioning case writes a DISTINCTIVE, non-round
  // reading_wpm = 137. For 137, EVERY word count in [412, 1199] lands
  // ceil(words/137) in a minute-bucket that is UNIQUE versus ceil(words/100),
  // ceil(words/200), ceil(words/250) and ceil(words/300) (the plausible hardcoded
  // defaults) — verified exhaustively. The buffer is grown below into that window,
  // so the clause-(1) equality is GENUINELY discriminating: any hardcoded divisor
  // yields a different minute and fails it. The same buffer provisioned against a
  // DIFFERENT reading_wpm would change the expected value (the "different config →
  // different result" the obligation names).
  const cfg = parseTomlFile(manifest.configPath);
  const wpm = (cfg.editor as Record<string, unknown> | undefined)?.reading_wpm;
  expect(typeof wpm).toBe('number');
  const readingWpm = wpm as number;
  expect(readingWpm).toBe(137);

  // The proven-unique window for reading_wpm=137: on [412, 1199] ceil(words/137)
  // equals NONE of ceil(words/{100,200,250,300}). Both asserted word counts below
  // MUST fall inside it, or the discriminator would silently degenerate.
  const UNIQUE_LO = 412;
  const UNIQUE_HI = 1199;

  // Grow the buffer through the REAL docChanged pipeline (appendAtEnd) so the live
  // word count lands inside the proven-unique window. demo.md ships small (~54
  // words); appending 420 distinctive words pushes the count to ~474 — well inside
  // [412, 1199], where ceil(474/137)=4 while ceil(474/200)=3, ceil(474/250)=2,
  // ceil(474/300)=2, ceil(474/100)=5. A hardcoded-200 impl would show "3 min", a
  // hardcoded-250/300 impl "2 min", a hardcoded-100 impl "5 min" — only the real
  // config-bound impl shows "4 min".
  const GROW = 420;
  const grow = ' ' + Array.from({ length: GROW }, (_, i) => `gamma${i}`).join(' ');
  await appendAtEnd(tauriPage, grow);

  // Wait for the status cluster's own word count to reflect the growth.
  let words0: number | null = null;
  const growDeadline = Date.now() + 5_000;
  while (Date.now() < growDeadline) {
    words0 = await shownWordCount(tauriPage);
    if (words0 !== null && words0 >= (baseWords as number) + GROW) break;
    await sleep(100);
  }
  expect(words0).not.toBeNull();
  expect(words0 as number).toBeGreaterThanOrEqual((baseWords as number) + GROW);
  // SELF-VERIFYING DISCRIMINATOR GATE: the grown count must sit inside the window
  // where ceil(words/137) is unique vs every common hardcoded divisor. If it does
  // not, the test is NOT discriminating and must fail loudly here rather than pass
  // green on a coincidental count.
  expect(words0 as number).toBeGreaterThanOrEqual(UNIQUE_LO);
  expect(words0 as number).toBeLessThanOrEqual(UNIQUE_HI);

  // ── Clause (1): DERIVED VALUE — the status cluster shows ceil(words / wpm) ──
  // FIRST the metric must EXIST in the status cluster. RED today: StatusBar.svelte
  // renders only `Ln/Col` and `{wordCount} words` — there is NO reading-time
  // sibling span — so readingTimeMinutes() returns null and THIS assertion fails.
  const reading0 = await readingTimeMinutes(tauriPage);
  expect(reading0).not.toBeNull();

  const expected0 = Math.ceil((words0 as number) / readingWpm);
  // Clause (3) folded in AND made discriminating: the displayed value equals
  // ceil(words / configWpm) for the WPM read from disk (137). Because words0 is in
  // the proven-unique window, ceil(words0/137) differs from ceil(words0/100),
  // ceil(words0/200), ceil(words0/250) AND ceil(words0/300) — so a hardcoded
  // divisor of ANY common default FAILS this equality. Guard the discriminator
  // explicitly so a future regression that picks a colliding count cannot pass:
  for (const dead of [100, 200, 250, 300]) {
    expect(expected0).not.toBe(Math.ceil((words0 as number) / dead));
  }
  expect(reading0).toBe(expected0);

  // ── Clause (2): LIVE UPDATE — editing the buffer updates the reading time ──
  // Append enough distinctive words to push the word count over the next
  // ceil(words/137) boundary (into the NEXT unique bucket), so a recomputing
  // metric MUST change its displayed value while a stale one would not. 200 added
  // words ⇒ at least one more minute, still inside the proven-unique window.
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
  // The post-edit count must ALSO stay inside the proven-unique window, so clause
  // (2)'s equality is discriminating too.
  expect(words1 as number).toBeGreaterThanOrEqual(UNIQUE_LO);
  expect(words1 as number).toBeLessThanOrEqual(UNIQUE_HI);
  const expected1 = Math.ceil((words1 as number) / readingWpm);
  // The added words crossed a minute boundary, so the expected reading time
  // genuinely changed — a stale metric (still showing expected0) fails here.
  expect(expected1).toBeGreaterThan(expected0);
  // Discriminating at the new count too: ceil(words1/137) differs from every
  // common hardcoded divisor.
  for (const dead of [100, 200, 250, 300]) {
    expect(expected1).not.toBe(Math.ceil((words1 as number) / dead));
  }

  const reading1 = await readingTimeMinutes(tauriPage);
  expect(reading1).not.toBeNull();
  expect(reading1).toBe(expected1);

  recordObservation({ spec: manifest.spec, name: 'reading-wpm', value: readingWpm });
  recordObservation({ spec: manifest.spec, name: 'words-base', value: baseWords as number });
  recordObservation({ spec: manifest.spec, name: 'words-before', value: words0 as number });
  recordObservation({ spec: manifest.spec, name: 'reading-minutes-before', value: expected0 });
  recordObservation({ spec: manifest.spec, name: 'words-after', value: words1 as number });
  recordObservation({ spec: manifest.spec, name: 'reading-minutes-after', value: expected1 });
});
