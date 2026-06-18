#!/usr/bin/env bash
# Provision one proof spec's hermetic environment from committed fixtures.
# Usage: provision-proof.sh <spec_dir> <spec> <run_id>
#
# Creates: an isolated XDG_CONFIG_HOME with a complete config.toml, and a
# per-run copy of the witness project (demo.md + a real 64x48 PNG). Writes
# manifest.json with the absolute paths the spec will assert against.
#
# The config is the canonical witness config: theme=dark, font_size=14,
# debounce_ms=200 (P2). Math is always MathJax (no config option). P9
# mutates it to font_size=18, theme=light through the real Settings UI.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SPEC_DIR="$1"
SPEC="$2"
RUN_ID="$3"

mkdir -p "$SPEC_DIR"/{home,xdg-config,xdg-cache,xdg-state,xdg-data}
ABS_SPEC_DIR="$(realpath "$SPEC_DIR")"

# The alternative-explorer roots (config [directories]) must EXIST: the config
# loader's ExistingDir type rejects a missing path at load, so every spec's
# hermetic home gets these dirs. install-assets later populates styles with the
# vendored .sty files (when a spec runs it); the empty dir suffices to load.
mkdir -p "$ABS_SPEC_DIR/home/.pandoc/styles" "$ABS_SPEC_DIR/home/.pandoc/figures"

PANDOC_BIN="$(command -v pandoc)"

# ── Shipped export-category plugins (export-plugins-contract.md) ────────
# Export is entirely the pandoc plugin suite: the shipped pandoc-html-export and
# pandoc-pdf-export export-category plugins (vendored alongside pandoc-renderer,
# OSOT), discovered from [plugins].dir and run by id through the generic firewall.
# The app core owns NO export command knowledge — no [export.*] config table
# exists. Each plugin carries its OWN raw pandoc command in its [plugin.<id>]
# config section. Every valid provisioned config installs both plugins and emits
# their config sections (write_valid_config and the canonical witness config both
# call this); their contributed doctor checks then join the battery (d01/d16),
# and discovery surfaces them in the export menu/palette (p66). Args: config_path,
# plugins_dir, pandoc_path.
emit_export_plugins() {
    local out="$1" plugins_dir="$2" pandoc_path="$3"
    install_plugin_fixtures "$plugins_dir" pandoc-html-export pandoc-pdf-export
    cat >> "$out" <<EOF

[plugin.pandoc-html-export]
command = "$pandoc_path --from markdown --to html5 --standalone --embed-resources"

[plugin.pandoc-pdf-export]
command = "$pandoc_path --from markdown --standalone --pdf-engine=lualatex"
EOF
}

# The [directories] table (required schema field): the alternative-explorer roots
# under this spec's hermetic ~/.pandoc. Every valid synthesized config appends it
# (the canonical witness config and write_valid_config both call this); without it
# config-schema fails the ExistingDir/required-field check and the app never boots.
emit_directories() {
    local out="$1"
    cat >> "$out" <<EOF

[directories]
styles = "$ABS_SPEC_DIR/home/.pandoc/styles"
figures = "$ABS_SPEC_DIR/home/.pandoc/figures"
EOF
}

# Generic-plugin fixtures (Milestone A). The plugins dir is a core-config value
# (render-rebuild-plan.md), not a constant: each spec copies the committed
# fixtures into a hermetic plugins dir and wires [plugins].dir below.
PLUGINS_SRC="$REPO_ROOT/tests/proof/fixtures/plugins"
# The shipped pandoc renderer is NOT a test fixture: it is vendored app-owned
# code (the single source of truth scripts/first-run.sh installs for real). Specs
# that synthesize a config directly (rather than running first-run.sh) copy it
# from the SAME vendor source, so there is exactly one pandoc-renderer.
VENDOR_PLUGINS="$REPO_ROOT/src-tauri/resources/vendor/plugins"
# install_plugin_fixtures <dest-dir> <plugin-id>...  — copy the named plugin into a
# hermetic plugins dir. Test-only plugins (witness-tool, ratio-tool,
# generic-renderer) come from the committed fixtures; the shipped pandoc renderer
# and the shipped pandoc-html-export / pandoc-pdf-export plugins come from the
# vendor dir (OSOT). A
# plugin is discovered only if a valid
# [plugin.<id>] config section is also provided (its schema may require keys), so
# each spec installs exactly the plugins it configures.
install_plugin_fixtures() {
    local dest="$1"
    shift
    mkdir -p "$dest"
    local id src
    for id in "$@"; do
        if [ "$id" = "pandoc-renderer" ] || [ "$id" = "pandoc-html-export" ] || [ "$id" = "pandoc-pdf-export" ] || [ "$id" = "pandoc-md-lint" ]; then
            src="$VENDOR_PLUGINS/$id"
        else
            src="$PLUGINS_SRC/$id"
        fi
        cp -r "$src" "$dest/"
    done
}

# Default renderer setup (Milestone B): install the shipped pandoc renderer plugin
# and append [plugins]/[renderer]/[plugin.pandoc-renderer]. The app core is
# renderer-agnostic; the preview is rendered by this plugin (the old core pandoc
# argv now lives in pandoc-renderer/render.sh). Milestone C: the plugin's config is
# the raw pandoc command STRING (canonical), not structured path/from_format/args.
emit_pandoc_renderer() {
    local config_path="$1" plugins_dir="$2" pandoc_path="$3"
    install_plugin_fixtures "$plugins_dir" pandoc-renderer
    # Milestone D: install the shipped filters into this spec's hermetic home and
    # reference them by absolute path in the canonical command. install-assets
    # symlinks the vendored filters (incl. utilities.lua) into $HOME/.pandoc/filters.
    env HOME="$ABS_SPEC_DIR/home" bash "$REPO_ROOT/scripts/install-assets.sh" > /dev/null
    local fdir="$ABS_SPEC_DIR/home/.pandoc/filters"
    local tpl="$ABS_SPEC_DIR/home/.pandoc/templates/pandoc_preview_template.html"
    # The bibliography citeproc resolves against. install-assets just symlinked the
    # vendored starter here; replace that symlink with the fixture, which carries
    # the keys the citation proof (p27) cites. --remove-destination replaces the
    # symlink instead of writing through it into the vendored starter. P84/C1: the
    # bibliography + csl paths are NOT in the command below — they are the
    # config-declared source (editor.bibliography / editor.csl, written into the
    # [editor] block by the caller) the renderer layers on as render context.
    local bib="$ABS_SPEC_DIR/home/.pandoc/bib/references.bib"
    cp --remove-destination "$REPO_ROOT/tests/proof/fixtures/references.bib" "$bib"
    cat >> "$config_path" <<EOF

[plugins]
dir = "$plugins_dir"

[renderer]
active = "pandoc-renderer"

[plugin.pandoc-renderer]
command = "$pandoc_path --from markdown+lists_without_preceding_blankline --to html5 --standalone --embed-resources --citeproc --metadata=link-citations:true --metadata=reference-section-title:References --template=$tpl --lua-filter=$fdir/convert_amsthm_envs.lua --lua-filter=$fdir/obsidian_callouts.lua --lua-filter=$fdir/obsidian.lua --lua-filter=$fdir/tikzcd.lua"

[plugin.pandoc-renderer.style]
figure_width = "75%"
EOF
    # The shipped lint plugin (Phase A / P70): static math/delimiter balance lint
    # for the markdown buffer, run by id through the generic firewall. Installed
    # alongside the renderer into the SAME plugins dir and given its own raw md->tex
    # pandoc command (the binary + --from reader the tool lifts from it). The app
    # core owns no lint knowledge — this plugin is the sole source of diagnostics.
    install_plugin_fixtures "$plugins_dir" pandoc-md-lint
    cat >> "$config_path" <<EOF

[plugin.pandoc-md-lint]
command = "$pandoc_path --from markdown+lists_without_preceding_blankline --to latex"
operator_as_variable = true
script_grouping = true
lint_rules = []
EOF
}

# ── Doctor (D-series) provisioning ─────────────────────────────────────
# The D-series asserts on the doctor battery at the process/launcher level,
# not the webview. Each D-spec needs a purpose-built (often broken) config —
# broken environments are the doctor's product surface — and no witness
# project. Provisioning writes the doctor-shaped config, then a lean manifest.
case "$SPEC" in
d[0-9][0-9]-*.spec.ts)
    CONFIG_DIR="$ABS_SPEC_DIR/xdg-config/pandoc-preview"
    CONFIG_PATH="$CONFIG_DIR/config.toml"
    PLUGINS_DIR="$ABS_SPEC_DIR/plugins"

    write_valid_config() {
        local pandoc_path="$1"
        mkdir -p "$CONFIG_DIR"
        cat > "$CONFIG_PATH" <<EOF
[general]
theme = "dark"

[editor]
font_size = 14
line_wrapping = false
line_numbers = true
bibliography = "$ABS_SPEC_DIR/home/.pandoc/bib/references.bib"
csl = "$ABS_SPEC_DIR/home/.pandoc/csl/alpha-preview.csl"

[preview]
debounce_ms = 200
EOF
        emit_directories "$CONFIG_PATH"
        # The pandoc renderer is the active renderer (its checks are the doctor's
        # pandoc-executable/pandoc-invocation rows; D1/D5 assert on them); it also
        # sets [plugins].dir = $PLUGINS_DIR, the dir the export plugins install into.
        emit_pandoc_renderer "$CONFIG_PATH" "$PLUGINS_DIR" "$pandoc_path"
        # Export is the pandoc plugin suite: install both export-category plugins
        # into the SAME plugins dir and emit their config sections. Their
        # contributed doctor checks join the battery (d01/d16).
        emit_export_plugins "$CONFIG_PATH" "$PLUGINS_DIR" "$pandoc_path"
    }

    # The exact observed stale key regression (schema removed 'math').
    write_stale_key_config() {
        mkdir -p "$CONFIG_DIR"
        cat > "$CONFIG_PATH" <<EOF
[general]
theme = "dark"
math = "mathjax"

[editor]
font_size = 14
line_wrapping = false
line_numbers = true

[preview]
debounce_ms = 200

[pandoc]
path = "$PANDOC_BIN"
from_format = "markdown"
extra_args = []
EOF
    }

    case "$SPEC" in
    d01-* | d16-*) # valid env: every check OK, including the contributed doctor
        # checks of the two shipped export-category plugins that write_valid_config
        # installs (html-export-*, pdf-export-*; export-plugins-contract.md, D1).
        # Export is the pandoc plugin suite — there is no app-core export check. d16
        # reuses the same valid env but is launched with PANDOC_RESOURCE_PATH unset
        # (spawnDoctor resourcePath:null), so the ONLY failing check is the
        # pandoc-resource-path startup check.
        write_valid_config "$PANDOC_BIN"
        ;;
    d02-*) # no config: leave the config dir absent. The spec drives the launcher,
        # which routes into the real first-run.sh; first-run.sh itself creates the
        # plugins dir and installs the shipped renderer (it is NOT injected here —
        # that injection used to mask the bug d14 now guards).
        ;;
    d03-*) # config carrying the exact observed stale key; recovers via the real
        # first-run.sh (which installs the renderer itself — no injection here).
        write_stale_key_config
        ;;
    d04-*) # invalid config: stale key -> config-schema fails the startup gate
        # (bare binary; no recovery, no boot, so no renderer needed).
        write_stale_key_config
        ;;
    d06-*) # existing stale/invalid config: `just setup` must reconfigure it via the
        # real first-run.sh (which installs the renderer itself — no injection here).
        write_stale_key_config
        ;;
    d07-*) # existing config-class-invalid config: `just dev` must recover it via the
        # real first-run.sh (which installs the renderer itself — no injection here).
        write_stale_key_config
        ;;
    d05-*) # valid config, but pandoc.path -> a real NON-executable file
        NONEXEC="$ABS_SPEC_DIR/not-pandoc"
        printf '#!/bin/sh\necho nope\n' > "$NONEXEC"
        chmod 0644 "$NONEXEC" # readable, NOT executable
        write_valid_config "$NONEXEC"
        ;;
    d08-*) # A2: generic plugin-config schema validation. Valid core config plus
        # two discovered fixture plugins with DIFFERENT schemas — witness-tool's
        # section conforms, ratio-tool's `ratio = 5` violates its schema (max 1).
        # The witness-tool.marker is created so witness-tool's own checks all pass
        # and the ONLY failing check is plugin-config:ratio-tool.
        write_valid_config "$PANDOC_BIN"
        install_plugin_fixtures "$PLUGINS_DIR" witness-tool ratio-tool
        touch "$CONFIG_DIR/witness-tool.marker"
        cat >> "$CONFIG_PATH" <<EOF

[plugin.witness-tool]
greeting = "hi"

[plugin.ratio-tool]
ratio = 5
EOF
        ;;
    d09-*) # A3: plugin-contributed doctor checks join the battery. Valid core
        # config plus the witness-tool fixture; both plugin sections conform.
        # The witness-tool.marker file is deliberately NOT created, so the
        # contributed witness-tool-marker check FAILs on its real condition while
        # witness-tool-runnable passes.
        write_valid_config "$PANDOC_BIN"
        install_plugin_fixtures "$PLUGINS_DIR" witness-tool ratio-tool
        cat >> "$CONFIG_PATH" <<EOF

[plugin.witness-tool]
greeting = "hi"

[plugin.ratio-tool]
ratio = 0.5
EOF
        ;;
    d11-*) # C4/D3: required-filter check. Valid env (write_valid_config installs the
        # filters via emit_pandoc_renderer), then remove a required filter that is
        # NOT command-referenced (tikzcd, deferred to F) so required-filter is the
        # SOLE failing check — the command still runs, only the required set is short.
        write_valid_config "$PANDOC_BIN"
        rm -f "$ABS_SPEC_DIR/home/.pandoc/filters/tikzcd.lua"
        ;;
    d13-*) # C3: the gum configurator must LOCK the required filters in. Start from a
        # valid env whose command LACKS the required filters; the wizard re-adds them.
        mkdir -p "$CONFIG_DIR"
        cat > "$CONFIG_PATH" <<EOF
[general]
theme = "dark"

[editor]
font_size = 14
line_wrapping = false
line_numbers = true
bibliography = "$ABS_SPEC_DIR/home/.pandoc/bib/references.bib"
csl = "$ABS_SPEC_DIR/home/.pandoc/csl/alpha-preview.csl"

[preview]
debounce_ms = 200
EOF
        emit_directories "$CONFIG_PATH"
        install_plugin_fixtures "$PLUGINS_DIR" pandoc-renderer
        env HOME="$ABS_SPEC_DIR/home" bash "$REPO_ROOT/scripts/install-assets.sh" > /dev/null
        cat >> "$CONFIG_PATH" <<EOF

[plugins]
dir = "$PLUGINS_DIR"

[renderer]
active = "pandoc-renderer"

[plugin.pandoc-renderer]
command = "$PANDOC_BIN --from markdown --to html5 --standalone --embed-resources"

[plugin.pandoc-renderer.style]
figure_width = "75%"
EOF
        # Export is the pandoc plugin suite: install both export plugins into the
        # same plugins dir and emit their config sections.
        emit_export_plugins "$CONFIG_PATH" "$PLUGINS_DIR" "$PANDOC_BIN"
        ;;
    d14-*) # The REAL first-run.sh output must pass the doctor on its own. Drive
        # the real script through a PTY (no canonical config written here) and
        # deliberately inject NOTHING afterward: unlike d02/d03/d06/d07/p10, we do
        # NOT install_plugin_fixtures. What the doctor sees is exactly what
        # first-run.sh produced — including whether it created the plugins dir and
        # installed the shipped renderer the config points at.
        "$REPO_ROOT/scripts/drive-first-run.py" \
            "$REPO_ROOT/scripts/first-run.sh" \
            "$ABS_SPEC_DIR/xdg-config" \
            "$ABS_SPEC_DIR/home"
        if [ ! -f "$CONFIG_PATH" ]; then
            echo "FATAL: first-run.sh did not write $CONFIG_PATH" >&2
            exit 1
        fi
        ;;
    d15-*) # Valid config (every config-class + export check passes) whose
        # [plugins].dir points at a directory that does NOT exist -> the ONLY
        # failing doctor check is `plugins`. This is the state the pre-fix
        # first-run.sh left behind. `just dev` must route it into reconfiguration
        # (which now creates the dir + installs the renderer), not dead-end as an
        # unrecoverable "non-config" failure. We install NO plugin here.
        mkdir -p "$CONFIG_DIR"
        cat > "$CONFIG_PATH" <<EOF
[general]
theme = "dark"

[editor]
font_size = 14
line_wrapping = false
line_numbers = true
bibliography = "$ABS_SPEC_DIR/home/.pandoc/bib/references.bib"
csl = "$ABS_SPEC_DIR/home/.pandoc/csl/alpha-preview.csl"

[preview]
debounce_ms = 200
EOF
        emit_directories "$CONFIG_PATH"
        # The filters/template must be installed so the command first-run.sh writes
        # during recovery is runnable (every recovery spec does this).
        env HOME="$ABS_SPEC_DIR/home" bash "$REPO_ROOT/scripts/install-assets.sh" > /dev/null
        cat >> "$CONFIG_PATH" <<EOF

[plugins]
dir = "$CONFIG_DIR/plugins"

[renderer]
active = "pandoc-renderer"

[plugin.pandoc-renderer]
command = "$PANDOC_BIN --from markdown --to html5 --standalone --embed-resources"

[plugin.pandoc-renderer.style]
figure_width = "75%"
EOF
        ;;
    esac

    jq -n \
        --arg runId "$RUN_ID" \
        --arg spec "$SPEC" \
        --arg runDir "$ABS_SPEC_DIR" \
        --arg xdgConfigHome "$ABS_SPEC_DIR/xdg-config" \
        --arg configPath "$CONFIG_PATH" \
        '{runId: $runId, spec: $spec, runDir: $runDir,
          xdgConfigHome: $xdgConfigHome, configPath: $configPath}' \
        > "$SPEC_DIR/manifest.json"

    echo "provisioned $SPEC (doctor) at $ABS_SPEC_DIR"
    exit 0
    ;;
esac

# ── Hermetic project copy (independent per spec, mutable by P6) ────────
PROJECT_DIR="$ABS_SPEC_DIR/project"
cp -r "$REPO_ROOT/tests/proof/fixtures/project" "$PROJECT_DIR"
DEMO_FILE="$PROJECT_DIR/demo.md"
if [ ! -f "$DEMO_FILE" ]; then
    echo "FATAL: witness demo.md missing at $DEMO_FILE" >&2
    exit 1
fi

# ── config.toml under the hermetic XDG_CONFIG_HOME ─────────────────────
CONFIG_DIR="$ABS_SPEC_DIR/xdg-config/pandoc-preview"
CONFIG_PATH="$CONFIG_DIR/config.toml"
mkdir -p "$CONFIG_DIR"

PLUGINS_DIR="$ABS_SPEC_DIR/plugins"
if [ "$SPEC" = "p10-first-run-bootable.spec.ts" ]; then
    # P10 boots from a config produced by the REAL first-run.sh, driven through a
    # real PTY answering the gum prompts. No canonical config is written here; the
    # script must produce it — INCLUDING the plugins dir and the shipped renderer it
    # installs there. Nothing is injected afterward (the old injection masked the
    # bug d14 now guards): the booted app's renderer-agnostic core delegates the
    # preview to whatever first-run.sh genuinely left behind.
    "$REPO_ROOT/scripts/drive-first-run.py" \
        "$REPO_ROOT/scripts/first-run.sh" \
        "$ABS_SPEC_DIR/xdg-config" \
        "$ABS_SPEC_DIR/home"
    if [ ! -f "$CONFIG_PATH" ]; then
        echo "FATAL: first-run.sh did not write $CONFIG_PATH" >&2
        exit 1
    fi
else
    # ── User snippet dictionary (P52) ──────────────────────────────────
    # P52 declares the snippet dictionary by a CONFIG-OWNED path, not a hardcoded
    # list. Provision a hermetic copy of the committed FIXTURE dict (the spec owns
    # it) and emit an extra `[editor].snippet_dictionary` line pointing config at
    # it, so the snippets the editor offers are exactly this dict's — a different
    # dict would offer different snippets. The dict carries one entry,
    # mthm -> "::: {.theorem}\n$0\n:::" (a CM6 $0-tabstop snippet body). For every
    # other spec this stays empty, so the canonical [editor] block is byte-for-byte
    # what it was before.
    EDITOR_EXTRA=""
    case "$SPEC" in
    p52-snippet-dictionary.spec.ts | p59-snippet-dropdown.spec.ts | p63-insertion-bar-controls.spec.ts)
        # P52 (autocomplete-popup path) and P59 (insertion-bar dropdown path) both
        # declare the snippet dictionary by a CONFIG-OWNED path. They share the
        # SAME committed fixture dict (tests/proof/fixtures/snippets/p52-snippets.json,
        # mthm -> "::: {.theorem}\n$0\n:::"): pointing config at it makes those the
        # snippets surfaced, so a different dict would surface different triggers —
        # the config-owned property both obligations name. P59 reads this same
        # config-declared path back to prove the bar's dropdown triggers come from
        # the dict (not a hardcoded list), so the fixture is the single source of
        # truth for both specs. P63 reuses the same dict to drive the bar's snippet
        # <select> through a REAL DOM selectOption (coverage-hardening of the same
        # dropdown P59 proves via the hook).
        SNIPPETS_DIR="$ABS_SPEC_DIR/home/.pandoc/snippets"
        mkdir -p "$SNIPPETS_DIR"
        SNIPPET_DICT="$SNIPPETS_DIR/p52-snippets.json"
        cp "$REPO_ROOT/tests/proof/fixtures/snippets/p52-snippets.json" "$SNIPPET_DICT"
        EDITOR_EXTRA="snippet_dictionary = \"$SNIPPET_DICT\""
        ;;
    p77-math-mode-snippet.spec.ts)
        # P77 (math-mode-only expansion, the Phase-B keystone) declares the SAME
        # config-owned snippet-dictionary path P52/P59 read, but the dictionary is
        # MODE-TAGGED: its entries carry a per-entry prose|math mode (B-DESIGN-0),
        # a shape the flat trigger->string dict cannot express. The committed
        # fixture (tests/proof/fixtures/snippets/p77-math-mode-snippets.json) maps
        # the SAME short trigger `st` to a PROSE body and a MATH body, plus a
        # MATH-ONLY trigger `mcal`. Pointing config at it makes those the snippets
        # the editor offers, gated by the cursor's math/prose zone. RED today: the
        # flat parser (parseSnippetDictionary) rejects the object-valued entries
        # (non-string body) → hard toast → no snippet source loads → the trigger
        # is offered in NEITHER zone, which is the faithful schema-cannot-carry-mode
        # failure P77 names.
        SNIPPETS_DIR="$ABS_SPEC_DIR/home/.pandoc/snippets"
        mkdir -p "$SNIPPETS_DIR"
        SNIPPET_DICT="$SNIPPETS_DIR/p77-math-mode-snippets.json"
        cp "$REPO_ROOT/tests/proof/fixtures/snippets/p77-math-mode-snippets.json" "$SNIPPET_DICT"
        EDITOR_EXTRA="snippet_dictionary = \"$SNIPPET_DICT\""
        ;;
    p78-autotrigger.spec.ts)
        # P78 (autotrigger space-expansion + re-arm, Phase-B B2) declares the SAME
        # config-owned snippet-dictionary path P52/P59/P77 read, but its entries
        # carry a per-entry `auto: true` flag (B-DESIGN-0): an AUTOTRIGGER expands
        # the moment the user types the trigger followed by a space — IN PLACE,
        # with NO completion popup and NO accept keypress (LuaSnip autosnippet /
        # UltiSnips A). The committed fixture
        # (tests/proof/fixtures/snippets/p78-autotrigger-snippets.json) declares two
        # autotrigger entries — `tii` -> "\\tilde{$0}" and `hii` -> "\\hat{$0}" —
        # so the spec can prove the engine RE-ARMS (a second autotrigger + space
        # fires immediately after the first). Pointing config at it makes those the
        # autotriggers the editor honors. RED today: there is no autotrigger input
        # handler at all (no __PPE_E2E__.typeAutotrigger, no on-space expansion), so
        # the literal trigger + space stays inert in the buffer — the no-op /
        # popup-only failure P78 names.
        SNIPPETS_DIR="$ABS_SPEC_DIR/home/.pandoc/snippets"
        mkdir -p "$SNIPPETS_DIR"
        SNIPPET_DICT="$SNIPPETS_DIR/p78-autotrigger-snippets.json"
        cp "$REPO_ROOT/tests/proof/fixtures/snippets/p78-autotrigger-snippets.json" "$SNIPPET_DICT"
        EDITOR_EXTRA="snippet_dictionary = \"$SNIPPET_DICT\""
        ;;
    p79-regex-trigger.spec.ts)
        # P79 (regex/postfix capture triggers, Phase-B B3) declares the SAME
        # config-owned snippet-dictionary path P52/P59/P77/P78 read, but its entry
        # carries a per-entry `regex: true` flag (B-DESIGN-0; the LuaSnip regTrig /
        # UltiSnips `r` capture-group model). A regex entry matches its PATTERN
        # against the text before the cursor and substitutes the capture groups into
        # the body: capture `$1` (distinct from the TextMate tabstop `${1}`) is
        # replaced by the matched group BEFORE the residual body is expanded through
        # the shared CM6 snippet path. The committed fixture
        # (tests/proof/fixtures/snippets/p79-regex-trigger-snippets.json) declares
        # ONE regex entry — `([a-z])bar` -> "\\bar{$1}" — so the spec can prove that
        # typing `pbar` and triggering expansion yields `\bar{p}` (the captured `p`
        # substituted), with the matched trigger text gone. Pointing config at it
        # makes that the regex trigger the editor honors. RED today: there is no
        # regex-trigger path at all (no __PPE_E2E__.typeRegexTrigger, no regex match,
        # no capture substitution), so the literal `pbar` stays inert in the buffer —
        # the literal-trigger / capture-blind / no-op failure P79 names.
        SNIPPETS_DIR="$ABS_SPEC_DIR/home/.pandoc/snippets"
        mkdir -p "$SNIPPETS_DIR"
        SNIPPET_DICT="$SNIPPETS_DIR/p79-regex-trigger-snippets.json"
        cp "$REPO_ROOT/tests/proof/fixtures/snippets/p79-regex-trigger-snippets.json" "$SNIPPET_DICT"
        EDITOR_EXTRA="snippet_dictionary = \"$SNIPPET_DICT\""
        ;;
    p80-mirrored-tabstops.spec.ts)
        # P80 (mirrored tabstops, Phase-B B4) declares the SAME config-owned
        # snippet-dictionary path P52/P59/P77/P78/P79 read. B4 OWNS no mirror
        # engine: CM6's `snippetCompletion` ALREADY mirrors repeated `${N}`
        # tabstops natively (the established TextMate mirror behaviour). This case
        # PROVES that vendored behaviour and that the authoring/schema path EMITS
        # repeated tabstop numbers for the env-name -> closing-fence case. The
        # committed fixture (tests/proof/fixtures/snippets/p80-mirrored-tabstops-
        # snippets.json) declares ONE entry whose body repeats the `$1` tabstop in
        # two positions — `\begin{$1}\n$0\n\end{$1}` (the env name mirrored into
        # its `\end`). normalizeTabstops converts each bare `$1` to the `${1}` form
        # the CM6 snippet parser mirrors. Pointing config at it makes that mirrored
        # entry the one the editor offers, so typing the env name into the FIRST
        # `${1}` slot makes the SAME text appear at the mirrored `\end{...}` live,
        # without a second keystroke there. RED today: there is no surface to type
        # into an active snippet field (no __PPE_E2E__.typeIntoSnippetField), so
        # the mirror cannot be driven; and the prior converter dropped `<++>`
        # secondary tabstops, so the shipped dict carries no mirrored entry — the
        # single-tabstop / no-mirror failure P80 names.
        SNIPPETS_DIR="$ABS_SPEC_DIR/home/.pandoc/snippets"
        mkdir -p "$SNIPPETS_DIR"
        SNIPPET_DICT="$SNIPPETS_DIR/p80-mirrored-tabstops-snippets.json"
        cp "$REPO_ROOT/tests/proof/fixtures/snippets/p80-mirrored-tabstops-snippets.json" "$SNIPPET_DICT"
        EDITOR_EXTRA="snippet_dictionary = \"$SNIPPET_DICT\""
        ;;
    p81-quicktex-native.spec.ts)
        # P81 (native quicktex format consumed directly, Phase-B B5) declares the
        # SAME config-owned snippet-dictionary path P52/P59/P77/P78/P79/P80 read,
        # but points it at the user's REAL two-map quicktex SOURCE — a vimscript
        # file declaring g:quicktex_prose + g:quicktex_math dict literals — NOT a
        # bespoke flattened JSON. The committed fixture
        # (tests/proof/fixtures/snippets/p81-quicktex-dict.vim) is a BYTE-IDENTICAL
        # copy of the user's real dict in dzackgarza/dotfiles
        # (.config-sync/nvim/after/ftplugin/pandoc/quicktex_dict.vim, sha256
        # 8fdecd88…): the prose map maps `st` -> "such that " and the math map maps
        # the SAME `st` -> "\st " and `frac` -> "\frac{<+++>}{<++>} <++>" (a
        # multi-tabstop entry carrying a `<+++>` primary AND `<++>` secondaries).
        # Pointing config at the SOURCE file makes the editor's snippets exactly
        # those two maps' entries, gated per-zone by the prose/math split the source
        # itself carries.
        #
        # RED today: the loader (snippets.ts::parseSnippetDictionary) is a JSON
        # parser; JSON.parse on the vimscript source throws (Bad control character)
        # -> hard toast -> NO snippet source registers -> `st`/`frac` are offered in
        # NEITHER zone. That is the faithful "no native-vim loader; current path is
        # flat json" RED state. (Even the shipped flattened quicktex.json, were it
        # pointed at here, would offer the SAME math body for `st` in BOTH zones —
        # math wins the collision — and `frac` with its `<++>` secondaries DELETED,
        # the exact flattening losses P81 KILLS.)
        SNIPPETS_DIR="$ABS_SPEC_DIR/home/.pandoc/snippets"
        mkdir -p "$SNIPPETS_DIR"
        SNIPPET_DICT="$SNIPPETS_DIR/p81-quicktex-dict.vim"
        cp "$REPO_ROOT/tests/proof/fixtures/snippets/p81-quicktex-dict.vim" "$SNIPPET_DICT"
        EDITOR_EXTRA="snippet_dictionary = \"$SNIPPET_DICT\""
        ;;
    p82-snippet-variables.spec.ts)
        # P82 (snippet variables, Phase-B B6) declares the SAME config-owned
        # snippet-dictionary path P52/P59/P77/P78/P79/P80/P81 read. Its one entry
        # `sig` carries a body containing the STANDARD TextMate/VSCode snippet
        # variables — `$CLIPBOARD`, `$CURRENT_DATE`, `$CURRENT_YEAR` (B6 adopts the
        # established `$NAME` names, not bespoke tokens). The variables resolve AT
        # EXPANSION TIME in the shared runSnippet body before snippetCompletion:
        # `$CLIPBOARD` → the real system-clipboard text (via the SAME clipboard
        # backend the P62 paste-image path owns), `$CURRENT_DATE`/`$CURRENT_YEAR` →
        # the host date. Pointing config at this dict makes `sig` the variable
        # entry the editor expands; the spec seeds a KNOWN clipboard string, expands
        # `sig` through the shared insertion-bar path (insertSnippetByTrigger →
        # insertSnippet → runSnippet), and reads the buffer back.
        #
        # RED today: runSnippet (snippets.ts) expands its body through
        # snippetCompletion(normalizeTabstops(body), …) with NO variable
        # resolution — normalizeTabstops only rewrites bare `$<digits>` tabstops, so
        # the NON-digit variable tokens `$CLIPBOARD`/`$CURRENT_DATE`/`$CURRENT_YEAR`
        # survive VERBATIM in the buffer. That literal-token state is exactly the
        # failure P82 KILLS. (There is also no clipboard-text seed hook yet — the
        # spec's seedClipboardText evaluate throws — the faithful no-variable-engine
        # RED.)
        SNIPPETS_DIR="$ABS_SPEC_DIR/home/.pandoc/snippets"
        mkdir -p "$SNIPPETS_DIR"
        SNIPPET_DICT="$SNIPPETS_DIR/p82-variables-snippets.json"
        cp "$REPO_ROOT/tests/proof/fixtures/snippets/p82-variables-snippets.json" "$SNIPPET_DICT"
        EDITOR_EXTRA="snippet_dictionary = \"$SNIPPET_DICT\""
        ;;
    p83-transform-visual.spec.ts)
        # P83 (transform node + visual-selection wrap, Phase-B B7) declares the
        # SAME config-owned snippet-dictionary path P52/P59/P77/P78/P79/P80/P81/
        # P82 read. It carries TWO entries using the STANDARD TextMate/UltiSnips
        # body grammar verbatim (HARD RULE #0 — adopt, never invent):
        #   - `sec` — a TRANSFORM MIRROR. Its body repeats the `${1}` tabstop in
        #     two positions, but the SECOND occurrence carries a standard TextMate
        #     mirror transform `${1/(.*)/\U$1/}` (uppercase the source slot). The
        #     dependent `\label{sec:...}` slot must show the TRANSFORMED (uppercase)
        #     text of what the user typed into the `## ...` source slot.
        #   - `emph` — a VISUAL-WRAP entry. Its body `\emph{${VISUAL}}` is UltiSnips'
        #     `${VISUAL}` selection placeholder: with a real selection active,
        #     expanding it must WRAP exactly the selected text.
        #
        # RED today: normalizeTabstops (snippets.ts) rewrites only bare `$<digits>`
        # to `${N}` — the transform mirror `${1/(.*)/\U$1/}` and the `${VISUAL}`
        # placeholder pass through VERBATIM to CM6's snippetCompletion, whose
        # vendored TextMate parser implements NEITHER the mirror transform NOR
        # `${VISUAL}`. So the dependent slot shows the UNTRANSFORMED source (or a
        # literal `${1/.../.../}`), and runSnippet applies at the bare cursor
        # ([pos, pos] — the selection is discarded), so a `${VISUAL}` wrap drops the
        # selected text. There is also no surface to establish a real selection
        # (__PPE_E2E__.seedSelection does not exist), so the visual-wrap driver
        # throws — the faithful no-transform / no-visual-wrap RED state.
        SNIPPETS_DIR="$ABS_SPEC_DIR/home/.pandoc/snippets"
        mkdir -p "$SNIPPETS_DIR"
        SNIPPET_DICT="$SNIPPETS_DIR/p83-transform-visual-snippets.json"
        cp "$REPO_ROOT/tests/proof/fixtures/snippets/p83-transform-visual-snippets.json" "$SNIPPET_DICT"
        EDITOR_EXTRA="snippet_dictionary = \"$SNIPPET_DICT\""
        ;;
    p54-spellcheck.spec.ts)
        # P54 declares the custom math dictionary by a CONFIG-OWNED path, not a
        # hardcoded list. Provision a hermetic copy of the committed FIXTURE
        # wordlist (the spec owns it; first entry `cohomology`, a real
        # algebraic-geometry term standard English spellcheck flags) and point
        # `[editor].spell_dictionary` at it, so a checker run WITHOUT this
        # dictionary would wrongly flag `cohomology` — which the math-term
        # assertion catches. The base English dictionary ships vendored in-bundle.
        DICTS_DIR="$ABS_SPEC_DIR/home/.pandoc/dictionaries"
        mkdir -p "$DICTS_DIR"
        SPELL_DICT="$DICTS_DIR/p54-mathdict.txt"
        cp "$REPO_ROOT/tests/proof/fixtures/dictionaries/p54-mathdict.txt" "$SPELL_DICT"
        EDITOR_EXTRA="spell_dictionary = \"$SPELL_DICT\""
        ;;
    esac

    # Canonical witness config: theme=dark, font_size=14 (P9 base),
    # debounce_ms=200 (P2).
    cat > "$CONFIG_PATH" <<EOF
[general]
theme = "dark"

[editor]
font_size = 14
line_wrapping = false
line_numbers = true
bibliography = "$ABS_SPEC_DIR/home/.pandoc/bib/references.bib"
csl = "$ABS_SPEC_DIR/home/.pandoc/csl/alpha-preview.csl"
$EDITOR_EXTRA

[preview]
debounce_ms = 200
EOF
    # Export is entirely the pandoc plugin suite: there is NO [export.*] app-core
    # config table. Export targets are discovered export-category plugins; the
    # specs that exercise export (p07/p08/p17/p47/p66) install the relevant plugin
    # in their own case below. The default config carries no export config.
    emit_directories "$CONFIG_PATH"
    # Renderer setup (Milestone B): the core is renderer-agnostic and delegates the
    # preview to the active renderer plugin. Default = pandoc renderer (keeps the
    # preview byte-identical to the old core path); p20 swaps in the generic
    # renderer to prove the abstraction.
    case "$SPEC" in
    p20-generic-renderer.spec.ts)
        install_plugin_fixtures "$PLUGINS_DIR" generic-renderer
        # The [editor] block above declares the (required) bibliography/csl config
        # keys (P84/C1); install the pandoc assets so those paths resolve to real
        # files at config load even though the generic renderer ignores them.
        env HOME="$ABS_SPEC_DIR/home" bash "$REPO_ROOT/scripts/install-assets.sh" > /dev/null
        cp --remove-destination "$REPO_ROOT/tests/proof/fixtures/references.bib" \
            "$ABS_SPEC_DIR/home/.pandoc/bib/references.bib"
        cat >> "$CONFIG_PATH" <<EOF

[plugins]
dir = "$PLUGINS_DIR"

[renderer]
active = "generic-renderer"
EOF
        ;;
    *)
        emit_pandoc_renderer "$CONFIG_PATH" "$PLUGINS_DIR" "$PANDOC_BIN"
        ;;
    esac
fi

# ── Custom export plugin (p12 only) ────────────────────────────────────
# P12 asserts the export surface runs an ARBITRARY configured argv against the
# real source. Export is now plugin-shaped (export-plugins-contract.md): the
# canonical config above already set up the pandoc renderer + [plugins].dir (so
# the preview works); here we ADD the user-defined "witness" export-category
# plugin into that SAME dir and its [plugin.witness] config section — there is NO
# app-core [export.witness] config table. The plugin's [exec].command is an
# arbitrary executable (its export.sh), NOT pandoc; the spec then drives
# runPlugin('witness', target) through the generic firewall and asserts the
# produced witness file carries the WITNESS-EXPORT marker, the real input's first
# heading, and the SHA-256 of the input's exact bytes.
case "$SPEC" in
p12-export-custom-pipeline.spec.ts)
    install_plugin_fixtures "$PLUGINS_DIR" witness
    cat >> "$CONFIG_PATH" <<EOF

[plugin.witness]
command = "noop"
EOF
    ;;
p19-plugin-run-by-id.spec.ts)
    # A1: the generic plugin firewall runs a tools plugin by id. The canonical
    # config above already set up the pandoc renderer + [plugins].dir (so the
    # preview works); here we ADD the witness-tool plugin into that same dir and
    # its config section. The witness-tool.marker is created so witness-tool's
    # contributed doctor checks pass and the app boots; the spec then drives
    # runPlugin by id.
    install_plugin_fixtures "$PLUGINS_DIR" witness-tool
    touch "$CONFIG_DIR/witness-tool.marker"
    cat >> "$CONFIG_PATH" <<EOF

[plugin.witness-tool]
greeting = "hi"
EOF
    ;;
p22-configure-plugin-spawn.spec.ts)
    # C1: plugins own their configuration. The canonical config above set up the
    # pandoc renderer + [plugins].dir (so the preview works); here we ADD the
    # witness-tool plugin (whose manifest declares a [configure] command) into
    # that same dir and its config section, so the spec can drive configurePlugin
    # by id. The marker is created so witness-tool's contributed doctor checks
    # pass and the app boots.
    install_plugin_fixtures "$PLUGINS_DIR" witness-tool
    touch "$CONFIG_DIR/witness-tool.marker"
    cat >> "$CONFIG_PATH" <<EOF

[plugin.witness-tool]
greeting = "hi"
EOF
    ;;
p07-export-html.spec.ts)
    # P7 (export-as-plugin migration): HTML export is the shipped pandoc-html-export
    # export-category plugin, discovered from [plugins].dir and run BY ID through the
    # generic firewall (proof-obligations.md migration rulings 2026-06-17;
    # export-plugins-contract.md). The canonical config above already set up the
    # pandoc renderer + [plugins].dir (so the preview works); here we ADD the shipped
    # pandoc-html-export plugin into that SAME dir (vendored alongside pandoc-renderer,
    # OSOT) and its [plugin.pandoc-html-export] config section — the raw HTML export
    # command the plugin runs (mirroring [plugin.pandoc-renderer].command). The spec
    # then drives runPlugin('pandoc-html-export', target) and asserts the produced
    # artifact carries the P1 witnesses and a self-contained data: image URI.
    #
    # The shipped pandoc-html-export plugin is vendored alongside pandoc-renderer
    # (src-tauri/resources/vendor/plugins/pandoc-html-export, OSOT) and installed
    # into this spec's hermetic plugins dir here. Its [plugin.pandoc-html-export]
    # config carries the raw HTML export command (the individually-managed raw
    # command, ruling 2); export.sh runs it verbatim, layering the plugin-local
    # MathJax bundle, the real {file} as input, and the {artifact} output. The spec
    # then drives runPlugin('pandoc-html-export', target) and asserts the produced
    # artifact carries the P1 witnesses and a self-contained data: image URI.
    install_plugin_fixtures "$PLUGINS_DIR" pandoc-html-export
    cat >> "$CONFIG_PATH" <<EOF

[plugin.pandoc-html-export]
command = "$PANDOC_BIN --from markdown+lists_without_preceding_blankline --to html5 --standalone --embed-resources"
EOF
    ;;
p17-export-html-offline.spec.ts)
    # P17 (export-as-plugin migration): HTML export is the shipped pandoc-html-export
    # export-category plugin (proof-obligations.md migration rulings 2026-06-17;
    # export-plugins-contract.md), exactly as P7 already retargeted. P17 proves the
    # OFFLINE self-containment of that plugin's artifact: it runs the plugin's
    # export.sh as an INDEPENDENT process under unshare -rn (network-isolated),
    # reading the command from the installed plugin manifest's [exec].command and
    # delivering the [plugin.pandoc-html-export] config section on PPE_PLUGIN_CONFIG
    # exactly as plugins.rs::run_plugin_sync does. export.sh layers the plugin-LOCAL
    # MathJax bundle (vendored INSIDE the plugin dir, ruling 1) onto the raw pandoc
    # command, so the artifact inlines MathJax and renders math with no network.
    #
    # The shipped pandoc-html-export plugin is vendored alongside pandoc-renderer
    # (src-tauri/resources/vendor/plugins/pandoc-html-export, OSOT) and installed
    # into this spec's hermetic plugins dir here; its [plugin.pandoc-html-export]
    # config carries the raw HTML export command. The --embed-resources flag makes
    # the artifact self-contained; the plugin-local --mathjax (layered by export.sh)
    # makes it render offline.
    install_plugin_fixtures "$PLUGINS_DIR" pandoc-html-export
    cat >> "$CONFIG_PATH" <<EOF

[plugin.pandoc-html-export]
command = "$PANDOC_BIN --from markdown+lists_without_preceding_blankline --to html5 --standalone --embed-resources"
EOF
    ;;
p08-export-pdf.spec.ts)
    # P8 (export-as-plugin migration): PDF export is the shipped pandoc-pdf-export
    # export-category plugin, discovered from [plugins].dir and run BY ID through the
    # generic firewall (proof-obligations.md migration rulings 2026-06-17;
    # export-plugins-contract.md), exactly as HTML export moved to pandoc-html-export.
    # The canonical config above already set up the pandoc renderer + [plugins].dir
    # (so the preview works); here we ADD the shipped pandoc-pdf-export plugin into
    # that SAME dir (vendored alongside pandoc-renderer, OSOT) and its
    # [plugin.pandoc-pdf-export] config section — the raw PDF export command the
    # plugin runs (the individually-managed raw command, ruling 2). export.sh runs it
    # verbatim, layering the real {file} as input and the {artifact} output. The
    # configured --pdf-engine=lualatex lives in that raw command, so the produced PDF
    # carries a LuaTeX Producer (the spec's engine discriminator). The spec then
    # drives runPlugin('pandoc-pdf-export', target) and asserts the produced PDF is
    # valid, carries the P1 witnesses, and was built by lualatex (not pdfTeX).
    install_plugin_fixtures "$PLUGINS_DIR" pandoc-pdf-export
    cat >> "$CONFIG_PATH" <<EOF

[plugin.pandoc-pdf-export]
command = "$PANDOC_BIN --from markdown --standalone --pdf-engine=lualatex"
EOF
    ;;
p47-save-gate.spec.ts)
    # P47 A2 proves the save-gate blocks a REAL plugin export on an identity-less
    # buffer. So the shipped pandoc-html-export export-category plugin must be
    # DISCOVERABLE here: install it (vendored alongside pandoc-renderer, OSOT) and
    # its [plugin.pandoc-html-export] config section. Without it the gated-export
    # assertion would pass for the wrong reason (plugin-not-found rather than
    # gated); with it, the only thing stopping the artifact is the gate itself.
    install_plugin_fixtures "$PLUGINS_DIR" pandoc-html-export
    cat >> "$CONFIG_PATH" <<EOF

[plugin.pandoc-html-export]
command = "$PANDOC_BIN --from markdown+lists_without_preceding_blankline --to html5 --standalone --embed-resources"
EOF
    ;;
p66-export-plugin-discovery.spec.ts)
    # P66: export is a discovered plugin in the pandoc suite. The canonical config
    # above set up the pandoc renderer + [plugins].dir (so the preview works); here
    # we ADD the export-category fixture plugin into that SAME dir and its config
    # section — and deliberately NO [export.witness-export-plugin] app-core table.
    # The plugin declares category="export", a generic `extension` manifest field
    # ("wexp"), and a contributed doctor check. The ONLY way it can surface in the
    # menu/command-palette and in the doctor battery is via category-aware discovery
    # of the plugin manifest, never via the app-core [export.<id>] config table.
    install_plugin_fixtures "$PLUGINS_DIR" witness-export-plugin
    cat >> "$CONFIG_PATH" <<EOF

[plugin.witness-export-plugin]
command = "true"
EOF
    ;;
p49-session-restore.spec.ts)
    # P49 — launch restores the last session and offers newer recovery content.
    #
    # A true two-instance relaunch is infeasible in this harness: run_app_spec
    # launches exactly ONE app instance and the Playwright fixture attaches to
    # its socket; there is no in-harness primitive to spawn a second instance and
    # observe its webview. So we provision, on the HOST FILESYSTEM and BEFORE the
    # single launch, exactly the durable state a prior session would have left —
    # then observe whether the launched app honors it. This is faithful, not a
    # mock: the app boots against a clean hermetic XDG with NO prior in-app
    # activity, so reopening the last file and offering the newer recovery content
    # can ONLY come from reading this real host-fs state.
    #
    # Two real host-fs artifacts are provisioned:
    #
    #  (1) SESSION STATE under $XDG_STATE_HOME/pandoc-preview/session.json — the
    #      last project + last file a prior session persisted. Per the contract
    #      (recovery-and-git-state-requirements.md) session state lives on the
    #      host fs under XDG_STATE_HOME, never browser storage. This is the
    #      stable observable contract the implementer must read on launch.
    #
    #  (2) A RECOVERY STORE AHEAD OF DISK under
    #      $XDG_DATA_HOME/pandoc-preview/recovery/<session_id>/ — a REAL git repo
    #      built exactly as src-tauri/src/recovery.rs builds it (the buffer
    #      committed as a blob under the recovery filename), holding the NEWER
    #      buffer: the on-disk demo.md content PLUS an unsaved edit. The on-disk
    #      demo.md is left as the STALE older content (the plain fixture copy), so
    #      a restore that loads disk would be observably wrong.
    #
    # The spec discovers the newer recovery bytes content-addressably (it does not
    # hardcode them), asserts they are ahead of disk, then asserts the accepted
    # restore loads exactly those bytes into the editor buffer.
    SESSION_ID="p49-session"
    # The tree entry name recovery.rs records the buffer blob under
    # (recovery.rs: BUFFER_ENTRY = "buffer", no extension). Kept in sync with the
    # app's recovery store layout so this provisioned repo is a faithful replica
    # of what the app's own autosave would write. The spec reads the buffer bytes
    # content-addressably from the object database, so it does not depend on this
    # name — but the provisioned repo must still match the real store shape.
    RECOVERY_FILENAME="buffer"
    RECOVERY_DIR="$ABS_SPEC_DIR/xdg-data/pandoc-preview/recovery/$SESSION_ID"

    # The NEWER buffer = stale on-disk demo.md + an unsaved edit. Built from the
    # ACTUAL on-disk bytes so "ahead of disk" is a real content delta, not an
    # invented file. The sentence carries non-ASCII so a lossy restore is caught.
    NEWER_BUFFER="$ABS_SPEC_DIR/p49-newer-buffer.md"
    cp "$DEMO_FILE" "$NEWER_BUFFER"
    printf '\n\nUnsaved recovery edit — Café ζ naïve.\n' >> "$NEWER_BUFFER"

    # Build the recovery store as a REAL git repo, mirroring recovery.rs exactly:
    # the buffer is committed as a blob at RECOVERY_FILENAME. An independent
    # process (this provisioning) writes it; the app and the spec both read it
    # content-addressably from the object database (p45's discipline).
    mkdir -p "$RECOVERY_DIR"
    git -C "$RECOVERY_DIR" init -q
    git -C "$RECOVERY_DIR" config user.email "recovery@pandoc-preview.localhost"
    git -C "$RECOVERY_DIR" config user.name "pandoc-preview recovery"
    cp "$NEWER_BUFFER" "$RECOVERY_DIR/$RECOVERY_FILENAME"
    git -C "$RECOVERY_DIR" add "$RECOVERY_FILENAME"
    git -C "$RECOVERY_DIR" commit -q -m "autosave: $DEMO_FILE"

    # Session state: the last project + last file + the recovery session id, on
    # the host fs under XDG_STATE_HOME. The implementer reads this on launch to
    # reopen the last file and locate the session's recovery store.
    SESSION_STATE_DIR="$ABS_SPEC_DIR/xdg-state/pandoc-preview"
    mkdir -p "$SESSION_STATE_DIR"
    jq -n \
        --arg project "$PROJECT_DIR" \
        --arg file "$DEMO_FILE" \
        --arg sessionId "$SESSION_ID" \
        '{project: $project, file: $file, sessionId: $sessionId}' \
        > "$SESSION_STATE_DIR/session.json"
    ;;
p84-bib-config-key.spec.ts)
    # P84/C1: the bibliography the app cites against is ONE config-declared
    # source the frontend can read AND the file the preview resolves citations
    # from. The canonical [editor] block (written above) declares the required
    # editor.bibliography key pointing at $HOME/.pandoc/bib/references.bib; the
    # renderer layers that SAME config value onto pandoc as --bibliography (render
    # context, alongside --mathjax). Replace that bib with the p84 fixture, which
    # carries a UNIQUE entry (key C1ONLY, authors Zariski/Voronoi) the default
    # references.bib does NOT contain, so the preview's #refs for [@C1ONLY] can only
    # come from a bibliography that holds C1ONLY. The spec reads the frontend-exposed
    # bibliography path back (window.__PPE_E2E__.configBibliography(), the sibling of
    # configFontSize, surfacing config.editor.bibliography) and cross-checks (off
    # disk, independent process) that the SAME file holds C1ONLY — proving the one
    # config value governs both surfaces.
    cp "$REPO_ROOT/tests/proof/fixtures/p84-bib.bib" "$ABS_SPEC_DIR/home/.pandoc/bib/references.bib"
    ;;
p87-cross-file-labels.spec.ts)
    # P87 (C3): cross-file label completion harvested from the project's markdown
    # files. C3 is an INDEPENDENT completion source — labels come from the project's
    # files, not from editor.bibliography — so this case adds a DISTINCTIVE label to
    # file A (outline.md) in THIS spec's hermetic project copy only. The witness
    # project ships two markdown files (demo.md + outline.md); the spec opens file B
    # (demo.md) and triggers label completion, which must offer the label defined in
    # file A (outline.md). The appended `\label{lem:xyz-cross}` carries a token
    # (`xyz-cross`) that appears in NEITHER demo.md nor outline.md beforehand, so a
    # candidate offered for it while editing demo.md can ONLY have come from
    # harvesting outline.md — proving the index spans the whole project, not the
    # current buffer. Appended (not edited into a heading line) so p41/p42's
    # line-numbered outline/fold assertions over their OWN copies are untouched.
    printf '\n\nA cross-file lemma. \\label{lem:xyz-cross}\n' >> "$PROJECT_DIR/outline.md"
    ;;
p87b-label-precision.spec.ts)
    # P87b (C3 precision): a label is an anchor DEFINITION — a pandoc `{#id}`
    # heading attribute, a `:::{#id}` fenced-div id, or a `\label{}` — NOT an
    # arbitrary `#id` token. Provision ONE markdown file (file A, precision.md) in
    # THIS spec's hermetic project copy only, carrying THREE distinctive tokens
    # together:
    #   (a) a REAL anchor that MUST be offered: a heading with a pandoc attribute
    #       `{#sec:realprecision}` (and a `\label{lem:realprecision}` for good
    #       measure) — genuine anchor definitions.
    #   (b) a DECOY markdown link fragment that MUST NOT be offered:
    #       `[see here](#decoyfragment)` — a `#id` inside a link target, NOT an
    #       attribute brace.
    #   (c) a DECOY prose hash that MUST NOT be offered: a bare `#decoyprose`
    #       token in ordinary prose, NOT inside any attribute brace.
    # The tokens `realprecision`, `decoyfragment`, `decoyprose` appear in NEITHER
    # demo.md nor outline.md, so candidates surfaced for them while editing demo.md
    # came ONLY from harvesting precision.md. The spec opens file B (demo.md) and
    # triggers `\cref{` label completion; the precise harvester must offer
    # `sec:realprecision`/`lem:realprecision` and must NOT offer the link fragment
    # `decoyfragment` nor the prose hash `decoyprose`. Added as a NEW file (not
    # appended to demo/outline) so p41/p42/p87 expectations over their copies are
    # untouched.
    cat > "$PROJECT_DIR/precision.md" <<'PPE_P87B_EOF'
# Precision section {#sec:realprecision}

A real lemma. \label{lem:realprecision}

A markdown link to elsewhere: [see here](#decoyfragment).

A bare prose hash like #decoyprose is not an anchor definition.
PPE_P87B_EOF
    ;;
p88-perfile-bib-override.spec.ts)
    # P88 (C4): per-file `bibliography:` YAML frontmatter override, with the global
    # config bibliography as the source for files WITHOUT it. Two distinct
    # bibliographies are provisioned:
    #
    #  (1) The GLOBAL config bibliography (editor.bibliography, the P84/C1 single
    #      config-declared source the canonical [editor] block above points at
    #      $HOME/.pandoc/bib/references.bib). Replace it with the p88 GLOBAL
    #      fixture, whose sole entry has key GLOBALKEY (title word "Globally",
    #      authors Hilbert/Noether). This file does NOT contain LOCALONLY.
    #
    #  (2) A sibling LOCAL .bib placed INSIDE this spec's hermetic project copy,
    #      whose sole entry has key LOCALONLY (title word "Paperlocal", authors
    #      Poincare/Lefschetz). This file does NOT contain GLOBALKEY.
    #
    # A new markdown file in the hermetic project copy declares, in its YAML
    # frontmatter, `bibliography: ./p88-local.bib` (pandoc's own native per-file
    # metadata key, resolved relative to the file's directory). The override file
    # is added to the hermetic copy ONLY (like p87's outline.md append), so other
    # specs' project-file expectations are untouched.
    #
    # The spec opens the override file and asserts citation completion offers
    # LOCALONLY (the override is in effect) and not GLOBALKEY; then opens demo.md
    # (no frontmatter `bibliography:`) and asserts it still offers GLOBALKEY (the
    # global config bibliography remains the source for non-overriding files).
    cp "$REPO_ROOT/tests/proof/fixtures/p88-global.bib" "$ABS_SPEC_DIR/home/.pandoc/bib/references.bib"
    cp "$REPO_ROOT/tests/proof/fixtures/p88-local.bib" "$PROJECT_DIR/p88-local.bib"
    cat > "$PROJECT_DIR/p88-override.md" <<'PPE_P88_EOF'
---
title: Per-file bibliography override witness
bibliography: ./p88-local.bib
---

# Override document

A document that ships its own bibliography.
PPE_P88_EOF
    ;;
p85-citation-completion.spec.ts | p86-citation-tooltip.spec.ts)
    # P85/P86 (C2): citation completion sourced from the SINGLE config-declared
    # bibliography P84 established (editor.bibliography). The canonical [editor]
    # block (written above) declares editor.bibliography pointing at
    # $HOME/.pandoc/bib/references.bib; point that SAME config value at the C2
    # fixture bib, whose entries deliberately carry TITLE words and AUTHOR
    # surnames ABSENT from their cite keys (key xq7 → title "Crystalline
    # cohomology of supersingular abelian varieties", authors Grothendieck/Serre).
    # A title-word query ("crystalline"/"supersingular") or author query
    # ("grothendieck") therefore surfaces that entry ONLY if the candidate match
    # string is built from the bibliographic metadata, not the cite key — the
    # property P85 proves and P86's tooltip previews. The spec drives the editor
    # UI (type @, read the completion popup + info tooltip DOM, accept) and is
    # AGNOSTIC to how the .bib is parsed; this provisioning only points the one
    # config-declared bibliography at the fixture.
    cp "$REPO_ROOT/tests/proof/fixtures/p85-bib.bib" "$ABS_SPEC_DIR/home/.pandoc/bib/references.bib"
    ;;
p29-global-figures-resource.spec.ts)
    # P29: a figure that exists ONLY in the global figures dir
    # ($HOME/.pandoc/figures), referenced relative to that dir (rendered/global.png).
    # It is deliberately NOT placed under the project, so it can resolve only
    # through the global figures dir on the resource path — which the renderer
    # learns from PANDOC_RESOURCE_PATH (run_app_spec sets it to this hermetic
    # figures dir, mirroring the GUI session's ~/.pathrc export). The committed
    # fixture is a real 80x32 PNG (distinct from P5's 64x48) the spec decodes.
    FIGS_DIR="$ABS_SPEC_DIR/home/.pandoc/figures/rendered"
    mkdir -p "$FIGS_DIR"
    cp "$REPO_ROOT/tests/proof/fixtures/global-figures/rendered/global.png" "$FIGS_DIR/"
    printf '\n![globalfig](rendered/global.png)\n' >> "$DEMO_FILE"
    ;;
p101-shared-tikzstyles.spec.ts)
    # P91 (Phase D / D-2): a tikz style defined ONLY in the shared `.tikzstyles`
    # palette must visibly determine a compiled figure's appearance in the live
    # preview, and changing that shared file must change the render.
    #
    # Provision the shared palette file in TikzIt's NATIVE `.tikzstyles` format
    # (`\tikzstyle{NAME}=[...]`, per [[parity-research/tikzit]]) into this spec's
    # hermetic global figures dir. It declares ONE distinctive style, `bigredbox`,
    # with `fill=red` — a clearly detectable visual signature: a node carrying
    # this style compiles (pdflatex + pdf2svg) to an SVG whose fill is
    # `rgb(100%, 0%, 0%)` (verified against the real toolchain). The style name and
    # its fill appear in NO other fixture, so a red fill in the rendered figure can
    # ONLY come from the figure compile having consumed THIS shared file.
    #
    # The companion BLUE variant (`bigredbox`=fill=blue) is provisioned alongside,
    # under a sibling name the spec swaps in on disk for the discriminator leg: the
    # spec overwrites the active shared file with the blue definition and
    # re-triggers a render, asserting the rendered figure changes from the red
    # signature to the blue signature (`rgb(0%, 0%, 100%)`). This proves the SHARED
    # FILE'S CONTENT determines the render — a hardcoded-red compile that ignored
    # the file would survive the first leg but fail the discriminator.
    #
    # NOTE (the RED today): the figure-compile seam P100 activated does NOT
    # `\input` this shared file, and there is no config key declaring it (the
    # config schema is deny_unknown_fields, so declaring an undefined
    # shared-tikzstyles key here would be a BOOT failure, not the missing-
    # consumption behavior this obligation targets). So a node using
    # `style=bigredbox` compiles WITHOUT the style's effect: the figure either
    # fails to produce a vector figure or renders with no red fill. The shared
    # file sits on disk, unconsumed. The GREEN wiring (D-2) adds the
    # config-declared, ExistingFile-validated shared-tikzstyles path and `\input`s
    # it into the figure compile; this provisioning places the file where that
    # wiring will read it (the configured global figures dir).
    FIGS_DIR="$ABS_SPEC_DIR/home/.pandoc/figures"
    mkdir -p "$FIGS_DIR"
    cat > "$FIGS_DIR/shared.tikzstyles" <<'PPE_P101_RED_EOF'
\tikzstyle{bigredbox}=[fill=red, draw=black, shape=rectangle, minimum width=2cm, minimum height=2cm]
PPE_P101_RED_EOF
    cat > "$FIGS_DIR/shared-blue.tikzstyles" <<'PPE_P101_BLUE_EOF'
\tikzstyle{bigredbox}=[fill=blue, draw=black, shape=rectangle, minimum width=2cm, minimum height=2cm]
PPE_P101_BLUE_EOF
    ;;
esac

# ── lualatex font-cache warmup (p08 only) ──────────────────────────────
# Each run's HOME is a fresh empty dir, so the FIRST lualatex invocation
# rebuilds the luaotfload font database (written under
# $HOME/.config/texlive/<year>/texmf-var/luatex-cache), which takes far longer
# than the spec's artifact poll window. Warm it here by running the exact
# shipped pandoc-pdf-export plugin command once under the spec's hermetic env.
# This is environment provisioning (same class as pre-building the app
# binary), NOT the proof: the spec still drives the app's own export and
# asserts on the artifact that export produces. Fails loudly if the command
# cannot produce a PDF — a broken lualatex is a broken proof environment.
if [ "$SPEC" = "p08-export-pdf.spec.ts" ]; then
    WARMUP_PDF="$ABS_SPEC_DIR/lualatex-warmup.pdf"
    # cwd = the source file's parent, mirroring the app's export contract.
    (
        cd "$PROJECT_DIR"
        env HOME="$ABS_SPEC_DIR/home" \
            XDG_CONFIG_HOME="$ABS_SPEC_DIR/xdg-config" \
            XDG_CACHE_HOME="$ABS_SPEC_DIR/xdg-cache" \
            XDG_STATE_HOME="$ABS_SPEC_DIR/xdg-state" \
            pandoc --from markdown --standalone --pdf-engine=lualatex \
            "$DEMO_FILE" --output "$WARMUP_PDF"
    )
    if [ ! -s "$WARMUP_PDF" ]; then
        echo "FATAL: lualatex warmup produced no PDF at $WARMUP_PDF" >&2
        exit 1
    fi
    rm -f "$WARMUP_PDF"
fi

jq -n \
    --arg runId "$RUN_ID" \
    --arg spec "$SPEC" \
    --arg runDir "$ABS_SPEC_DIR" \
    --arg xdgConfigHome "$ABS_SPEC_DIR/xdg-config" \
    --arg xdgDataHome "$ABS_SPEC_DIR/xdg-data" \
    --arg xdgStateHome "$ABS_SPEC_DIR/xdg-state" \
    --arg configPath "$CONFIG_PATH" \
    --arg project "$PROJECT_DIR" \
    --arg demoFile "$DEMO_FILE" \
    '{runId: $runId, spec: $spec, runDir: $runDir,
      xdgConfigHome: $xdgConfigHome, xdgDataHome: $xdgDataHome,
      xdgStateHome: $xdgStateHome,
      configPath: $configPath, project: $project, demoFile: $demoFile}' \
    > "$SPEC_DIR/manifest.json"

echo "provisioned $SPEC at $ABS_SPEC_DIR"
