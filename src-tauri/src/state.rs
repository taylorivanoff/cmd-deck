use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

fn default_action_type() -> String {
    "runCommand".into()
}

fn default_columns() -> u32 {
    3
}

fn default_rows() -> u32 {
    2
}

fn default_version() -> u32 {
    2
}

/// A single macro button.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Macro {
    pub id: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub image_path: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub show_terminal: bool,
    #[serde(default)]
    pub shell: Option<String>,
    #[serde(default)]
    pub confirm_before_run: bool,
    #[serde(default)]
    pub confirm_message: Option<String>,
    #[serde(default)]
    pub shortcut: Option<String>,
    #[serde(default = "default_action_type")]
    pub action_type: String,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_user: Option<String>,
    #[serde(default)]
    pub ssh_key_path: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<u16>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub macro_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    #[serde(default = "default_columns")]
    pub columns: u32,
    #[serde(default = "default_rows")]
    pub rows: u32,
    pub active_page_id: String,
    #[serde(default)]
    pub pages: Vec<Page>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckStore {
    #[serde(default = "default_version")]
    pub version: u32,
    pub active_profile_id: String,
    #[serde(default)]
    pub macros: Vec<Macro>,
    #[serde(default)]
    pub profiles: Vec<Profile>,
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
    pub deck: Mutex<DeckStore>,
    pub deck_path: PathBuf,
    pub running: Mutex<HashMap<String, Arc<Mutex<RunningEntry>>>>,
    pub pending_starts: Mutex<HashSet<String>>,
    pub logs: Mutex<Vec<LogEntry>>,
    pub log_seq: Mutex<u64>,
}

impl AppState {
    pub fn new(deck_path: PathBuf, deck: DeckStore) -> Self {
        Self {
            deck: Mutex::new(deck),
            deck_path,
            running: Mutex::new(HashMap::new()),
            pending_starts: Mutex::new(HashSet::new()),
            logs: Mutex::new(Vec::new()),
            log_seq: Mutex::new(0),
        }
    }
}
