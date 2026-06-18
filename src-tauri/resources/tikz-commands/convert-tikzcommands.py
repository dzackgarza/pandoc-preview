#!/usr/bin/env python3
"""Convert the vendored QTikz `tikzcommands.xml` into the app's `tikzcommands.json`.

QTikz (fhackenberger/ktikz) ships its insert corpus as a native XML file whose
`<item>` elements carry exactly the cursor-aware command shape this app consumes:

    name        human-readable label (carries Qt `&` menu mnemonics upstream)
    description completion popup / status-bar text
    insert      the multi-character string inserted when the command is chosen
    dx, dy      where the editing cursor is placed AFTER insertion, relative to
                the start of the inserted string (absent => 0)
    type        highlighting class 0..3 (0 plain, 1 command, 2 draw-to, 3 option)

The app consumes a JSON array of `{name, description, insert, dx, dy, type}`
objects (one per `<item>`) — the SAME shape the P94 fixture DB uses. This is a
pure reshaping of the native XML into JSON: no command list is authored here, and
no field is invented. The only normalization is stripping the Qt `&` menu
mnemonic from `name` (an `&&` upstream is a literal ampersand), since the app
surfaces the bare command label, not a Qt accelerator. `<separator/>` and
`<section>` grouping carry no command and are skipped (their items are flattened).

Run from this directory:  python3 convert-tikzcommands.py
Reads ./tikzcommands.xml, writes ./tikzcommands.json.
"""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "tikzcommands.xml"
TARGET = HERE / "tikzcommands.json"


def strip_mnemonic(label: str) -> str:
    """Remove the Qt `&` menu accelerator from a name. `&&` is a literal `&`."""
    out: list[str] = []
    i = 0
    while i < len(label):
        ch = label[i]
        if ch == "&":
            nxt = label[i + 1] if i + 1 < len(label) else ""
            if nxt == "&":
                out.append("&")
                i += 2
                continue
            # a single `&` is the accelerator marker: drop it
            i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def restore_newlines(text: str) -> str:
    r"""Replace every literal `\n` NOT preceded by a backslash with a real
    newline — the QTikz `restoreNewLines` step (a `\\node` is left intact, a
    standalone `\n` becomes a line break). Applied BEFORE the `\\` -> `\` collapse,
    exactly as QTikz orders the two transforms."""
    out: list[str] = []
    i = 0
    while i < len(text):
        if (
            text[i] == "\\"
            and i + 1 < len(text)
            and text[i + 1] == "n"
            and (i == 0 or text[i - 1] != "\\")
        ):
            out.append("\n")
            i += 2
            continue
        out.append(text[i])
        i += 1
    return "".join(out)


def process_insert(raw: str) -> str:
    r"""The exact QTikz insert transform: restore `\n` newlines, then collapse
    `\\` -> `\` (tikzcommandinserter.cpp). The stored corpus is therefore the
    literal text QTikz inserts into the document, not the raw XML attribute."""
    return restore_newlines(raw).replace("\\\\", "\\")


def parse_int_attr(item: ET.Element, key: str) -> int:
    raw = item.get(key)
    if raw is None:
        return 0
    return int(raw)


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"missing vendored source: {SOURCE}")
    tree = ET.parse(SOURCE)
    root = tree.getroot()

    commands: list[dict[str, object]] = []
    # Flatten every <item> at any section nesting depth.
    for item in root.iter("item"):
        insert = item.get("insert")
        type_raw = item.get("type")
        # Every command must carry an insert body and a highlighting type.
        if insert is None or type_raw is None:
            raise SystemExit(
                f"tikzcommands.xml item missing insert/type: {ET.tostring(item)!r}"
            )
        # The Qt menu label. When upstream omits `name` the item is surfaced by
        # its `description` (the QTikz menu/completion fallback), so the bare
        # command label is the stripped description. The `\\` -> `\` collapse
        # mirrors QTikz's `description.replace("\\\\", "\\")`.
        description = strip_mnemonic(item.get("description", "")).replace("\\\\", "\\")
        name_raw = item.get("name")
        name = strip_mnemonic(name_raw) if name_raw is not None else description
        if not name:
            raise SystemExit(
                f"tikzcommands.xml item has neither name nor description: {ET.tostring(item)!r}"
            )
        commands.append(
            {
                "name": name,
                "description": description,
                "insert": process_insert(insert),
                "dx": parse_int_attr(item, "dx"),
                "dy": parse_int_attr(item, "dy"),
                "type": int(type_raw),
            }
        )

    if not commands:
        raise SystemExit("tikzcommands.xml yielded no <item> commands")

    TARGET.write_text(json.dumps(commands, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(commands)} commands -> {TARGET}")


if __name__ == "__main__":
    main()
