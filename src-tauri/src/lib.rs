mod commands;
mod hotkeys;
mod logger;
mod menu;
mod path_env;
mod runner;
mod shells;
mod ssh_runner;
mod state;
mod store;
mod variables;
mod web_server;
mod windows;

use std::collections::HashMap;

use serde_json::json;
use tauri::{Listener, Manager};
use tauri_tray_base::{
    apply_window_settings, install_state, setup_tray, sync_autostart, TrayBaseOptions,
    TrayExtraItem, TraySetupOptions,
};

use state::AppState;
use store::load_deck;

const APP_NAME: &str = "CmdDeck";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri_tray_base::with_common_plugins(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            tauri_tray_base::settings_get,
            commands::settings_set,
            commands::cmddeck_get_state,
            commands::shells_list,
            commands::deck_get,
            commands::deck_set_active_profile,
            commands::deck_set_active_page,
            commands::deck_add_profile,
            commands::deck_add_page,
            commands::deck_duplicate_profile,
            commands::packs_list,
            commands::packs_export,
            commands::packs_export_to_file,
            commands::packs_import,
            commands::packs_import_file,
            commands::lan_get_info,
            commands::macros_list,
            commands::macros_add,
            commands::macros_update,
            commands::macros_delete,
            commands::macros_reorder,
            commands::macros_run,
            commands::macros_stop,
            commands::ui_macro_context_menu,
            commands::terminal_bootstrap,
            commands::terminal_close,
            commands::ui_get_editor_init,
            commands::ui_open_editor,
            commands::ui_open_settings,
            commands::ui_open_log,
            commands::log_get,
            commands::log_clear,
            commands::dialog_pick_image,
            commands::dialog_pick_folder,
            commands::dialog_pick_pack,
            commands::dialog_save_pack,
            commands::shell_show_item,
        ])
        .setup(move |app| {
            let mut defaults = HashMap::new();
            defaults.insert("opacity".into(), json!(1.0));
            defaults.insert("alwaysOnTop".into(), json!(true));
            defaults.insert("startMinimised".into(), json!(false));
            defaults.insert("columns".into(), json!(3));
            defaults.insert("rows".into(), json!(1));
            defaults.insert("sizeLocked".into(), json!(false));
            defaults.insert("lanWebEnabled".into(), json!(false));
            defaults.insert("lanWebPort".into(), json!(8742));

            install_state(
                app.handle(),
                TrayBaseOptions {
                    app_name: APP_NAME.into(),
                    settings_file_name: "cmd-deck-settings.json".into(),
                    defaults,
                    extra_tray_items: vec![TrayExtraItem {
                        id: "refresh-path".into(),
                        label: "Reload PATH".into(),
                    }],
                    ..Default::default()
                },
            )?;

            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| ".".into()));
            let _ = std::fs::create_dir_all(&data_dir);
            let deck_path = data_dir.join("macros.json");
            let deck = load_deck(&deck_path);
            app.manage(AppState::new(deck_path, deck));
            app.manage(web_server::WebServerState::new());

            setup_tray(app.handle(), TraySetupOptions::default())?;
            apply_window_settings(app.handle());
            sync_autostart(app.handle());
            hotkeys::init(app.handle());
            web_server::sync_from_settings(app.handle());

            let handle_for_quit = app.handle().clone();
            tauri_tray_base::set_on_before_quit(app.handle(), move || {
                let handle = handle_for_quit.clone();
                let _ = handle_for_quit.run_on_main_thread(move || {
                    web_server::stop(&handle);
                    windows::close_all_aux_windows(&handle);
                });
            });

            let handle = app.handle().clone();
            app.listen("tray:action", move |event| {
                let action = event.payload().trim_matches('"');
                if action == "refresh-path" {
                    logger::add_log(&handle, "info", "Reloaded PATH and shell detection", None);
                }
            });

            if let Some(main) = app.get_webview_window(tauri_tray_base::MAIN_WINDOW_LABEL) {
                let locked = app
                    .try_state::<tauri_tray_base::TrayBaseState>()
                    .map(|s| {
                        s.settings
                            .lock()
                            .extra
                            .get("sizeLocked")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false)
                    })
                    .unwrap_or(false);
                let _ = main.set_resizable(!locked);
            }

            logger::add_log(app.handle(), "info", &format!("{APP_NAME} ready"), None);

            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::on_menu_event(app, event.id.as_ref());
        })
        .on_window_event(|window, event| {
            tauri_tray_base::on_window_event(window, event);
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running cmd-deck");
}
