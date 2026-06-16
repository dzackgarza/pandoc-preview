mod clipboard;
mod config;
mod doctor;
mod error;
mod fsops;
mod plugins;
mod recovery;
mod render;
mod repostate;

use tauri::menu::{AboutMetadata, Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

/// Stable Unix socket path for the in-app Playwright bridge (e2e-testing
/// builds only). Must equal `mcpSocket` in tests/proof/fixtures.ts; the
/// proof orchestrator removes any stale socket before each app launch.
#[cfg(feature = "e2e-testing")]
pub const PLAYWRIGHT_SOCKET: &str = "/tmp/pandoc-preview-playwright.sock";

fn build_menu<R: Runtime>(app: &AppHandle<R>, config: &config::Config) -> tauri::Result<Menu<R>> {
    let mut file = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("new_file", "New File…")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("open_folder", "Open Folder…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("save_as", "Save As…")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?,
        )
        .separator();

    // One Export menu item per configured [export.<id>] plugin, in config order.
    // The menu item id carries the plugin id ("export:<id>"); the webview handler
    // drives the SAME export command path as the E2E hook.
    for (id, plugin) in &config.export {
        file = file.item(
            &MenuItemBuilder::with_id(format!("export:{id}"), format!("Export {}…", plugin.label))
                .build(app)?,
        );
    }

    let file = file
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    // Editing items deliberately carry no accelerators: the webview handles
    // Ctrl+Z/X/C/V/F natively (CodeMirror keymap inside the editor), and a
    // registered menu accelerator would shadow those keystrokes on Linux.
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&MenuItemBuilder::with_id("undo", "Undo").build(app)?)
        .item(&MenuItemBuilder::with_id("redo", "Redo").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("cut", "Cut").build(app)?)
        .item(&MenuItemBuilder::with_id("copy", "Copy").build(app)?)
        .item(&MenuItemBuilder::with_id("paste", "Paste").build(app)?)
        .item(&MenuItemBuilder::with_id("select_all", "Select All").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("find", "Find…").build(app)?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("toggle_sidebar", "Toggle Sidebar")
                .accelerator("F9")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("show_preview", "Preview Tab")
                .accelerator("F10")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("show_log", "Compile Log Tab")
                .accelerator("F11")
                .build(app)?,
        )
        .separator()
        // No accelerators: the webview owns Ctrl-P (command palette) and the
        // fold keymap; a registered menu accelerator would shadow them on Linux.
        .item(&MenuItemBuilder::with_id("command_palette", "Command Palette").build(app)?)
        .item(&MenuItemBuilder::with_id("fold_all", "Fold All").build(app)?)
        .item(&MenuItemBuilder::with_id("unfold_all", "Unfold All").build(app)?)
        .build()?;

    let tools = SubmenuBuilder::new(app, "Tools")
        .item(
            &MenuItemBuilder::with_id("settings", "Settings…")
                .accelerator("CmdOrCtrl+,")
                .build(app)?,
        )
        .build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Pandoc Preview"),
            Some(AboutMetadata {
                name: Some("Pandoc Preview".into()),
                version: Some(env!("CARGO_PKG_VERSION").into()),
                comments: Some(
                    "Overleaf-style markdown editor with a pandoc preview backend".into(),
                ),
                ..Default::default()
            }),
        )?)
        .build()?;

    Menu::with_items(app, &[&file, &edit, &view, &tools, &help])
}

pub fn run() {
    // Argument parsing and the startup gate run BEFORE any Tauri builder work,
    // so a failed diagnostic never spawns a window.
    let args: Vec<String> = std::env::args().skip(1).collect();

    // Consumer 1: `--doctor` prints the full report to stdout and exits 0/1,
    // never creating a window.
    if args.iter().any(|a| a == "--doctor") {
        let report = doctor::run();
        print!("{}", report.render());
        std::process::exit(if report.all_ok() { 0 } else { 1 });
    }

    // Consumer 2: the startup gate. The battery runs before the builder; any
    // failure hard-fails with the report on stderr and a nonzero exit, before
    // any window is created.
    let report = doctor::run();
    if !report.all_ok() {
        eprint!("{}", report.render());
        std::process::exit(1);
    }

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init());

    // E2E proof bridge: present only in `e2e-testing` builds, never in a
    // user build. No behaviour change for normal users.
    #[cfg(feature = "e2e-testing")]
    {
        builder = builder.plugin(tauri_plugin_playwright::init_with_config(
            tauri_plugin_playwright::PluginConfig::new().socket_path(PLAYWRIGHT_SOCKET),
        ));
    }

    builder
        .invoke_handler(tauri::generate_handler![
            config::get_config,
            config::save_config,
            config::get_config_path,
            config::read_fold_state,
            config::save_fold_state,
            config::read_session_state,
            config::save_session_state,
            fsops::list_tree,
            fsops::read_text_file,
            fsops::write_text_file,
            fsops::write_text_file_checked,
            fsops::create_file,
            fsops::create_dir,
            fsops::rename_path,
            fsops::delete_path,
            render::render_preview,
            render::export_document,
            plugins::run_plugin,
            plugins::configure_plugin,
            clipboard::paste_clipboard_image,
            clipboard::seed_clipboard_image,
            recovery::recovery_autosave,
            recovery::recovery_head_buffer,
            repostate::repo_state_for,
            repostate::repo_init,
            repostate::repo_track,
        ])
        .setup(|app| {
            // Grant the playwright plugin's pw_result IPC permission, but only
            // in e2e builds and only at runtime — the user build's static
            // capability set is never touched. Without this, the eval-result
            // IPC is denied and every bridge eval times out.
            #[cfg(feature = "e2e-testing")]
            {
                use tauri::Manager;
                app.handle().add_capability(
                    r#"{
                        "identifier": "e2e-playwright",
                        "windows": ["main"],
                        "permissions": ["playwright:default"]
                    }"#,
                )?;
                // P62: the seedClipboardImage E2E hook puts a known image on the
                // REAL system clipboard via the clipboard-manager writeImage path.
                // That write is a TEST-ONLY affordance (a user never writes images
                // to the clipboard FROM the app), so the write-image permission is
                // granted only here, at runtime, in the e2e build — the user build's
                // static capability set grants only the paste action's read-image.
                app.handle().add_capability(
                    r#"{
                        "identifier": "e2e-clipboard-write-image",
                        "windows": ["main"],
                        "permissions": ["clipboard-manager:allow-write-image"]
                    }"#,
                )?;
            }

            // The startup gate already validated the config; load it to build the
            // Export menu from the configured [export.<id>] plugins.
            let cfg = config::load().expect("config validated by startup gate but failed to load");
            let menu = build_menu(app.handle(), &cfg)?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                // Forward every custom menu item to the webview by id.
                app.emit("menu", event.id().0.clone())
                    .expect("failed to emit menu event to webview");
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
