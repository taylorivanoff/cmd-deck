mod commands;
mod logger;
mod menu;
mod runner;
mod shells;
mod state;
mod store;
mod windows;

use std::collections::HashMap;

use serde_json::json;
use tauri::{Listener, Manager};
use tauri_tray_base::{
    apply_window_settings, install_state, setup_tray, sync_autostart, TrayBaseOptions,
    TrayExtraItem, TraySetupOptions,
};

use state::AppState;

const APP_NAME: &str = "CmdDeck";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri_tray_base::with_common_plugins(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            tauri_tray_base::settings_get,
            commands::settings_set,
            commands::cmddeck_get_state,
            commands::shells_list,
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
            let macros_path = data_dir.join("macros.json");
            let macros = store::load_macros(&macros_path);
            app.manage(AppState::new(macros_path, macros));

            setup_tray(app.handle(), TraySetupOptions::default())?;
            apply_window_settings(app.handle());
            sync_autostart(app.handle());

            let handle_for_quit = app.handle().clone();
            tauri_tray_base::set_on_before_quit(app.handle(), move || {
                // Window teardown must happen on the main thread; the hook itself
                // runs on a worker thread (see tauri-tray-base's `request_quit`).
                let handle = handle_for_quit.clone();
                let _ = handle_for_quit.run_on_main_thread(move || {
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
