use std::path::Path;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::state::{AppState, Macro};

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn load_macros(path: &Path) -> Vec<Macro> {
    if let Ok(raw) = std::fs::read_to_string(path) {
        if let Ok(macros) = serde_json::from_str::<Vec<Macro>>(&raw) {
            return macros;
        }
    }
    Vec::new()
}

pub fn save_macros(path: &Path, macros: &[Macro]) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string_pretty(macros) {
        let _ = std::fs::write(path, text);
    }
}

fn str_field(partial: &Value, key: &str) -> Option<String> {
    partial.get(key).and_then(|v| v.as_str()).map(|s| s.trim().to_string())
}

pub fn add_macro(state: &AppState, partial: &Value) -> Macro {
    let now = now_ms();
    let macro_ = Macro {
        id: uuid::Uuid::new_v4().to_string(),
        command: str_field(partial, "command").unwrap_or_default(),
        name: str_field(partial, "name").unwrap_or_default(),
        image_path: partial
            .get("imagePath")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        cwd: str_field(partial, "cwd").filter(|s| !s.is_empty()),
        show_terminal: partial
            .get("showTerminal")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        shell: str_field(partial, "shell")
            .or_else(|| str_field(partial, "terminalApp"))
            .filter(|s| !s.is_empty()),
        created_at: now,
        updated_at: now,
    };

    let mut macros = state.macros.lock();
    macros.push(macro_.clone());
    save_macros(&state.macros_path, &macros);
    macro_
}

pub fn update_macro(state: &AppState, id: &str, partial: &Value) -> Option<Macro> {
    let mut macros = state.macros.lock();
    let index = macros.iter().position(|m| m.id == id)?;
    let existing = macros[index].clone();

    let updated = Macro {
        id: existing.id,
        command: str_field(partial, "command").unwrap_or(existing.command),
        name: str_field(partial, "name").unwrap_or(existing.name),
        image_path: match partial.get("imagePath") {
            Some(Value::Null) => None,
            Some(Value::String(s)) => Some(s.clone()),
            _ => existing.image_path,
        },
        cwd: if partial.get("cwd").is_some() {
            str_field(partial, "cwd").filter(|s| !s.is_empty())
        } else {
            existing.cwd
        },
        show_terminal: partial
            .get("showTerminal")
            .and_then(|v| v.as_bool())
            .unwrap_or(existing.show_terminal),
        shell: if partial.get("shell").is_some() {
            str_field(partial, "shell").filter(|s| !s.is_empty())
        } else {
            existing.shell
        },
        created_at: existing.created_at,
        updated_at: now_ms(),
    };

    macros[index] = updated.clone();
    save_macros(&state.macros_path, &macros);
    Some(updated)
}

pub fn delete_macro(state: &AppState, id: &str) {
    let mut macros = state.macros.lock();
    macros.retain(|m| m.id != id);
    save_macros(&state.macros_path, &macros);
}

pub fn reorder_macros(state: &AppState, ordered_ids: &[String]) {
    let mut macros = state.macros.lock();
    let mut by_id: std::collections::HashMap<String, Macro> =
        macros.drain(..).map(|m| (m.id.clone(), m)).collect();

    let mut next: Vec<Macro> = Vec::new();
    for id in ordered_ids {
        if let Some(m) = by_id.remove(id) {
            next.push(m);
        }
    }
    // Anything not mentioned in the incoming order keeps its place at the end.
    next.extend(by_id.into_values());

    *macros = next;
    save_macros(&state.macros_path, &macros);
}

pub fn move_macro(state: &AppState, id: &str, direction: i32) {
    let mut macros = state.macros.lock();
    let Some(index) = macros.iter().position(|m| m.id == id) else {
        return;
    };
    let target = index as i32 + direction;
    if target < 0 || target as usize >= macros.len() {
        return;
    }
    let item = macros.remove(index);
    macros.insert(target as usize, item);
    save_macros(&state.macros_path, &macros);
}

pub fn duplicate_macro(state: &AppState, id: &str) -> Option<Macro> {
    let existing = {
        let macros = state.macros.lock();
        macros.iter().find(|m| m.id == id).cloned()?
    };
    let name = existing.name.trim();
    let partial = json!({
        "command": existing.command,
        "name": if name.is_empty() { "".to_string() } else { format!("{name} copy") },
        "imagePath": existing.image_path,
        "cwd": existing.cwd,
        "showTerminal": existing.show_terminal,
        "shell": existing.shell,
    });
    Some(add_macro(state, &partial))
}

/// Macro shape sent to the renderer: same fields, `imageUrl` mirrors `imagePath`
/// (already a `data:` URI or null) for compatibility with the existing UI code.
pub fn decorate_macro(m: &Macro) -> Value {
    let mut value = serde_json::to_value(m).unwrap_or(json!({}));
    if let Some(obj) = value.as_object_mut() {
        obj.insert("imageUrl".into(), json!(m.image_path));
    }
    value
}

pub fn decorate_macros(macros: &[Macro]) -> Value {
    json!(macros.iter().map(decorate_macro).collect::<Vec<_>>())
}

pub fn broadcast_macros(app: &AppHandle, state: &AppState) -> Value {
    let macros = state.macros.lock().clone();
    let decorated = decorate_macros(&macros);
    let _ = app.emit("macros:changed", decorated.clone());
    decorated
}
