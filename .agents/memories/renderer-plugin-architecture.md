# Renderer Plugin Architecture

> **Canonical source — project wiki (single source of truth):** [Renderer Plugin Architecture](https://github.com/dzackgarza/pandoc-preview-greenfield2/wiki/Renderer-Plugin-Architecture) Edit the doctrine there; this file is a pointer for iwe recall.

**When this applies:** any work on the render/preview pipeline, the settings/config surface, the plugin system, or any decision about where renderer-specific knowledge lives.
User-ratified 2026-06-13; **substantially clarified 2026-06-14** (total externality, the pandoc plugin *suite*, plugin-launched config managers — see below).
This is the keystone that reorganizes the entire render model.
