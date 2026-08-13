use std::collections::HashMap;

use parking_lot::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::state::AppState;

pub struct HotkeyState {
    pub registered: Mutex<HashMap<String, String>>,
}

impl HotkeyState {
    pub fn new() -> Self {
        Self {
            registered: Mutex::new(HashMap::new()),
        }
    }
}

pub fn parse_shortcut(raw: &str) -> Option<Shortcut> {
    let parts: Vec<&str> = raw.split('+').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return None;
    }

    let mut mods = Modifiers::empty();
    let mut key_part = parts[parts.len() - 1];

    let lower_parts: Vec<String> = parts.iter().map(|p| p.to_ascii_lowercase()).collect();
    for (i, lower) in lower_parts.iter().enumerate() {
        match lower.as_str() {
            "ctrl" | "control" => mods.insert(Modifiers::CONTROL),
            "alt" | "option" => mods.insert(Modifiers::ALT),
            "shift" => mods.insert(Modifiers::SHIFT),
            "super" | "cmd" | "command" | "win" | "windows" => mods.insert(Modifiers::SUPER),
            _ => key_part = parts[i],
        }
    }

    let upper = key_part.to_ascii_uppercase();
    let code = match upper.as_str() {
        "A" => Code::KeyA,
        "B" => Code::KeyB,
        "C" => Code::KeyC,
        "D" => Code::KeyD,
        "E" => Code::KeyE,
        "F" => Code::KeyF,
        "G" => Code::KeyG,
        "H" => Code::KeyH,
        "I" => Code::KeyI,
        "J" => Code::KeyJ,
        "K" => Code::KeyK,
        "L" => Code::KeyL,
        "M" => Code::KeyM,
        "N" => Code::KeyN,
        "O" => Code::KeyO,
        "P" => Code::KeyP,
        "Q" => Code::KeyQ,
        "R" => Code::KeyR,
        "S" => Code::KeyS,
        "T" => Code::KeyT,
        "U" => Code::KeyU,
        "V" => Code::KeyV,
        "W" => Code::KeyW,
        "X" => Code::KeyX,
        "Y" => Code::KeyY,
        "Z" => Code::KeyZ,
        "0" => Code::Digit0,
        "1" => Code::Digit1,
        "2" => Code::Digit2,
        "3" => Code::Digit3,
        "4" => Code::Digit4,
        "5" => Code::Digit5,
        "6" => Code::Digit6,
        "7" => Code::Digit7,
        "8" => Code::Digit8,
        "9" => Code::Digit9,
        "F1" => Code::F1,
        "F2" => Code::F2,
        "F3" => Code::F3,
        "F4" => Code::F4,
        "F5" => Code::F5,
        "F6" => Code::F6,
        "F7" => Code::F7,
        "F8" => Code::F8,
        "F9" => Code::F9,
        "F10" => Code::F10,
        "F11" => Code::F11,
        "F12" => Code::F12,
        _ => return None,
    };

    Some(Shortcut::new(Some(mods), code))
}

pub fn sync_hotkeys(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let hotkeys = app.state::<HotkeyState>();
    let gs = app.global_shortcut();

    let desired: HashMap<String, String> = {
        let deck = state.deck.lock();
        deck.macros
            .iter()
            .filter_map(|m| {
                m.shortcut
                    .as_ref()
                    .filter(|s| !s.is_empty())
                    .map(|s| (s.clone(), m.id.clone()))
            })
            .collect()
    };

    let mut registered = hotkeys.registered.lock();

    for (shortcut, _) in registered.iter() {
        if !desired.contains_key(shortcut) {
            if let Some(parsed) = parse_shortcut(shortcut) {
                let _ = gs.unregister(parsed);
            }
        }
    }

    registered.clear();

    for (shortcut, macro_id) in desired {
        let Some(parsed) = parse_shortcut(&shortcut) else {
            continue;
        };
        let id_for_closure = macro_id.clone();
        let app_handle = app.clone();
        gs.on_shortcut(parsed, move |_app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let app2 = app_handle.clone();
            let id = id_for_closure.clone();
            std::thread::spawn(move || {
                let _ = crate::commands::run_macro_by_id(&app2, &id);
            });
        })
        .map_err(|e| e.to_string())?;
        registered.insert(shortcut, macro_id);
    }

    Ok(())
}

pub fn init(app: &AppHandle) {
    app.manage(HotkeyState::new());
    let _ = sync_hotkeys(app);
}
