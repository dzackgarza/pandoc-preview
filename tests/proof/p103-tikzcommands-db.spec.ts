import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  editorText,
  cursorOffset,
  typeInEditor,
  completionLabels,
  tikzCommandNames,
  insertTikzCommandByName,
  reloadTikzCommands,
} from './support/app';

// ── P94 (Phase D / D-5) — declarative tikz-command snippet database ─────────
//
// THE OBLIGATION (proof-obligations.md, exact wording):
//   P94 — a tikz command present ONLY in the config-declared vendored
//   tikz-command DB is surfaced by the insertion bar AND the editor completion,
//   and CHOOSING it inserts its declared insert body with the cursor at the
//   declared offset. The bar palette and the CM6 completion are SEEDED from the
//   DB, not from a hardcoded list. Choosing the command inserts its DECLARED
//   INSERT BODY (the multi-character insert text) at the cursor — NOT the bare
//   command name — and the cursor lands at the command's DECLARED cursor OFFSET.
//   The DB is config-declared and load-validated: pointing config at a DIFFERENT
//   DB surfaces THAT DB's commands instead (the surfaces are DATA-DRIVEN, not
//   hardcoded). A malformed/unreadable DB is a HARD VISIBLE error, never a
//   silently-empty palette. Admissible only if it FAILS on a plausibly broken app
//   (hardcoded/empty palette, literal-name insert, wrong cursor offset, ignored
//   DB, silently-empty palette for a malformed DB).
//
// ── WHY THE APP IS RED TODAY (the implementation fact this proof pins) ───────
// The insertion bar's tikz surface today is P56's BARE SCAFFOLD pair: it offers
// exactly two fixed diagram skeletons — `tikz` (a `tikzpicture`) and `tikzcd`
// (a `\begin{tikzcd}`), via __PPE_E2E__.insertDiagram(kind). There is no
// config-declared tikz-command DB, nothing reads `[editor].tikz_commands`, and
// neither the bar palette nor the CM6 completion is seeded from any such DB. So a
// command that exists ONLY in the configured DB (`dzgTestArrow`) is offered on
// NEITHER surface, and there is no surface that inserts its multi-character
// `insert` body at a declared cursor offset. The hooks this spec drives
// (tikzCommandNames / insertTikzCommandByName / reloadTikzCommands) do not exist
// on __PPE_E2E__, so the first such evaluate throws — the faithful "no DB feeds
// the bar/completion" RED state.
//
// ── THE CONFIG-OWNED CONTRACT (what the implementer must honor) ──────────────
// The DB is the QTikz `tikzcommands.json` model: an array of
//   { name, description, insert, dx, dy, type }
// where `insert` is the multi-character text inserted and `dx`/`dy` is the cursor
// offset AFTER insertion (the QTikz `.json` cursor-placement convention; for a
// single-line `insert`, dy=0 and `dx` is the column/character offset within the
// inserted body — verified against the upstream ktikz tikzcommands.json shape).
// This run provisions the committed fixture DB
// tests/proof/fixtures/tikz-commands/p103-tikzcommands.json:
//
//   [ { "name": "dzgTestArrow",
//       "insert": "\\draw[->] (dzgSRC) to (dzgTGT);",
//       "dx": 18, "dy": 0, "type": 0 } ]
//
// at a known on-disk path in this run's hermetic global tikz-commands dir
// (scripts/provision-proof.sh, the p103 case). The spec does NOT hardcode the
// command set or the insert body/offset: it loads THAT DB file from disk and
// asserts the surfaced commands, the inserted body, and the cursor offset against
// the FILE's values. So a different DB would make the surfaces offer a different
// command set and a different insert/offset — the config-owned property the
// obligation names.
//
// (Exactly as P101/P102 handle the same deny_unknown_fields constraint, the RED
// today does NOT declare an [editor].tikz_commands config key — that would be a
// config-schema BOOT failure, not the missing DB-driven-surface behavior this
// obligation targets — so the DB sits on disk UNCONSUMED and the spec reads it
// from the known provisioned path, not from config.toml. The GREEN wiring adds the
// config-declared, load-validated [editor].tikz_commands key.)
//
// The DISCRIMINATOR DB (p103-tikzcommands-alt.json, command `dzgAltNode` with a
// DIFFERENT insert body) is provisioned alongside; the spec overwrites the active
// configured DB path with it on disk, drives reloadTikzCommands(), and asserts the
// surfaces now offer `dzgAltNode` and NOT `dzgTestArrow` — a baked-in palette that
// ignored the configured DB would keep surfacing the same commands and FAIL.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (A) The bar palette surfaces EXACTLY the configured DB's command names
//       (tikzCommandNames() === the DB file's names, read independently from the
//       app-written config.toml — not hardcoded in the spec).
//       KILLS the HARDCODED/EMPTY palette and the IGNORED DB: an empty palette is
//       [], a hardcoded palette does not track the configured DB, and an ignored
//       DB never reads the config-owned path. (RED today: tikzCommandNames does
//       not exist — the bar offers only P56's two bare scaffolds — so this throws.)
//   (B) The DB-only command is also offered in the CM6 autocomplete completion
//       (typing the command name surfaces `dzgTestArrow` in the tooltip).
//       KILLS a completion source NOT seeded from the DB: the DB-only command can
//       appear in the popup only if the completion is seeded from the DB.
//   (C) Choosing the command inserts its DECLARED INSERT BODY (the multi-char
//       `insert` text) at the cursor — NOT the bare command name.
//       KILLS LITERAL-NAME insertion / a no-op: the bare name `dzgTestArrow` must
//       NOT be in the buffer, and the declared insert body MUST be.
//   (D) The cursor lands at the command's DECLARED offset (insertStart + dx for the
//       single-line body), strictly INSIDE the inserted body.
//       KILLS a "dumb paste" that ignores the declared offset and drops the cursor
//       at the body end (or start).
//   (E) DATA-DRIVEN: pointing config at the DISCRIMINATOR DB on disk + reloading
//       surfaces `dzgAltNode` and NOT `dzgTestArrow`.
//       KILLS a BAKED-IN palette: a hardcoded surface would keep offering
//       `dzgTestArrow` regardless of the configured DB.
//
// Together: both surfaces are DB-seeded (A,B), choosing inserts the declared body
// at the declared offset (C,D), and the surfaces track the configured DB (E).

const FIXTURE_REL = 'home/.pandoc/tikz-commands';
// The ACTIVE DB the surfaces are (to be) seeded from, and the DISCRIMINATOR DB the
// spec swaps onto the active path on disk for the data-driven leg. Both are
// provisioned into this run's hermetic global tikz-commands dir.
const ACTIVE_DB = 'p103-tikzcommands.json';
const ALT_DB = 'p103-tikzcommands-alt.json';

interface TikzCommand {
  name: string;
  description: string;
  insert: string;
  dx: number;
  dy: number;
  type: number;
}

function loadDb(path: string): TikzCommand[] {
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`tikz-command DB at ${path} is not a JSON array`);
  }
  return parsed as TikzCommand[];
}

test('a command present ONLY in the config-declared tikz-command DB is surfaced on the bar AND in completion, and choosing it inserts its declared body at the declared offset', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // The surfaced command set comes from the DB provisioned to this run's hermetic
  // tikz-commands dir — loaded independently of the app, so a hardcoded or ignored
  // palette cannot pass. (The RED today does not declare an [editor].tikz_commands
  // config key — that would be a config-schema boot failure under
  // deny_unknown_fields, masking the missing-surface behavior — so the DB is read
  // from this known provisioned path, the P101/P102 idiom for the same constraint.)
  const dbPath = join(manifest.runDir, FIXTURE_REL, ACTIVE_DB);
  if (!existsSync(dbPath)) {
    throw new Error(`tikz-command DB fixture missing at ${dbPath}`);
  }

  const db = loadDb(dbPath);
  const dbNames = db.map((c) => c.name).sort();
  // The distinctive DB-only command this spec drives. Its name and insert body
  // appear in NO built-in tikz/tikzcd scaffold, so surfacing/inserting it can only
  // come from the configured DB.
  const witness = db.find((c) => c.name === 'dzgTestArrow');
  if (witness === undefined) {
    throw new Error(`fixture DB at ${dbPath} does not declare the dzgTestArrow witness command`);
  }
  // Single-line insert body: dy must be 0 so dx is the character offset within the
  // body (the QTikz cursor-placement convention this spec asserts against).
  expect(witness.dy).toBe(0);
  expect(witness.insert.includes('\n')).toBe(false);
  // The declared offset is strictly inside the body — so a "dumb paste" landing at
  // the body end (or start) is a DIFFERENT offset and assertion (D) discriminates.
  expect(witness.dx).toBeGreaterThan(0);
  expect(witness.dx).toBeLessThan(witness.insert.length);

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // The buffer before the insert: the DB-only command's name and body are NEWLY
  // added by this spec (the demo fixture carries neither), so a later occurrence
  // proves the insert, not a pre-existing token.
  const before = await editorText(tauriPage);
  expect(before).not.toContain(witness.name);
  expect(before).not.toContain(witness.insert);

  // (A) The bar palette surfaces EXACTLY the configured DB's command names. RED
  // today: __PPE_E2E__.tikzCommandNames does not exist — the bar offers only P56's
  // two bare scaffolds, nothing is seeded from a DB — so this evaluate throws.
  const surfaced = (await tikzCommandNames(tauriPage)).slice().sort();
  expect(surfaced).toEqual(dbNames);
  expect(surfaced).toContain(witness.name);

  // (B) The DB-only command is ALSO offered in the CM6 autocomplete completion.
  // Type the command name fragment; the standard tooltip opens and offers the
  // DB-only command. It can appear there ONLY if the completion is seeded from the
  // DB (it is not a LaTeX command, not a built-in scaffold).
  await typeInEditor(tauriPage, witness.name);
  await tauriPage.waitForFunction(
    `!!document.querySelector('.cm-tooltip-autocomplete')`,
    10_000,
  );
  const labels = await completionLabels(tauriPage);
  expect(labels).toContain(witness.name);

  // (C) Choosing the command from the bar inserts its DECLARED INSERT BODY at the
  // cursor — NOT the bare command name. RED today: insertTikzCommandByName does not
  // exist, so this evaluate throws.
  await insertTikzCommandByName(tauriPage, witness.name);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(witness.insert)})`,
    10_000,
  );

  const after = await editorText(tauriPage);
  expect(after).toContain(witness.insert);
  const bodyStart = after.indexOf(witness.insert);
  expect(bodyStart).toBeGreaterThanOrEqual(0);
  // The bare command name must NOT be in the buffer: a literal-name insert would
  // leave `dzgTestArrow` as text. (The insert body itself contains no `dzgTestArrow`
  // substring, so any occurrence is the un-expanded literal name.)
  expect(witness.insert.includes(witness.name)).toBe(false);
  expect(after).not.toContain(witness.name);

  // (D) The cursor lands at the command's DECLARED offset: insertStart + dx (the
  // single-line body's character offset), strictly inside the inserted body —
  // not the body end (a dumb paste) and not the body start.
  const expectedCursor = bodyStart + witness.dx;
  const cursor = await cursorOffset(tauriPage);
  expect(cursor).toBe(expectedCursor);
  expect(cursor).toBeGreaterThan(bodyStart);
  expect(cursor).toBeLessThan(bodyStart + witness.insert.length);

  recordObservation({ spec: manifest.spec, name: 'tikz-db-surfaced', value: surfaced.join(',') });
  recordObservation({ spec: manifest.spec, name: 'tikz-db-cursor-offset', value: cursor });

  // (E) DATA-DRIVEN discriminator: overwrite the ACTIVE configured DB path on disk
  // with the DISCRIMINATOR DB (command `dzgAltNode`, a DIFFERENT command), then
  // reload. The surfaces must now offer `dzgAltNode` and NOT `dzgTestArrow` —
  // proving the bar palette and completion track the CONFIGURED DB, not a baked-in
  // list. A hardcoded palette would keep surfacing `dzgTestArrow` and FAIL here.
  const altPath = join(manifest.runDir, FIXTURE_REL, ALT_DB);
  if (!existsSync(altPath)) {
    throw new Error(`discriminator DB fixture missing at ${altPath}`);
  }
  const altDb = loadDb(altPath);
  const altNames = altDb.map((c) => c.name).sort();
  // Sanity: the discriminator declares a DIFFERENT command than the first DB.
  expect(altNames).not.toContain(witness.name);
  expect(altNames).toContain('dzgAltNode');

  copyFileSync(altPath, dbPath);
  await reloadTikzCommands(tauriPage);
  await tauriPage.waitForFunction(
    `JSON.stringify(window.__PPE_E2E__.tikzCommandNames().slice().sort()) === ${JSON.stringify(JSON.stringify(altNames))}`,
    10_000,
  );

  const surfacedAlt = (await tikzCommandNames(tauriPage)).slice().sort();
  expect(surfacedAlt).toEqual(altNames);
  expect(surfacedAlt).toContain('dzgAltNode');
  expect(surfacedAlt).not.toContain(witness.name);

  recordObservation({ spec: manifest.spec, name: 'tikz-db-discriminator', value: surfacedAlt.join(',') });
});
