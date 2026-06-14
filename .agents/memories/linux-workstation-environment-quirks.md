# Linux Workstation Environment Quirks

# Linux Workstation Environment Quirks

**When this applies:** building, running, or testing the Tauri app on this machine (Wayland + Xwayland, webkit2gtk-4.1, rolling release).
All original-repo battle scars; each will recur in any Tauri iteration here.

- **Wayland clipboard:** `navigator.clipboard.read()` is broken for binary image types under Wayland.
  `ClipboardEvent.clipboardData` works.
  For tests and tooling use the platform utilities: `wl-copy` (Wayland) / `xclip -selection clipboard` (X11). The FreeTikZ/quiver extraction feature and image-paste flows must be designed against this.
- **conda poisons pkg-config:** webkit2gtk/GTK builds fail when conda's pkg-config shadows system paths.
  Fix: prepend system dirs — `PKG_CONFIG_PATH="/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig:/usr/lib/pkgconfig:$PKG_CONFIG_PATH"` (original `run-tauri-dev.sh`).
- **Process-group teardown is mandatory:** killing only the direct child of `tauri dev` leaves ghost GUI windows (vite + app + webview tree).
  Pattern: `set -m`, record the child PID, EXIT trap doing `kill -- -"$child_pid"` (negative PID = group), escalate to KILL, then assert the group is empty (`pgrep -g`). The first greenfield's proof-run.sh asserted teardown every run — keep that.
- **There IS a display.** This is a graphical desktop with valid `$DISPLAY`; any agent claim of "headless server, needs xvfb" is the documented confabulation pattern (xvfb cloak — [Original App History: Eras and Burned Mistakes](original-app-history-eras-and-burned-mistakes)). Real-display runs are the proof contract; xvfb in any proof path is banned.
- **Blank Tauri webview on Wayland:** known risk class; the sanctioned remedy is exactly ONE committed env fix in the dev/proof recipe, tried in order — `WEBKIT_DISABLE_DMABUF_RENDERER=1`, else `WEBKIT_DISABLE_COMPOSITING_MODE=1`, else `GDK_BACKEND=x11` — never a runtime fallback chain.
- **Rolling-release drift:** webkit/pandoc/plugin versions change under you; the first iteration recorded tool versions in every proof artifact — keep that practice so version drift is diagnosable after the fact.
