mod config;
mod error;
mod fsops;
mod render;

use tauri::menu::{AboutMetadata, Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

/// Stable Unix socket path for the in-app Playwright bridge (e2e-testing
/// builds only). Must equal `mcpSocket` in tests/proof/fixtures.ts; the
/// proof orchestrator removes any stale socket before each app launch.
#[cfg(feature = "e2e-testing")]
pub const PLAYWRIGHT_SOCKET: &str = "/tmp/pandoc-preview-playwright.sock";

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let file = SubmenuBuilder::new(app, "File")
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
        .separator()
        .item(&MenuItemBuilder::with_id("export_html", "Export HTML…").build(app)?)
        .item(&MenuItemBuilder::with_id("export_pdf", "Export PDF…").build(app)?)
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
            fsops::list_tree,
            fsops::read_text_file,
            fsops::write_text_file,
            fsops::create_file,
            fsops::create_dir,
            fsops::rename_path,
            fsops::delete_path,
            render::render_preview,
            render::export_document,
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
            }

            let menu = build_menu(app.handle())?;
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
