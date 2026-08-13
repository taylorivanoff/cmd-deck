use std::collections::HashSet;
use std::path::Path;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::state::{AppState, DeckStore, Macro, Page, Profile};

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn migrate_from_legacy(raw: &str) -> DeckStore {
    if let Ok(deck) = serde_json::from_str::<DeckStore>(raw) {
        if deck.version >= 2 && !deck.profiles.is_empty() {
            return deck;
        }
    }

    let legacy_macros: Vec<Macro> = if let Ok(macros) = serde_json::from_str::<Vec<Macro>>(raw) {
        macros
    } else if let Ok(mut deck) = serde_json::from_str::<DeckStore>(raw) {
        if deck.profiles.is_empty() && !deck.macros.is_empty() {
            deck.version = 2;
            let profile_id = new_id();
            let page_id = new_id();
            deck.active_profile_id = profile_id.clone();
            deck.profiles = vec![Profile {
                id: profile_id,
                name: "Default".into(),
                columns: 3,
                rows: 1,
                active_page_id: page_id.clone(),
                pages: vec![Page {
                    id: page_id,
                    name: "Page 1".into(),
                    macro_ids: deck.macros.iter().map(|m| m.id.clone()).collect(),
                }],
            }];
        }
        return deck;
    } else {
        Vec::new()
    };

    let profile_id = new_id();
    let page_id = new_id();
    DeckStore {
        version: 2,
        active_profile_id: profile_id.clone(),
        macros: legacy_macros.clone(),
        profiles: vec![Profile {
            id: profile_id,
            name: "Default".into(),
            columns: 3,
            rows: 1,
            active_page_id: page_id.clone(),
            pages: vec![Page {
                id: page_id,
                name: "Page 1".into(),
                macro_ids: legacy_macros.iter().map(|m| m.id.clone()).collect(),
            }],
        }],
    }
}

pub fn load_deck(path: &Path) -> DeckStore {
    if let Ok(raw) = std::fs::read_to_string(path) {
        return migrate_from_legacy(&raw);
    }
    let profile_id = new_id();
    let page_id = new_id();
    DeckStore {
        version: 2,
        active_profile_id: profile_id.clone(),
        macros: Vec::new(),
        profiles: vec![Profile {
            id: profile_id,
            name: "Default".into(),
            columns: 3,
            rows: 1,
            active_page_id: page_id.clone(),
            pages: vec![Page {
                id: page_id,
                name: "Page 1".into(),
                macro_ids: Vec::new(),
            }],
        }],
    }
}

pub fn save_deck(path: &Path, deck: &DeckStore) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string_pretty(deck) {
        let _ = std::fs::write(path, text);
    }
}

fn str_field(partial: &Value, key: &str) -> Option<String> {
    partial
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
}

fn bool_field(partial: &Value, key: &str, default: bool) -> bool {
    partial
        .get(key)
        .and_then(|v| v.as_bool())
        .unwrap_or(default)
}

fn env_field(partial: &Value) -> std::collections::HashMap<String, String> {
    partial
        .get("env")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

fn macro_from_partial(partial: &Value, existing: Option<&Macro>) -> Macro {
    let now = now_ms();
    Macro {
        id: existing.map(|e| e.id.clone()).unwrap_or_else(new_id),
        command: str_field(partial, "command").unwrap_or_else(|| {
            existing.map(|e| e.command.clone()).unwrap_or_default()
        }),
        name: str_field(partial, "name").unwrap_or_else(|| {
            existing.map(|e| e.name.clone()).unwrap_or_default()
        }),
        image_path: match partial.get("imagePath") {
            Some(Value::Null) => None,
            Some(Value::String(s)) => Some(s.clone()),
            _ => existing.and_then(|e| e.image_path.clone()),
        },
        cwd: if partial.get("cwd").is_some() {
            str_field(partial, "cwd").filter(|s| !s.is_empty())
        } else {
            existing.and_then(|e| e.cwd.clone())
        },
        show_terminal: if partial.get("showTerminal").is_some() {
            bool_field(partial, "showTerminal", false)
        } else {
            existing.map(|e| e.show_terminal).unwrap_or(false)
        },
        shell: if partial.get("shell").is_some() {
            str_field(partial, "shell")
                .or_else(|| str_field(partial, "terminalApp"))
                .filter(|s| !s.is_empty())
        } else {
            existing.and_then(|e| e.shell.clone())
        },
        confirm_before_run: if partial.get("confirmBeforeRun").is_some() {
            bool_field(partial, "confirmBeforeRun", false)
        } else {
            existing.map(|e| e.confirm_before_run).unwrap_or(false)
        },
        confirm_message: if partial.get("confirmMessage").is_some() {
            str_field(partial, "confirmMessage").filter(|s| !s.is_empty())
        } else {
            existing.and_then(|e| e.confirm_message.clone())
        },
        shortcut: if partial.get("shortcut").is_some() {
            str_field(partial, "shortcut").filter(|s| !s.is_empty())
        } else {
            existing.and_then(|e| e.shortcut.clone())
        },
        action_type: str_field(partial, "actionType").unwrap_or_else(|| {
            existing
                .map(|e| e.action_type.clone())
                .unwrap_or_else(|| "runCommand".into())
        }),
        env: if partial.get("env").is_some() {
            env_field(partial)
        } else {
            existing.map(|e| e.env.clone()).unwrap_or_default()
        },
        ssh_host: if partial.get("sshHost").is_some() {
            str_field(partial, "sshHost").filter(|s| !s.is_empty())
        } else {
            existing.and_then(|e| e.ssh_host.clone())
        },
        ssh_user: if partial.get("sshUser").is_some() {
            str_field(partial, "sshUser").filter(|s| !s.is_empty())
        } else {
            existing.and_then(|e| e.ssh_user.clone())
        },
        ssh_key_path: if partial.get("sshKeyPath").is_some() {
            str_field(partial, "sshKeyPath").filter(|s| !s.is_empty())
        } else {
            existing.and_then(|e| e.ssh_key_path.clone())
        },
        ssh_port: partial
            .get("sshPort")
            .and_then(|v| v.as_u64())
            .map(|p| p as u16)
            .or_else(|| existing.and_then(|e| e.ssh_port)),
        created_at: existing.map(|e| e.created_at).unwrap_or(now),
        updated_at: now,
    }
}

pub fn active_profile<'a>(deck: &'a DeckStore) -> Option<&'a Profile> {
    deck.profiles
        .iter()
        .find(|p| p.id == deck.active_profile_id)
        .or_else(|| deck.profiles.first())
}

pub fn active_page<'a>(profile: &'a Profile) -> Option<&'a Page> {
    profile
        .pages
        .iter()
        .find(|p| p.id == profile.active_page_id)
        .or_else(|| profile.pages.first())
}

pub fn macros_for_active_page(deck: &DeckStore) -> Vec<Macro> {
    let Some(profile) = active_profile(deck) else {
        return Vec::new();
    };
    let Some(page) = active_page(profile) else {
        return Vec::new();
    };
    page.macro_ids
        .iter()
        .filter_map(|id| deck.macros.iter().find(|m| &m.id == id).cloned())
        .collect()
}

pub fn add_macro(state: &AppState, partial: &Value) -> Macro {
    let macro_ = macro_from_partial(partial, None);
    let mut deck = state.deck.lock();
    deck.macros.push(macro_.clone());
    let active_profile_id = deck.active_profile_id.clone();
    if let Some(profile) = deck.profiles.iter_mut().find(|p| p.id == active_profile_id) {
        let active_page_id = profile.active_page_id.clone();
        if let Some(page) = profile.pages.iter_mut().find(|p| p.id == active_page_id) {
            page.macro_ids.push(macro_.id.clone());
        }
    }
    save_deck(&state.deck_path, &deck);
    macro_
}

pub fn update_macro(state: &AppState, id: &str, partial: &Value) -> Option<Macro> {
    let mut deck = state.deck.lock();
    let index = deck.macros.iter().position(|m| m.id == id)?;
    let existing = deck.macros[index].clone();
    let updated = macro_from_partial(partial, Some(&existing));
    deck.macros[index] = updated.clone();
    save_deck(&state.deck_path, &deck);
    Some(updated)
}

pub fn delete_macro(state: &AppState, id: &str) {
    let mut deck = state.deck.lock();
    deck.macros.retain(|m| m.id != id);
    for profile in &mut deck.profiles {
        for page in &mut profile.pages {
            page.macro_ids.retain(|mid| mid != id);
        }
    }
    save_deck(&state.deck_path, &deck);
}

pub fn reorder_macros(state: &AppState, ordered_ids: &[String]) {
    let mut deck = state.deck.lock();
    let active_profile_id = deck.active_profile_id.clone();
    let Some(profile) = deck.profiles.iter_mut().find(|p| p.id == active_profile_id) else {
        return;
    };
    let Some(page) = profile
        .pages
        .iter_mut()
        .find(|p| p.id == profile.active_page_id)
    else {
        return;
    };

    let mut next = Vec::new();
    for id in ordered_ids {
        if page.macro_ids.contains(id) {
            next.push(id.clone());
        }
    }
    for id in &page.macro_ids {
        if !next.contains(id) {
            next.push(id.clone());
        }
    }
    page.macro_ids = next;
    save_deck(&state.deck_path, &deck);
}

pub fn move_macro(state: &AppState, id: &str, direction: i32) {
    let mut deck = state.deck.lock();
    let active_profile_id = deck.active_profile_id.clone();
    let Some(profile) = deck.profiles.iter_mut().find(|p| p.id == active_profile_id) else {
        return;
    };
    let active_page_id = profile.active_page_id.clone();
    let Some(page) = profile.pages.iter_mut().find(|p| p.id == active_page_id) else {
        return;
    };
    let Some(index) = page.macro_ids.iter().position(|mid| mid == id) else {
        return;
    };
    let target = index as i32 + direction;
    if target < 0 || target as usize >= page.macro_ids.len() {
        return;
    }
    let item = page.macro_ids.remove(index);
    page.macro_ids.insert(target as usize, item);
    save_deck(&state.deck_path, &deck);
}

pub fn duplicate_macro(state: &AppState, id: &str) -> Option<Macro> {
    let existing = {
        let deck = state.deck.lock();
        deck.macros.iter().find(|m| m.id == id).cloned()?
    };
    let name = existing.name.trim();
    let partial = json!({
        "command": existing.command,
        "name": if name.is_empty() { String::new() } else { format!("{name} copy") },
        "imagePath": existing.image_path,
        "cwd": existing.cwd,
        "showTerminal": existing.show_terminal,
        "shell": existing.shell,
        "confirmBeforeRun": existing.confirm_before_run,
        "confirmMessage": existing.confirm_message,
        "shortcut": existing.shortcut,
        "actionType": existing.action_type,
        "env": existing.env,
        "sshHost": existing.ssh_host,
        "sshUser": existing.ssh_user,
        "sshKeyPath": existing.ssh_key_path,
        "sshPort": existing.ssh_port,
    });
    Some(add_macro(state, &partial))
}

pub fn set_active_profile(state: &AppState, profile_id: &str) -> Option<Profile> {
    let mut deck = state.deck.lock();
    if !deck.profiles.iter().any(|p| p.id == profile_id) {
        return None;
    }
    deck.active_profile_id = profile_id.to_string();
    save_deck(&state.deck_path, &deck);
    deck.profiles.iter().find(|p| p.id == profile_id).cloned()
}

pub fn set_active_page(state: &AppState, page_id: &str) -> Option<Page> {
    let mut deck = state.deck.lock();
    let active_profile_id = deck.active_profile_id.clone();
    let Some(profile) = deck.profiles.iter_mut().find(|p| p.id == active_profile_id) else {
        return None;
    };
    if !profile.pages.iter().any(|p| p.id == page_id) {
        return None;
    }
    profile.active_page_id = page_id.to_string();
    let page = profile.pages.iter().find(|p| p.id == page_id).cloned();
    save_deck(&state.deck_path, &deck);
    page
}

pub fn add_page(state: &AppState, name: &str) -> Option<Page> {
    let mut deck = state.deck.lock();
    let active_profile_id = deck.active_profile_id.clone();
    let Some(profile) = deck.profiles.iter_mut().find(|p| p.id == active_profile_id) else {
        return None;
    };
    let page = Page {
        id: new_id(),
        name: if name.is_empty() {
            format!("Page {}", profile.pages.len() + 1)
        } else {
            name.to_string()
        },
        macro_ids: Vec::new(),
    };
    profile.active_page_id = page.id.clone();
    profile.pages.push(page.clone());
    save_deck(&state.deck_path, &deck);
    Some(page)
}

pub fn add_profile(state: &AppState, name: &str) -> Option<Profile> {
    let mut deck = state.deck.lock();
    let profile_id = new_id();
    let page_id = new_id();
    let profile = Profile {
        id: profile_id.clone(),
        name: if name.is_empty() {
            format!("Profile {}", deck.profiles.len() + 1)
        } else {
            name.to_string()
        },
        columns: 3,
        rows: 1,
        active_page_id: page_id.clone(),
        pages: vec![Page {
            id: page_id,
            name: "Page 1".into(),
            macro_ids: Vec::new(),
        }],
    };
    deck.active_profile_id = profile_id;
    deck.profiles.push(profile.clone());
    save_deck(&state.deck_path, &deck);
    Some(profile)
}

pub fn duplicate_profile(state: &AppState, profile_id: &str) -> Option<Profile> {
    let source = {
        let deck = state.deck.lock();
        deck.profiles.iter().find(|p| p.id == profile_id).cloned()?
    };
    let mut deck = state.deck.lock();
    let new_profile_id = new_id();
    let mut new_macros = Vec::new();
    let mut new_pages = Vec::new();
    let mut active_page_id = String::new();

    for (i, page) in source.pages.iter().enumerate() {
        let new_page_id = new_id();
        if i == 0 || page.id == source.active_page_id {
            active_page_id = new_page_id.clone();
        }
        let mut new_macro_ids = Vec::new();
        for mid in &page.macro_ids {
            if let Some(m) = deck.macros.iter().find(|m| &m.id == mid) {
                let mut copy = m.clone();
                copy.id = new_id();
                copy.created_at = now_ms();
                copy.updated_at = copy.created_at;
                new_macro_ids.push(copy.id.clone());
                new_macros.push(copy);
            }
        }
        new_pages.push(Page {
            id: new_page_id,
            name: page.name.clone(),
            macro_ids: new_macro_ids,
        });
    }
    if active_page_id.is_empty() {
        active_page_id = new_pages
            .first()
            .map(|p| p.id.clone())
            .unwrap_or_else(new_id);
    }

    let profile = Profile {
        id: new_profile_id.clone(),
        name: format!("{} copy", source.name),
        columns: source.columns,
        rows: source.rows,
        active_page_id,
        pages: new_pages,
    };
    deck.macros.extend(new_macros);
    deck.active_profile_id = new_profile_id;
    deck.profiles.push(profile.clone());
    save_deck(&state.deck_path, &deck);
    Some(profile)
}

pub fn update_profile_grid(state: &AppState, columns: u32, rows: u32) {
    let mut deck = state.deck.lock();
    let active_profile_id = deck.active_profile_id.clone();
    if let Some(profile) = deck.profiles.iter_mut().find(|p| p.id == active_profile_id) {
        profile.columns = columns.clamp(2, 32);
        profile.rows = rows.clamp(1, 32);
    }
    save_deck(&state.deck_path, &deck);
}

pub fn find_macro(state: &AppState, id: &str) -> Option<Macro> {
    state.deck.lock().macros.iter().find(|m| m.id == id).cloned()
}

pub fn profile_name_for_macro(state: &AppState, _id: &str) -> Option<String> {
    let deck = state.deck.lock();
    active_profile(&deck).map(|p| p.name.clone())
}

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

pub fn deck_snapshot(state: &AppState) -> Value {
    let deck = state.deck.lock();
    let profile = active_profile(&deck).cloned();
    let page = profile.as_ref().and_then(|p| active_page(p).cloned());
    let visible = macros_for_active_page(&deck);
    json!({
        "version": deck.version,
        "activeProfileId": deck.active_profile_id,
        "profiles": deck.profiles,
        "activeProfile": profile,
        "activePage": page,
        "macros": decorate_macros(&visible),
        "allMacros": deck.macros.len(),
    })
}

pub fn broadcast_deck(app: &AppHandle, state: &AppState) -> Value {
    let snapshot = deck_snapshot(state);
    let _ = app.emit("deck:changed", snapshot.clone());
    let visible = snapshot.get("macros").cloned().unwrap_or(json!([]));
    let _ = app.emit("macros:changed", visible);
    snapshot
}

pub fn export_pack(state: &AppState, profile_id: Option<&str>) -> Value {
    let deck = state.deck.lock();
    let pid = profile_id.unwrap_or(&deck.active_profile_id);
    let Some(profile) = deck.profiles.iter().find(|p| p.id == pid) else {
        return json!({ "error": "Profile not found." });
    };
    let mut ids = HashSet::new();
    for page in &profile.pages {
        for id in &page.macro_ids {
            ids.insert(id.clone());
        }
    }
    let macros: Vec<&Macro> = deck.macros.iter().filter(|m| ids.contains(&m.id)).collect();
    json!({
        "schemaVersion": 1,
        "name": profile.name,
        "description": format!("CmdDeck macro pack — {}", profile.name),
        "profile": profile,
        "macros": macros,
    })
}
pub fn import_pack(state: &AppState, pack: &Value, mode: &str) -> Result<Value, String> {
    let profile: Profile = serde_json::from_value(
        pack.get("profile")
            .ok_or("Pack missing profile.")?
            .clone(),
    )
    .map_err(|e| e.to_string())?;
    let incoming_macros: Vec<Macro> = pack
        .get("macros")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let mut deck = state.deck.lock();
    if mode == "replace" {
        let active = deck.active_profile_id.clone();
        deck.profiles.retain(|p| p.id != active);
    }

    let id_map: std::collections::HashMap<String, String> = incoming_macros
        .iter()
        .map(|m| (m.id.clone(), new_id()))
        .collect();

    let mut remapped_macros = Vec::new();
    for m in incoming_macros {
        let mut copy = m;
        if let Some(new_id) = id_map.get(&copy.id) {
            copy.id = new_id.clone();
        }
        copy.updated_at = now_ms();
        remapped_macros.push(copy);
    }

    let mut new_profile = profile;
    new_profile.id = new_id();
    for page in &mut new_profile.pages {
        page.macro_ids = page
            .macro_ids
            .iter()
            .filter_map(|old| id_map.get(old).cloned())
            .collect();
    }
    if new_profile.pages.is_empty() {
        new_profile.pages.push(Page {
            id: new_id(),
            name: "Page 1".into(),
            macro_ids: remapped_macros.iter().map(|m| m.id.clone()).collect(),
        });
    }
    new_profile.active_page_id = new_profile.pages[0].id.clone();

    deck.macros.extend(remapped_macros);
    deck.active_profile_id = new_profile.id.clone();
    deck.profiles.push(new_profile.clone());
    save_deck(&state.deck_path, &deck);

    Ok(json!({
        "ok": true,
        "profile": new_profile,
    }))
}

pub fn list_builtin_packs(app: &AppHandle) -> Value {
    let mut packs = Vec::new();
    let mut dirs: Vec<std::path::PathBuf> = vec![
        Path::new("packs").into(),
        Path::new("../packs").into(),
    ];
    if let Ok(res) = app.path().resource_dir() {
        dirs.push(res.join("packs"));
    }
    if let Ok(data) = app.path().app_data_dir() {
        dirs.push(data.join("packs"));
    }
    for dir in dirs {
        if !dir.is_dir() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                if let Ok(raw) = std::fs::read_to_string(&path) {
                    if let Ok(pack) = serde_json::from_str::<Value>(&raw) {
                        packs.push(json!({
                            "id": path.file_stem().and_then(|s| s.to_str()).unwrap_or(""),
                            "name": pack.get("name").and_then(|v| v.as_str()).unwrap_or("Pack"),
                            "description": pack.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                            "path": path.to_string_lossy(),
                        }));
                    }
                }
            }
        }
    }
    json!(packs)
}

pub fn load_pack_file(path: &str) -> Result<Value, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}
