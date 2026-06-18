// Config-owned bibliography → a composable CM6 citation-completion source
// (P85/P86), the sibling of snippets.ts's snippetCompletionSource.
//
// The bibliography is the ONE config-declared file P84/C1 established
// (editor.bibliography, a required ExistingFile). The editor reads it once
// post-mount, parses it with a MAINTAINED BibTeX parser
// (@retorquere/bibtex-parser — the same parser Zotero's Better BibTeX ships,
// which LaTeX-decodes fields so `{Crystalline …}` braces are stripped and
// `author = {Grothendieck, Alexander and …}` splits into name parts), and
// builds one composable completion source over the parsed entries.
//
// The source fires on the `@`-trigger in a citation position — line start,
// immediately after whitespace, or immediately after an opening bracket — the
// pandoc-citation grammar. Each candidate's MATCH STRING is built from the
// entry's bibliographic METADATA (key + author surnames + year + title), so a
// query on a TITLE word surfaces the entry even when its cite key carries none
// of that word (P85). Each candidate carries an `info` tooltip rendering the
// entry's author, year, and title — the fields the user verifies before
// inserting (P86). Accepting a candidate inserts pandoc citation syntax
// `[@<key>]` at the cursor.
//
// A declared-but-unparseable bibliography is a HARD error (the caller surfaces
// it via toastError), never a silently-empty source: the parser reports
// structural failures in `bib.errors`, and a non-empty error set throws here.

import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { parse } from "@retorquere/bibtex-parser";

/** One parsed bibliography entry, reduced to the fields the completion needs:
 *  the cite KEY (what pandoc syntax references) and the three METADATA fields
 *  the match string and the info tooltip are built from (author surnames, year,
 *  title). The parser decodes each field — braces stripped, names split — so
 *  these are display-ready strings, never raw BibTeX. */
export interface CitationEntry {
  readonly key: string;
  /** The author surnames, joined for display (e.g. "Grothendieck, Serre"). */
  readonly authors: string;
  readonly year: string;
  readonly title: string;
}

/** Parse a BibTeX bibliography into {@link CitationEntry} records via the
 *  maintained @retorquere/bibtex-parser. The parser collects structural
 *  failures in `bib.errors` rather than throwing; a NON-EMPTY error set is a
 *  hard failure here (fail loud, never a partial/empty source). Each entry's
 *  author array (`{lastName, firstName}` records) is reduced to its surnames,
 *  and the title/year fields are taken as the parser's decoded strings. An entry
 *  missing the cite key is impossible (the parser keys every entry); an entry
 *  with no author/year/title yields an empty string for that field. */
export function parseBibliography(bibtex: string): CitationEntry[] {
  const bib = parse(bibtex);
  if (bib.errors.length > 0) {
    const detail = bib.errors.map((e) => e.error).join("; ");
    throw new Error(`bibliography failed to parse: ${detail}`);
  }
  return bib.entries.map((entry) => {
    const authorField = entry.fields.author;
    const authors = Array.isArray(authorField)
      ? authorField
          .map((name) => name.lastName ?? name.firstName ?? "")
          .filter((s) => s.length > 0)
          .join(", ")
      : "";
    const title = typeof entry.fields.title === "string" ? entry.fields.title : "";
    const year = typeof entry.fields.year === "string" ? entry.fields.year : "";
    return { key: entry.key, authors, year, title };
  });
}

/** The match string CM6 fuzzy-filters a citation candidate against: the cite
 *  key plus the entry's bibliographic metadata (authors, year, title). Built
 *  from METADATA, not the key alone, so a query on a TITLE word surfaces the
 *  entry even when its key carries none of that word (P85). This IS the
 *  completion's `label`, so the rendered `.cm-completionLabel` carries both the
 *  key (which the candidate references) and the metadata the query matches. */
function matchString(entry: CitationEntry): string {
  return `@${entry.key} — ${entry.authors} (${entry.year}) ${entry.title}`;
}

/** Render the info tooltip for a candidate: the entry's author, year, and title
 *  — the three fields the user verifies before inserting (P86). Returned as a
 *  DOM node CM6 renders into the `.cm-tooltip.cm-completionInfo` pane. */
function renderInfo(entry: CitationEntry): HTMLElement {
  const root = document.createElement("div");
  root.className = "cm-citation-info";

  const authorLine = document.createElement("div");
  authorLine.className = "cm-citation-info-author";
  authorLine.textContent = `${entry.authors} (${entry.year})`;
  root.appendChild(authorLine);

  const titleLine = document.createElement("div");
  titleLine.className = "cm-citation-info-title";
  titleLine.textContent = entry.title;
  root.appendChild(titleLine);

  return root;
}

/** Build the {@link Completion} for one entry: its label is the metadata match
 *  string (so the rendered option carries the key AND fuzzy-matches a title-word
 *  query, P85), its `info` renders the author/year/title preview pane (P86), and
 *  its `apply` replaces the matched `@…` span with pandoc bracketed citation
 *  syntax `[@<key>]` (not the bare key as prose, not a literal label, P85). */
function citationOption(entry: CitationEntry): Completion {
  return {
    label: matchString(entry),
    type: "reference",
    info: () => renderInfo(entry),
    apply: `[@${entry.key}]`,
  };
}

/** The pandoc citation trigger before the cursor: a single `@` optionally
 *  followed by a query that BEGINS with a key character (a letter or digit — a
 *  pandoc cite key never starts with `@`) and continues with the key-character
 *  set. The leading-key-char requirement is load-bearing: it ensures a DOUBLED
 *  `@@…` (e.g. another source's `@@ppe` sentinel) is not swallowed — `matchBefore`
 *  then matches only the trailing `@…`, whose preceding char is the first `@`,
 *  which {@link inTriggerPosition} rejects. A bare `@` (no query yet) also
 *  triggers. */
const CITATION_TRIGGER = /@(?:[\w][\w:.#$%&+?<>~/-]*)?/;

/** Whether the `@` at `at` is in a pandoc CITATION trigger position: at line
 *  start, immediately after whitespace, or immediately after an opening bracket
 *  (`[`). The character examined is the one BEFORE the `@`. An `@` mid-word
 *  (e.g. an email local-part `foo@bar`, or a doubled `@@`) is NOT a citation
 *  trigger. */
function inTriggerPosition(context: CompletionContext, at: number): boolean {
  if (at === 0) return true;
  const before = context.state.doc.sliceString(at - 1, at);
  return /\s/.test(before) || before === "[";
}

/** A completion source over a parsed bibliography: when the text immediately
 *  before the cursor is an `@`-citation trigger (line start / after whitespace /
 *  after `[`) followed by a query, it offers every entry as a candidate whose
 *  label is its metadata match string (so CM6 fuzzy-matches the query against
 *  the metadata, not the key alone) and whose `apply` inserts `[@<key>]`. The
 *  match's `from` is the `@` position so accepting REPLACES the whole `@query`
 *  span with the citation syntax (the typed query does not survive as prose).
 *  Synchronous — the bibliography is parsed once at registration, not per query
 *  — so it composes through EditorPane's synchronous delegating source (P51),
 *  alongside the LaTeX and snippet sources, never as an override. Returns null
 *  when the cursor is not at an `@`-trigger, leaving the other sources to
 *  answer. */
export function citationCompletionSource(
  entries: CitationEntry[],
): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    // The `@` trigger plus the key-character query typed after it. A doubled
    // `@@…` is excluded by the trigger-position check below (matchBefore matches
    // only the trailing `@…`, whose preceding char is the first `@`).
    const token = context.matchBefore(CITATION_TRIGGER);
    if (!token) return null;
    if (!inTriggerPosition(context, token.from)) return null;
    const options = entries.map((entry) => citationOption(entry));
    if (options.length === 0) return null;
    return {
      // `from` at the `@` so CM6 filters the candidate labels against the typed
      // `@query` (the labels lead with `@<key>`, so the `@` aligns and the query
      // matches the metadata in the label). The accepted `apply` replaces the
      // whole `[from, token.to)` span — `@<query>` — with the citation syntax, so
      // the typed query never survives as prose.
      from: token.from,
      to: token.to,
      options,
      // The candidate set does not narrow as more of the query is typed — CM6
      // re-filters the labels itself — so keep the popup open while the query is
      // still an `@…` citation token (anchored: validFor tests the whole span).
      validFor: /^@(?:[\w][\w:.#$%&+?<>~/-]*)?$/,
    };
  };
}
