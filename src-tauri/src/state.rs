use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

/// A single macro button: a command run through a chosen shell.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Macro {
    pub id: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub name: String,
    /// Either `null` or a `data:` URI (button images are embedded inline; see README/gap notes).
    #[serde(default)]
    pub image_path: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub show_terminal: bool,
    #[serde(default)]
    pub shell: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Live state for a macro currently executing.
pub struct RunningEntry {
    pub id: String,
    pub pid: u32,
    pub shell: String,
    pub show_terminal: bool,
    pub name: String,
    pub command: String,
    pub started_at: i64,
    pub stdout: String,
    pub stderr: String,
    pub stopping: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    pub id: String,
    pub time: String,
    pub ts: i64,
    pub level: String,
    pub message: String,
    #[serde(rename = "macroId", skip_serializing_if = "Option::is_none")]
    pub macro_id: Option<String>,
}

pub struct AppState {
    pub macros: Mutex<Vec<Macro>>,
    pub macros_path: PathBuf,
    pub running: Mutex<HashMap<String, Arc<Mutex<RunningEntry>>>>,
    pub pending_starts: Mutex<HashSet<String>>,
    pub logs: Mutex<Vec<LogEntry>>,
    pub log_seq: Mutex<u64>,
}

impl AppState {
    pub fn new(macros_path: PathBuf, macros: Vec<Macro>) -> Self {
        Self {
            macros: Mutex::new(macros),
            macros_path,
            running: Mutex::new(HashMap::new()),
            pending_starts: Mutex::new(HashSet::new()),
            logs: Mutex::new(Vec::new()),
            log_seq: Mutex::new(0),
        }
    }
}
