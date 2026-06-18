// Project-wide label/anchor harvesting → a composable CM6 label-completion
// source (P87/C3), the independent sibling of citations.ts's
// citationCompletionSource and snippets.ts's snippetCompletionSource.
//
// PORTED STRATEGY (vimtex multi-file project-root label indexing): vimtex treats
// a LaTeX document as a PROJECT rooted at a main file and harvests `\label{}`
// definitions across every file reachable from that root, so a cross-reference
// in one file can complete a label defined in ANOTHER. We port the strategy, not
// the vim code: the project root is the directory the file explorer is rooted at
// (App's projectRoot), and the index is built App-side over EVERY markdown file
// under that root — not just the open buffer. This module is the parser + the
// completion source; App owns building the index (on project-open / file-tree
// refresh, NOT per keystroke) and handing the harvested labels to the editor.
//
// An anchor is any of the THREE label kinds this research workflow defines:
//   - a pandoc `{#id}` heading attribute   (e.g. `# Section {#sec:intro}`)
//   - a `:::{#id}` fenced-div id            (e.g. `::: {#thm:main .theorem}`)
//   - a LaTeX `\label{id}`                  (e.g. `\label{lem:xyz-cross}`)
//
// The source fires in a cross-REFERENCE context — inside a `\ref{`/`\cref{`/
// `\Cref{`/`\eqref{` command's argument, where the cursor names a label TARGET —
// and offers every harvested label whose key the typed query is a prefix of.
// Accepting a candidate inserts a REFERENCE to that label: the label key is
// written at the cursor, completing the `\cref{<key>` the user is typing.

import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";

/** One harvested anchor: the label KEY a cross-reference targets, and the path
 *  of the project file it was defined in (so a candidate can show WHICH file
 *  carries the definition — the cross-file provenance P87 proves). */
export interface LabelDef {
  readonly key: string;
  readonly file: string;
}

/** One project markdown file's path and content, as read off disk. The App-side
 *  index builder reads each file under the project root (via readTextFile) and
 *  hands the pairs here; a read failure upstream is a hard error, never a
 *  silently-skipped file (so the harvest is over the WHOLE project). */
export interface ProjectFile {
  readonly path: string;
  readonly content: string;
}

// A pandoc attribute brace block `{...}`: the `{ }`-delimited attribute list a
// heading attribute (`# H {#id}`) or a fenced-div opener (`::: {#id .cls}`) carry.
// Brace contents are the pandoc attribute set — classes (`.cls`), the id (`#id`),
// and key=val pairs — in any order. Global so a line with several blocks yields
// each. Matched FIRST so the id is only harvested from WITHIN an attribute brace,
// never from a bare `#id` in a markdown link fragment `](#frag)` or prose `#word`.
const ATTR_BRACE = /\{([^{}]*)\}/g;
// The `#id` token inside an attribute brace's contents. The id is the pandoc
// identifier character set (letters, digits, and `-_:.`), the SAME set a
// cross-reference key uses. A brace may carry classes/keys before or after the id,
// so the `#` is found anywhere within the (already brace-scoped) contents.
const ATTR_ID = /#([A-Za-z][\w:.-]*)/;
// A LaTeX `\label{id}` definition. The id is the same identifier character set.
const LABEL_CMD = /\\label\{([^}]+)\}/g;

/** Harvest every anchor definition from one file's content: pandoc `{#id}`
 *  heading attributes, `:::{#id}` fenced-div ids, and `\label{id}` commands.
 *  Both attribute-id forms are an `#id` token inside an attribute brace `{...}`,
 *  so we scan brace blocks and extract the id from WITHIN each — a bare `#id` in
 *  a markdown link fragment `](#frag)` or in prose is NOT inside an attribute
 *  brace and is therefore never harvested. Returns the bare label keys (no
 *  leading `#`, no `{}`/`\label{}` wrapper). */
export function harvestFileLabels(content: string): string[] {
  const keys: string[] = [];
  for (const brace of content.matchAll(ATTR_BRACE)) {
    const id = ATTR_ID.exec(brace[1]);
    if (id) {
      keys.push(id[1]);
    }
  }
  for (const m of content.matchAll(LABEL_CMD)) {
    keys.push(m[1]);
  }
  return keys;
}

/** Build the project-wide label index from every project markdown file's content
 *  (the ported vimtex project-root harvest). Each file contributes its harvested
 *  anchor keys, tagged with the file they came from, so the resulting index spans
 *  the WHOLE project — a label defined in file A is in the index while editing
 *  file B. Duplicate keys across files are NOT collapsed: each definition site is
 *  retained so the source can offer the provenance. */
export function buildLabelIndex(files: ProjectFile[]): LabelDef[] {
  const defs: LabelDef[] = [];
  for (const file of files) {
    for (const key of harvestFileLabels(file.content)) {
      defs.push({ key, file: file.path });
    }
  }
  return defs;
}

/** The cross-reference command argument before the cursor: a `\ref`/`\cref`/
 *  `\Cref`/`\eqref` (the cleveref/amsmath reference commands this workflow uses),
 *  its opening `{`, and an optional partial label key typed after it. The key is
 *  the pandoc identifier character set. The capture is the typed query the offered
 *  labels are filtered against. */
const REF_TRIGGER = /\\(?:c|C|eq)?ref\{([\w:.-]*)$/;

/** Render the info tooltip for a label candidate: the project file the label is
 *  defined in — the cross-file provenance the user verifies before referencing.
 *  Returned as a DOM node CM6 renders into the `.cm-completionInfo` pane. */
function renderInfo(def: LabelDef): HTMLElement {
  const root = document.createElement("div");
  root.className = "cm-label-info";
  root.textContent = def.file;
  return root;
}

/** Build the {@link Completion} for one label: its label IS the bare key (so the
 *  rendered option carries the key the cross-reference targets and CM6 fuzzy-
 *  matches the typed query against it), its `info` shows the defining file, and
 *  its `apply` writes the bare label key — completing the `\cref{<key>` the user
 *  is typing into a reference to that label. */
function labelOption(def: LabelDef): Completion {
  return {
    label: def.key,
    type: "reference",
    info: () => renderInfo(def),
    apply: def.key,
  };
}

/** A completion source over the project-wide label index: when the text before
 *  the cursor is inside a cross-reference command argument (`\cref{`, `\ref{`,
 *  `\Cref{`, `\eqref{`), it offers every harvested label as a candidate whose
 *  label is its key and whose `apply` writes that key — inserting a reference to
 *  a label that may be defined in ANOTHER project file (P87). The match's `from`
 *  is the position right after the `{`, so accepting REPLACES the typed partial
 *  key with the full label key. Synchronous — the index is built App-side once
 *  per project-open / file-tree refresh and closed over here — so it composes
 *  through EditorPane's delegating source (P51) alongside the LaTeX, snippet, and
 *  citation sources, never as an override. Returns null when the cursor is not in
 *  a reference argument, leaving the other sources to answer. */
export function labelCompletionSource(labels: LabelDef[]): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const token = context.matchBefore(REF_TRIGGER);
    if (!token) return null;
    if (labels.length === 0) return null;
    // The captured query (the partial key typed after `{`) is the tail of the
    // matched span; `from` is the position where that key begins, so CM6 filters
    // the candidate keys against it and accepting replaces only the partial key.
    const query = REF_TRIGGER.exec(token.text);
    const queryLen = query ? query[1].length : 0;
    const from = token.to - queryLen;
    const options = labels.map((def) => labelOption(def));
    return {
      from,
      to: token.to,
      options,
      // Keep the popup open while the cursor stays inside the reference argument
      // (an identifier-character key, no closing brace yet).
      validFor: /^[\w:.-]*$/,
    };
  };
}
