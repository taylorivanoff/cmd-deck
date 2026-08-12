use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Manager, Wry};

use crate::commands::confirm_delete;
use crate::state::AppState;
use crate::{runner, store, windows};

const PREFIX: &str = "macro-menu:";

/// Build the right-click menu for a single macro pad button (Run/Stop, Edit,
/// Duplicate, Move Left/Right, Delete), mirroring Electron's
/// `popupMacroContextMenu` in `main/app-ipc.js`.
pub fn build_macro_menu(app: &AppHandle, state: &AppState, id: &str) -> tauri::Result<Menu<Wry>> {
    let is_running = state.running.lock().contains_key(id);
    let macros = state.macros.lock();
    let index = macros.iter().position(|m| m.id == id).unwrap_or(0);
    let last = macros.len().saturating_sub(1);

    let run_label = if is_running { "Stop" } else { "Run" };
    let run_item = MenuItem::with_id(app, format!("{PREFIX}run:{id}"), run_label, true, None::<&str>)?;
    let edit_item = MenuItem::with_id(app, format!("{PREFIX}edit:{id}"), "Edit", true, None::<&str>)?;
    let duplicate_item = MenuItem::with_id(app, format!("{PREFIX}duplicate:{id}"), "Duplicate", true, None::<&str>)?;
    let move_left = MenuItem::with_id(
        app,
        format!("{PREFIX}move-left:{id}"),
        "Move Left",
        index > 0,
        None::<&str>,
    )?;
    let move_right = MenuItem::with_id(
        app,
        format!("{PREFIX}move-right:{id}"),
        "Move Right",
        index < last,
        None::<&str>,
    )?;
    let delete_item = MenuItem::with_id(app, format!("{PREFIX}delete:{id}"), "Delete", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &run_item,
            &PredefinedMenuItem::separator(app)?,
            &edit_item,
            &duplicate_item,
            &move_left,
            &move_right,
            &PredefinedMenuItem::separator(app)?,
            &delete_item,
        ],
    )
}

/// Dispatch a `macro-menu:<action>:<id>` menu event id from `build_macro_menu`.
pub fn handle_macro_menu_event(app: &AppHandle, raw_id: &str) {
    let Some(rest) = raw_id.strip_prefix(PREFIX) else {
        return;
    };
    let Some((action, id)) = rest.split_once(':') else {
        return;
    };
    let id = id.to_string();
    let state = app.state::<AppState>();

    match action {
        "run" => {
            if state.running.lock().contains_key(&id) {
                runner::stop_macro(app, &id);
            } else {
                let _ = crate::commands::macros_run(app.clone(), state, id);
            }
        }
        "edit" => windows::open_editor_window(app, Some(id)),
        "duplicate" => {
            if store::duplicate_macro(&state, &id).is_some() {
                store::broadcast_macros(app, &state);
            }
        }
        "move-left" => {
            store::move_macro(&state, &id, -1);
            store::broadcast_macros(app, &state);
        }
        "move-right" => {
            store::move_macro(&state, &id, 1);
            store::broadcast_macros(app, &state);
        }
        "delete" => {
            let macro_ = state.macros.lock().iter().find(|m| m.id == id).cloned();
            let Some(macro_) = macro_ else { return };
            let detail = {
                let name = macro_.name.trim();
                if !name.is_empty() {
                    name.to_string()
                } else {
                    macro_.command.trim().to_string()
                }
            };
            let message = if detail.is_empty() {
                "Delete this macro?".to_string()
            } else {
                format!("Delete this macro?\n\n{detail}")
            };

            let app2 = app.clone();
            std::thread::spawn(move || {
                if !confirm_delete(&app2, &message) {
                    return;
                }
                let state2 = app2.state::<AppState>();
                if state2.running.lock().contains_key(&id) {
                    runner::stop_macro(&app2, &id);
                }
                store::delete_macro(&state2, &id);
                store::broadcast_macros(&app2, &state2);
            });
        }
        _ => {}
    }
}

/// Wired into `App::on_menu_event` in `lib.rs` for window-scoped (non-tray) menus.
pub fn on_menu_event(app: &AppHandle, id: &str) {
    if id.starts_with(PREFIX) {
        handle_macro_menu_event(app, id);
    }
}
