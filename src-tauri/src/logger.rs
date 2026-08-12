use tauri::{AppHandle, Emitter, Manager};

use crate::state::{AppState, LogEntry};
use crate::windows::LOG_LABEL;

const MAX_ENTRIES: usize = 500;

fn timestamp() -> String {
    chrono::Local::now().format("%H:%M:%S").to_string()
}

/// Record a log entry and forward it to the activity log window (if open).
pub fn add_log(app: &AppHandle, level: &str, message: &str, macro_id: Option<&str>) {
    let state = app.state::<AppState>();
    let seq = {
        let mut seq = state.log_seq.lock();
        *seq += 1;
        *seq
    };

    let entry = LogEntry {
        id: format!("log-{}-{}", chrono::Utc::now().timestamp_millis(), seq),
        time: timestamp(),
        ts: chrono::Utc::now().timestamp_millis(),
        level: level.to_string(),
        message: message.to_string(),
        macro_id: macro_id.map(|s| s.to_string()),
    };

    {
        let mut logs = state.logs.lock();
        logs.push(entry.clone());
        while logs.len() > MAX_ENTRIES {
            logs.remove(0);
        }
    }

    let _ = app.emit_to(LOG_LABEL, "log:entry", entry);
}

pub fn get_logs(app: &AppHandle) -> Vec<LogEntry> {
    app.state::<AppState>().logs.lock().clone()
}

pub fn clear_logs(app: &AppHandle) {
    app.state::<AppState>().logs.lock().clear();
}
