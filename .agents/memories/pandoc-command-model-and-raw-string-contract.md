# Pandoc Command Model and Raw String Contract

> **Canonical source — project wiki (single source of truth):** [Pandoc Command Model and Raw String Contract](https://github.com/dzackgarza/pandoc-preview-greenfield2/wiki/Pandoc-Command-Model) Edit the doctrine there; this file is a pointer for iwe recall.

**When this applies:** designing or reviewing the **pandoc renderer plugin** — its command storage, its self-owned `configure` command, or config validation.
The app core no longer owns any of this; it lives inside the pandoc renderer plugin ([Renderer Plugin Architecture](renderer-plugin-architecture)). Originally ratified 2026-06-13; **clauses 2–4 repealed and replaced 2026-06-14** (plugin-owned config via a spawned `configure` command — see below).
