use tauri::utils::config::Color;
use tauri::webview::{PageLoadEvent, PageLoadPayload};
use tauri::{
    AppHandle, Emitter, Manager, Theme, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

use crate::state::AppState;

pub const EDITOR_LABEL: &str = "editor";
pub const SETTINGS_LABEL: &str = "settings";
pub const LOG_LABEL: &str = "log";

pub fn terminal_label(id: &str) -> String {
    format!("terminal-{id}")
}

fn current_always_on_top(app: &AppHandle) -> bool {
    app.try_state::<tauri_tray_base::TrayBaseState>()
        .map(|s| s.settings.lock().always_on_top)
        .unwrap_or(false)
}

fn dialog_background(app: &AppHandle) -> Color {
    let dark = app
        .get_webview_window(tauri_tray_base::MAIN_WINDOW_LABEL)
        .and_then(|w| w.theme().ok())
        .map(|t| t == Theme::Dark)
        .unwrap_or(false);
    // Match renderer/styles.css --bg (terminal uses its own dark #0c0c0c)
    if dark {
        Color(0x1c, 0x1c, 0x1e, 255)
    } else {
        Color(0xf3, 0xf3, 0xf3, 255)
    }
}

fn terminal_background() -> Color {
    Color(0x0c, 0x0c, 0x0c, 255)
}

fn log_background() -> Color {
    Color(0x12, 0x12, 0x14, 255)
}

fn bring_to_front(win: &WebviewWindow) {
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
}

/// Editor/settings/log windows track the "always on top" setting whenever
/// they are (re)shown, mirroring Electron's `bringToFront(win, alwaysOnTop)`.
fn bring_to_front_pinned(app: &AppHandle, win: &WebviewWindow) {
    let _ = win.set_always_on_top(current_always_on_top(app));
    bring_to_front(win);
}

fn editor_title(has_id: bool) -> &'static str {
    if has_id {
        "Edit Macro"
    } else {
        "Add Macro"
    }
}

/// WebView2 deadlocks if `WebviewWindowBuilder::build` runs inside a sync
/// command or menu/event handler on Windows. Create new windows off-thread.
fn spawn_window(app: AppHandle, build: impl FnOnce(&AppHandle) + Send + 'static) {
    let _ = std::thread::Builder::new()
        .name("cmd-deck-window".into())
        .spawn(move || build(&app));
}

/// Show only after first paint so the native white frame never flashes.
fn reveal_when_ready(pinned: bool) -> impl Fn(WebviewWindow, PageLoadPayload<'_>) + Send + Sync + 'static {
    move |win, payload| {
        if payload.event() != PageLoadEvent::Finished {
            return;
        }
        if pinned {
            if let Some(state) = win.app_handle().try_state::<tauri_tray_base::TrayBaseState>() {
                let aot = state.settings.lock().always_on_top;
                let _ = win.set_always_on_top(aot);
            }
        }
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

pub fn open_editor_window(app: &AppHandle, macro_id: Option<String>) {
    if let Some(win) = app.get_webview_window(EDITOR_LABEL) {
        let _ = app.emit_to(EDITOR_LABEL, "editor:open", macro_id.clone());
        let _ = win.set_title(editor_title(macro_id.is_some()));
        bring_to_front_pinned(app, &win);
        return;
    }

    let url = match &macro_id {
        Some(id) => format!("editor.html?id={id}"),
        None => "editor.html".to_string(),
    };
    let title = editor_title(macro_id.is_some());
    let aot = current_always_on_top(app);
    let bg = dialog_background(app);

    spawn_window(app.clone(), move |app| {
        let _ = WebviewWindowBuilder::new(app, EDITOR_LABEL, WebviewUrl::App(url.into()))
            .title(title)
            .inner_size(820.0, 560.0)
            .min_inner_size(640.0, 420.0)
            .resizable(true)
            .minimizable(false)
            .maximizable(false)
            .always_on_top(aot)
            .background_color(bg)
            .visible(false)
            .on_page_load(reveal_when_ready(true))
            .center()
            .build();
    });
}

pub fn open_settings_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(SETTINGS_LABEL) {
        bring_to_front_pinned(app, &win);
        return;
    }

    let aot = current_always_on_top(app);
    let bg = dialog_background(app);
    // Stay hidden until settings.js measures content and shows — avoids a
    // flash of the placeholder size, then a jump.
    spawn_window(app.clone(), move |app| {
        let _ = WebviewWindowBuilder::new(app, SETTINGS_LABEL, WebviewUrl::App("settings.html".into()))
            .title("Settings")
            .inner_size(340.0, 420.0)
            .min_inner_size(300.0, 200.0)
            .resizable(false)
            .minimizable(false)
            .maximizable(false)
            .always_on_top(aot)
            .background_color(bg)
            .visible(false)
            .center()
            .build();
    });
}

pub fn open_log_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(LOG_LABEL) {
        bring_to_front_pinned(app, &win);
        return;
    }

    let aot = current_always_on_top(app);
    let bg = log_background();
    spawn_window(app.clone(), move |app| {
        let _ = WebviewWindowBuilder::new(app, LOG_LABEL, WebviewUrl::App("log.html".into()))
            .title("CmdDeck Activity Log")
            .inner_size(560.0, 420.0)
            .min_inner_size(420.0, 280.0)
            .resizable(true)
            .always_on_top(aot)
            .background_color(bg)
            .visible(false)
            .on_page_load(reveal_when_ready(true))
            .center()
            .build();
    });
}

fn terminal_title(name: &str, command: &str) -> String {
    let label = {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            trimmed.to_string()
        } else {
            command
                .trim()
                .split(['\r', '\n'])
                .next()
                .unwrap_or("Command")
                .to_string()
        }
    };
    format!("CmdDeck - {label}")
}

pub fn open_terminal_window(app: &AppHandle, id: &str, name: &str, command: &str) {
    let label = terminal_label(id);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.set_title(&terminal_title(name, command));
        bring_to_front(&win);
        return;
    }

    // Roughly mirrors Electron's size-relative-to-screen heuristic (45%/50% of
    // the primary display's work area, clamped to sensible min/max bounds).
    let (width, height) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let scale = m.scale_factor();
            let size = m.size().to_logical::<f64>(scale);
            (
                (size.width * 0.45).clamp(480.0, 720.0),
                (size.height * 0.5).clamp(320.0, 480.0),
            )
        })
        .unwrap_or((640.0, 420.0));

    let url = format!("terminal.html?id={id}");
    let id_owned = id.to_string();
    let title = terminal_title(name, command);
    let label_owned = label.clone();
    let bg = terminal_background();

    spawn_window(app.clone(), move |app| {
        let app_for_close = app.clone();
        if let Ok(win) = WebviewWindowBuilder::new(app, &label_owned, WebviewUrl::App(url.into()))
            .title(title)
            .inner_size(width, height)
            .min_inner_size(420.0, 280.0)
            .background_color(bg)
            .visible(false)
            .on_page_load(reveal_when_ready(false))
            .center()
            .build()
        {
            win.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { .. } = event {
                    let state = app_for_close.state::<AppState>();
                    let running = state.running.lock().contains_key(&id_owned);
                    if running {
                        crate::runner::stop_macro(&app_for_close, &id_owned);
                    }
                }
            });
        }
    });
}

pub fn close_terminal_window(app: &AppHandle, id: &str) {
    if let Some(win) = app.get_webview_window(&terminal_label(id)) {
        let _ = win.destroy();
    }
}

/// Keep the aux (non-main) windows in sync with the "always on top" setting.
pub fn set_aux_always_on_top(app: &AppHandle, value: bool) {
    for label in [EDITOR_LABEL, SETTINGS_LABEL, LOG_LABEL] {
        if let Some(win) = app.get_webview_window(label) {
            let _ = win.set_always_on_top(value);
        }
    }
}

/// Destroy every non-main window; called right before the app quits.
pub fn close_all_aux_windows(app: &AppHandle) {
    for (label, win) in app.webview_windows() {
        if label != tauri_tray_base::MAIN_WINDOW_LABEL {
            let _ = win.destroy();
        }
    }
}
