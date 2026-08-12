use base64::Engine;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};
use tauri_tray_base::TrayBaseState;

use crate::logger;
use crate::runner;
use crate::shells;
use crate::state::AppState;
use crate::store;
use crate::windows;

fn get_setting_bool(state: &TrayBaseState, key: &str, default: bool) -> bool {
    state
        .settings
        .lock()
        .extra
        .get(key)
        .and_then(|v| v.as_bool())
        .unwrap_or(default)
}

// ---------------------------------------------------------------------------
// Settings (extends tauri_tray_base's generic settings with CmdDeck side-effects)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn settings_set(
    app: AppHandle,
    state: State<'_, TrayBaseState>,
    partial: Value,
) -> Result<Value, String> {
    let next = {
        let mut settings = state.settings.lock();
        settings.merge_partial(&partial);
        let _ = tauri_tray_base::save_settings(&state.settings_path, &settings);
        settings.to_value()
    };

    if partial.get("alwaysOnTop").is_some() {
        let aot = state.settings.lock().always_on_top;
        tauri_tray_base::apply_always_on_top(&app, aot);
        windows::set_aux_always_on_top(&app, aot);
    }
    if partial.get("opacity").is_some() {
        let opacity = state.settings.lock().opacity;
        tauri_tray_base::apply_opacity(&app, opacity);
    }
    if partial.get("startMinimised").is_some() {
        tauri_tray_base::sync_autostart(&app);
    }
    if partial.get("sizeLocked").is_some() {
        if let Some(main) = app.get_webview_window(tauri_tray_base::MAIN_WINDOW_LABEL) {
            let locked = get_setting_bool(&state, "sizeLocked", false);
            let _ = main.set_resizable(!locked);
        }
    }

    tauri_tray_base::emit_to_renderer(&app, "settings:changed", next.clone());
    let _ = tauri_tray_base::rebuild_tray_menu(&app);
    Ok(next)
}

// ---------------------------------------------------------------------------
// App / shells
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cmddeck_get_state(app: AppHandle, state: State<'_, AppState>, tray: State<'_, TrayBaseState>) -> Value {
    let macros = store::decorate_macros(&state.macros.lock());
    let settings = tray.settings.lock().to_value();
    let running_ids: Vec<String> = state.running.lock().keys().cloned().collect();
    let shells_list = shells::detect_shells();
    let shells_json: Vec<shells::ShellSummary> = shells_list.iter().map(Into::into).collect();
    let default_shell = shells::default_shell_id(&shells_list);
    let dark = app
        .get_webview_window(tauri_tray_base::MAIN_WINDOW_LABEL)
        .and_then(|w| w.theme().ok())
        .map(|t| t == tauri::Theme::Dark)
        .unwrap_or(false);

    json!({
        "macros": macros,
        "settings": settings,
        "runningIds": running_ids,
        "shells": shells_json,
        "defaultShell": default_shell,
        "platform": std::env::consts::OS,
        "version": app.package_info().version.to_string(),
        "dark": dark,
    })
}

#[tauri::command]
pub fn shells_list() -> Value {
    let shells_list = shells::detect_shells();
    let shells_json: Vec<shells::ShellSummary> = shells_list.iter().map(Into::into).collect();
    json!({
        "shells": shells_json,
        "defaultShell": shells::default_shell_id(&shells_list),
    })
}

// ---------------------------------------------------------------------------
// Macros CRUD
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn macros_list(state: State<'_, AppState>) -> Value {
    store::decorate_macros(&state.macros.lock())
}

#[tauri::command]
pub fn macros_add(app: AppHandle, state: State<'_, AppState>, partial: Value) -> Value {
    store::add_macro(&state, &partial);
    store::broadcast_macros(&app, &state)
}

#[tauri::command]
pub fn macros_update(app: AppHandle, state: State<'_, AppState>, id: String, partial: Value) -> Value {
    match store::update_macro(&state, &id, &partial) {
        Some(_) => store::broadcast_macros(&app, &state),
        None => Value::Null,
    }
}

#[tauri::command]
pub fn macros_delete(app: AppHandle, state: State<'_, AppState>, id: String) -> Value {
    store::delete_macro(&state, &id);
    store::broadcast_macros(&app, &state)
}

#[tauri::command]
pub fn macros_reorder(app: AppHandle, state: State<'_, AppState>, ordered_ids: Vec<String>) -> Value {
    store::reorder_macros(&state, &ordered_ids);
    store::broadcast_macros(&app, &state)
}

// ---------------------------------------------------------------------------
// Run / stop
// ---------------------------------------------------------------------------

fn find_macro(state: &AppState, id: &str) -> Option<crate::state::Macro> {
    state.macros.lock().iter().find(|m| m.id == id).cloned()
}

fn run_macro_now(app: &AppHandle, id: &str) -> Value {
    let state = app.state::<AppState>();
    let Some(macro_) = find_macro(&state, id) else {
        return json!({ "ok": false, "error": "Macro not found." });
    };

    match runner::run_macro(app, &macro_) {
        Ok(outcome) => {
            if macro_.show_terminal {
                windows::open_terminal_window(app, &macro_.id, &macro_.name, &macro_.command);
                let running_state = state.running.lock();
                if let Some(entry) = running_state.get(&macro_.id) {
                    let e = entry.lock();
                    let _ = app.emit_to(
                        format!("terminal-{}", macro_.id),
                        "terminal:init",
                        json!({
                            "id": macro_.id, "name": macro_.name, "command": macro_.command,
                            "pid": e.pid, "stdout": e.stdout, "stderr": e.stderr, "startedAt": e.started_at
                        }),
                    );
                }
            }
            json!({ "ok": true, "pid": outcome.pid, "showTerminal": macro_.show_terminal, "shell": outcome.shell_id })
        }
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

#[tauri::command]
pub fn macros_run(app: AppHandle, state: State<'_, AppState>, id: String) -> Value {
    let Some(macro_) = find_macro(&state, &id) else {
        return json!({ "ok": false, "error": "Macro not found." });
    };

    {
        let running = state.running.lock();
        let pending = state.pending_starts.lock();
        if running.contains_key(&id) || pending.contains(&id) {
            return json!({ "ok": false, "error": "Already running." });
        }
    }

    state.pending_starts.lock().insert(id.clone());

    let pending_status = json!({
        "id": id, "status": "running", "name": macro_.name, "command": macro_.command,
        "showTerminal": macro_.show_terminal, "pending": true
    });
    runner::log_macro_status(&app, &pending_status);
    let _ = app.emit("macros:status", pending_status);

    let app2 = app.clone();
    let id2 = id.clone();
    let show_terminal = macro_.show_terminal;
    std::thread::spawn(move || {
        let state2 = app2.state::<AppState>();
        if !state2.pending_starts.lock().remove(&id2) {
            return;
        }
        let result = run_macro_now(&app2, &id2);
        if !result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
            let error = result
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Failed to run")
                .to_string();
            let fail_status = json!({ "id": id2, "status": "error", "error": error, "showTerminal": show_terminal });
            runner::log_macro_status(&app2, &fail_status);
            let _ = app2.emit("macros:status", fail_status);
            let _ = app2.emit("macros:toast", json!({ "message": error, "error": true }));
        }
    });

    json!({ "ok": true, "queued": true })
}

#[tauri::command]
pub fn macros_stop(app: AppHandle, state: State<'_, AppState>, id: String) -> Value {
    let was_pending = state.pending_starts.lock().remove(&id);
    let result = runner::stop_macro(&app, &id);
    if was_pending && !state.running.lock().contains_key(&id) {
        let stopped = json!({ "id": id, "status": "stopped" });
        runner::log_macro_status(&app, &stopped);
        let _ = app.emit("macros:status", stopped);
        return json!({ "ok": true });
    }
    result
}

// ---------------------------------------------------------------------------
// Terminal windows
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn terminal_bootstrap(state: State<'_, AppState>, id: String) -> Value {
    if let Some(entry) = state.running.lock().get(&id) {
        let e = entry.lock();
        return json!({
            "id": id, "status": "running", "name": e.name, "command": e.command,
            "pid": e.pid, "stdout": e.stdout, "stderr": e.stderr
        });
    }
    match find_macro(&state, &id) {
        Some(m) => json!({
            "id": id, "status": "error", "name": m.name, "command": m.command,
            "error": "No active command."
        }),
        None => Value::Null,
    }
}

#[tauri::command]
pub fn terminal_close(app: AppHandle, state: State<'_, AppState>, id: String) -> Value {
    if state.running.lock().contains_key(&id) {
        runner::stop_macro(&app, &id);
    }
    windows::close_terminal_window(&app, &id);
    json!({ "ok": true })
}

// ---------------------------------------------------------------------------
// Editor / settings / log windows
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn ui_get_editor_init(state: State<'_, AppState>, macro_id: Option<String>) -> Value {
    let shells_list = shells::detect_shells();
    let shells_json: Vec<shells::ShellSummary> = shells_list.iter().map(Into::into).collect();
    let macro_json = macro_id.as_deref().and_then(|id| find_macro(&state, id)).map(|m| {
        json!({
            "id": m.id, "command": m.command, "name": m.name, "cwd": m.cwd,
            "imagePath": m.image_path, "showTerminal": m.show_terminal, "shell": m.shell,
        })
    });

    json!({
        "shells": shells_json,
        "defaultShell": shells::default_shell_id(&shells_list),
        "platform": std::env::consts::OS,
        "dark": false,
        "macro": macro_json,
    })
}

#[tauri::command]
pub fn ui_open_editor(app: AppHandle, id: Option<String>) -> Value {
    windows::open_editor_window(&app, id);
    json!({ "ok": true })
}

#[tauri::command]
pub fn ui_open_settings(app: AppHandle) -> Value {
    windows::open_settings_window(&app);
    json!({ "ok": true })
}

#[tauri::command]
pub fn ui_open_log(app: AppHandle) -> Value {
    windows::open_log_window(&app);
    json!({ "ok": true })
}

// ---------------------------------------------------------------------------
// Macro context menu (right-click on a pad button)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn ui_macro_context_menu(app: AppHandle, window: WebviewWindow, state: State<'_, AppState>, id: String) -> Value {
    if find_macro(&state, &id).is_none() {
        return json!({ "ok": false });
    }
    match crate::menu::build_macro_menu(&app, &state, &id) {
        Ok(menu) => {
            let _ = window.popup_menu(&menu);
            json!({ "ok": true })
        }
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn log_get(app: AppHandle) -> Value {
    json!(logger::get_logs(&app))
}

#[tauri::command]
pub fn log_clear(app: AppHandle) -> Value {
    logger::clear_logs(&app);
    json!({ "ok": true })
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS: [&str; 8] = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"];

fn mime_for_extension(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        _ => "image/png",
    }
}

/// Button images are embedded as `data:` URIs (Tauri webviews cannot load
/// arbitrary `file://` paths without extra asset-protocol scoping), so the
/// existing renderer's `toFileUrl()` helper works unchanged.
#[tauri::command]
pub fn dialog_pick_image(window: WebviewWindow) -> Value {
    let picked = window
        .dialog()
        .file()
        .add_filter("Images", &IMAGE_EXTENSIONS)
        .blocking_pick_file();

    let Some(picked) = picked else {
        return Value::Null;
    };
    let Ok(path) = picked.into_path() else {
        return json!({ "error": "Unsupported file location." });
    };

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return json!({ "error": "Unsupported image type." });
    }

    match std::fs::read(&path) {
        Ok(bytes) => {
            let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
            json!(format!("data:{};base64,{}", mime_for_extension(&ext), encoded))
        }
        Err(e) => json!({ "error": e.to_string() }),
    }
}

#[tauri::command]
pub fn dialog_pick_folder(window: WebviewWindow) -> Value {
    match window.dialog().file().blocking_pick_folder() {
        Some(folder) => match folder.into_path() {
            Ok(path) => json!(path.to_string_lossy().to_string()),
            Err(_) => Value::Null,
        },
        None => Value::Null,
    }
}

#[tauri::command]
pub fn shell_show_item(path: String) -> Value {
    if std::path::Path::new(&path).exists() {
        let _ = tauri_plugin_opener::reveal_item_in_dir(&path);
    }
    Value::Null
}

// Re-exported so `menu.rs` can build the same confirm dialog as `dialog_pick_image`.
pub(crate) fn confirm_delete(app: &AppHandle, message: &str) -> bool {
    matches!(
        app.dialog()
            .message(message)
            .title("CmdDeck")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Delete".into(),
                "Cancel".into()
            ))
            .blocking_show_with_result(),
        MessageDialogResult::Custom(ref s) if s == "Delete"
    )
}
