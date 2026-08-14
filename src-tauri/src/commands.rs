use base64::Engine;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};
use tauri_tray_base::TrayBaseState;

use crate::hotkeys;
use crate::logger;
use crate::runner;
use crate::shells;
use crate::state::{AppState, Macro};
use crate::store;
use crate::web_server;
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

pub fn settings_set_extra(app: &AppHandle, partial: Value) -> Result<Value, String> {
    let tray = app.state::<TrayBaseState>();
    settings_set(app.clone(), tray, partial)
}

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

    if partial.get("columns").is_some() || partial.get("rows").is_some() {
        let cols = partial
            .get("columns")
            .and_then(|v| v.as_u64())
            .unwrap_or(3) as u32;
        let rows = partial
            .get("rows")
            .and_then(|v| v.as_u64())
            .unwrap_or(2) as u32;
        let app_state = app.state::<AppState>();
        store::update_profile_grid(&app_state, cols, rows);
        store::broadcast_deck(&app, &app_state);
    }

    if partial.get("lanWebEnabled").is_some() || partial.get("lanWebPort").is_some() {
        if partial.get("lanWebEnabled").and_then(|v| v.as_bool()).unwrap_or(false) {
            let _token = web_server::ensure_token(&app);
        }
        web_server::sync_from_settings(&app);
    }

    tauri_tray_base::emit_to_renderer(&app, "settings:changed", next.clone());
    let _ = tauri_tray_base::rebuild_tray_menu(&app);
    Ok(next)
}

#[tauri::command]
pub fn cmddeck_get_state(app: AppHandle, state: State<'_, AppState>, tray: State<'_, TrayBaseState>) -> Value {
    let deck = store::deck_snapshot(&state);
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
        "deck": deck,
        "macros": deck.get("macros").cloned().unwrap_or(json!([])),
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

#[tauri::command]
pub fn macros_list(state: State<'_, AppState>) -> Value {
    store::decorate_macros(&store::macros_for_active_page(&state.deck.lock()))
}

#[tauri::command]
pub fn deck_get(state: State<'_, AppState>) -> Value {
    store::deck_snapshot(&state)
}

#[tauri::command]
pub fn deck_set_active_profile(app: AppHandle, state: State<'_, AppState>, profile_id: String, tray: State<'_, TrayBaseState>) -> Value {
    match store::set_active_profile(&state, &profile_id) {
        Some(profile) => {
            let partial = json!({ "columns": profile.columns, "rows": profile.rows });
            let _ = settings_set(app.clone(), tray, partial);
            store::broadcast_deck(&app, &state)
        }
        None => json!({ "ok": false }),
    }
}

#[tauri::command]
pub fn deck_set_active_page(app: AppHandle, state: State<'_, AppState>, page_id: String) -> Value {
    match store::set_active_page(&state, &page_id) {
        Some(_) => store::broadcast_deck(&app, &state),
        None => json!({ "ok": false }),
    }
}

#[tauri::command]
pub fn deck_add_profile(app: AppHandle, state: State<'_, AppState>, name: String) -> Value {
    match store::add_profile(&state, &name) {
        Some(_) => store::broadcast_deck(&app, &state),
        None => json!({ "ok": false }),
    }
}

#[tauri::command]
pub fn deck_add_page(app: AppHandle, state: State<'_, AppState>, name: String) -> Value {
    match store::add_page(&state, &name) {
        Some(_) => store::broadcast_deck(&app, &state),
        None => json!({ "ok": false }),
    }
}

#[tauri::command]
pub fn deck_delete_page(app: AppHandle, state: State<'_, AppState>, page_id: String) -> Value {
    if store::delete_page(&state, &page_id) {
        let _ = hotkeys::sync_hotkeys(&app);
        store::broadcast_deck(&app, &state)
    } else {
        json!({ "ok": false, "error": "Cannot delete the last page" })
    }
}

#[tauri::command]
pub fn deck_duplicate_profile(app: AppHandle, state: State<'_, AppState>, profile_id: String) -> Value {
    match store::duplicate_profile(&state, &profile_id) {
        Some(_) => {
            let _ = hotkeys::sync_hotkeys(&app);
            store::broadcast_deck(&app, &state)
        }
        None => json!({ "ok": false }),
    }
}

#[tauri::command]
pub fn packs_list(app: AppHandle) -> Value {
    store::list_builtin_packs(&app)
}

#[tauri::command]
pub fn packs_export(state: State<'_, AppState>, profile_id: Option<String>) -> Value {
    store::export_pack(&state, profile_id.as_deref())
}

#[tauri::command]
pub fn packs_import(app: AppHandle, state: State<'_, AppState>, pack: Value, mode: String) -> Value {
    match store::import_pack(&state, &pack, &mode) {
        Ok(result) => {
            let _ = hotkeys::sync_hotkeys(&app);
            store::broadcast_deck(&app, &state);
            result
        }
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub fn packs_import_file(app: AppHandle, state: State<'_, AppState>, path: String, mode: String) -> Value {
    match store::load_pack_file(&path) {
        Ok(pack) => packs_import(app, state, pack, mode),
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub fn packs_export_to_file(state: State<'_, AppState>, path: String, profile_id: Option<String>) -> Value {
    let pack = store::export_pack(&state, profile_id.as_deref());
    match std::fs::write(&path, serde_json::to_string_pretty(&pack).unwrap_or_default()) {
        Ok(_) => json!({ "ok": true, "path": path }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command]
pub fn lan_get_info(app: AppHandle, tray: State<'_, TrayBaseState>) -> Value {
    let token = web_server::ensure_token(&app);
    let settings = tray.settings.lock();
    let enabled = settings
        .extra
        .get("lanWebEnabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let port = settings
        .extra
        .get("lanWebPort")
        .and_then(|v| v.as_u64())
        .unwrap_or(8742);
    json!({ "enabled": enabled, "port": port, "token": token })
}

#[tauri::command]
pub fn macros_add(app: AppHandle, state: State<'_, AppState>, partial: Value) -> Value {
    store::add_macro(&state, &partial);
    let _ = hotkeys::sync_hotkeys(&app);
    store::broadcast_deck(&app, &state)
}

#[tauri::command]
pub fn macros_update(app: AppHandle, state: State<'_, AppState>, id: String, partial: Value) -> Value {
    match store::update_macro(&state, &id, &partial) {
        Some(_) => {
            let _ = hotkeys::sync_hotkeys(&app);
            store::broadcast_deck(&app, &state)
        }
        None => Value::Null,
    }
}

#[tauri::command]
pub fn macros_delete(app: AppHandle, state: State<'_, AppState>, id: String) -> Value {
    store::delete_macro(&state, &id);
    let _ = hotkeys::sync_hotkeys(&app);
    store::broadcast_deck(&app, &state)
}

#[tauri::command]
pub fn macros_reorder(app: AppHandle, state: State<'_, AppState>, ordered_ids: Vec<String>) -> Value {
    store::reorder_macros(&state, &ordered_ids);
    store::broadcast_deck(&app, &state)
}

fn confirm_run(app: &AppHandle, macro_: &Macro) -> bool {
    if !macro_.confirm_before_run {
        return true;
    }
    let msg = macro_
        .confirm_message
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or("Run this macro?");
    matches!(
        app.dialog()
            .message(msg)
            .title("CmdDeck")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Run".into(),
                "Cancel".into()
            ))
            .blocking_show_with_result(),
        MessageDialogResult::Custom(ref s) if s == "Run"
    )
}

pub fn run_macro_now(app: &AppHandle, id: &str) -> Value {
    let state = app.state::<AppState>();
    let Some(macro_) = store::find_macro(&state, id) else {
        return json!({ "ok": false, "error": "Macro not found." });
    };

    if !confirm_run(app, &macro_) {
        return json!({ "ok": false, "error": "Cancelled." });
    }

    match runner::run_macro(app, &macro_) {
        Ok(outcome) => {
            if macro_.show_terminal && outcome.pid > 0 {
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

pub fn run_macro_by_id(app: &AppHandle, id: &str) -> Value {
    let state = app.state::<AppState>();
    let Some(macro_) = store::find_macro(&state, id) else {
        return json!({ "ok": false, "error": "Macro not found." });
    };

    {
        let running = state.running.lock();
        let pending = state.pending_starts.lock();
        if running.contains_key(id) || pending.contains(id) {
            return json!({ "ok": false, "error": "Already running." });
        }
    }

    state.pending_starts.lock().insert(id.to_string());

    let pending_status = json!({
        "id": id, "status": "running", "name": macro_.name, "command": macro_.command,
        "showTerminal": macro_.show_terminal, "pending": true
    });
    runner::log_macro_status(app, &pending_status);
    let _ = app.emit("macros:status", pending_status);

    if !state.pending_starts.lock().remove(id) {
        return json!({ "ok": false, "error": "Cancelled." });
    }

    run_macro_now(app, id)
}

#[tauri::command]
pub fn macros_run(app: AppHandle, state: State<'_, AppState>, id: String) -> Value {
    let Some(macro_) = store::find_macro(&state, &id) else {
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
            if error != "Cancelled." {
                let fail_status = json!({ "id": id2, "status": "error", "error": error, "showTerminal": show_terminal });
                runner::log_macro_status(&app2, &fail_status);
                let _ = app2.emit("macros:status", fail_status);
                let _ = app2.emit("macros:toast", json!({ "message": error, "error": true }));
            }
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

#[tauri::command]
pub fn terminal_bootstrap(state: State<'_, AppState>, id: String) -> Value {
    if let Some(entry) = state.running.lock().get(&id) {
        let e = entry.lock();
        return json!({
            "id": id, "status": "running", "name": e.name, "command": e.command,
            "pid": e.pid, "stdout": e.stdout, "stderr": e.stderr
        });
    }
    match store::find_macro(&state, &id) {
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

#[tauri::command]
pub fn ui_get_editor_init(state: State<'_, AppState>, macro_id: Option<String>) -> Value {
    let shells_list = shells::detect_shells();
    let shells_json: Vec<shells::ShellSummary> = shells_list.iter().map(Into::into).collect();
    let macro_json = macro_id.as_deref().and_then(|id| store::find_macro(&state, id)).map(|m| {
        json!({
            "id": m.id, "command": m.command, "name": m.name, "cwd": m.cwd,
            "imagePath": m.image_path, "showTerminal": m.show_terminal, "shell": m.shell,
            "confirmBeforeRun": m.confirm_before_run, "confirmMessage": m.confirm_message,
            "shortcut": m.shortcut, "actionType": m.action_type, "env": m.env,
            "sshHost": m.ssh_host, "sshUser": m.ssh_user, "sshKeyPath": m.ssh_key_path, "sshPort": m.ssh_port,
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

#[tauri::command]
pub fn ui_macro_context_menu(app: AppHandle, window: WebviewWindow, state: State<'_, AppState>, id: String) -> Value {
    if store::find_macro(&state, &id).is_none() {
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

#[tauri::command]
pub fn log_get(app: AppHandle) -> Value {
    json!(logger::get_logs(&app))
}

#[tauri::command]
pub fn log_clear(app: AppHandle) -> Value {
    logger::clear_logs(&app);
    json!({ "ok": true })
}

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
pub fn dialog_pick_pack(window: WebviewWindow) -> Value {
    let picked = window
        .dialog()
        .file()
        .add_filter("CmdDeck Pack", &["json"])
        .blocking_pick_file();
    let Some(picked) = picked else {
        return Value::Null;
    };
    match picked.into_path() {
        Ok(path) => json!(path.to_string_lossy().to_string()),
        Err(_) => Value::Null,
    }
}

#[tauri::command]
pub fn dialog_save_pack(window: WebviewWindow, suggested_name: String) -> Value {
    let picked = window
        .dialog()
        .file()
        .set_file_name(&format!("{suggested_name}.cmddeck-pack.json"))
        .add_filter("CmdDeck Pack", &["json"])
        .blocking_save_file();
    let Some(picked) = picked else {
        return Value::Null;
    };
    match picked.into_path() {
        Ok(path) => json!(path.to_string_lossy().to_string()),
        Err(_) => Value::Null,
    }
}

#[tauri::command]
pub fn shell_show_item(path: String) -> Value {
    if std::path::Path::new(&path).exists() {
        let _ = tauri_plugin_opener::reveal_item_in_dir(&path);
    }
    Value::Null
}

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
