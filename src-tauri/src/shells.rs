use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellKind {
    Cmd,
    PowerShell,
    Posix,
}

#[derive(Debug, Clone)]
pub struct ShellInfo {
    pub id: String,
    pub name: String,
    pub executable: PathBuf,
    pub kind: ShellKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellSummary {
    pub id: String,
    pub name: String,
    pub detail: String,
}

impl From<&ShellInfo> for ShellSummary {
    fn from(s: &ShellInfo) -> Self {
        Self {
            id: s.id.clone(),
            name: s.name.clone(),
            detail: s.executable.to_string_lossy().into_owned(),
        }
    }
}

fn exists(path: &Path) -> bool {
    path.is_file()
}

fn which(bin: &str) -> Option<PathBuf> {
    which::which(bin).ok()
}

#[cfg(windows)]
fn program_files_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for var in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
        if let Ok(v) = std::env::var(var) {
            roots.push(PathBuf::from(v));
        }
    }
    roots.push(PathBuf::from("C:\\Program Files"));
    roots.push(PathBuf::from("C:\\Program Files (x86)"));
    roots
}

#[cfg(windows)]
fn find_pwsh7() -> Option<PathBuf> {
    for root in program_files_roots() {
        let ps_root = root.join("PowerShell");
        let Ok(entries) = std::fs::read_dir(&ps_root) else {
            continue;
        };
        let mut versions: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        versions.sort();
        versions.reverse();
        for dir in versions {
            let candidate = dir.join("pwsh.exe");
            if exists(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(windows)]
fn find_wsl() -> Option<PathBuf> {
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let wsl = Path::new(&system_root).join("System32").join("wsl.exe");
    if exists(&wsl) {
        return Some(wsl);
    }
    which("wsl.exe")
}

#[cfg(windows)]
fn find_git_bash() -> Option<PathBuf> {
    for root in program_files_roots() {
        for candidate in [
            root.join("Git").join("bin").join("bash.exe"),
            root.join("Git").join("usr").join("bin").join("bash.exe"),
        ] {
            if exists(&candidate) {
                return Some(candidate);
            }
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let candidate = PathBuf::from(local)
            .join("Programs")
            .join("Git")
            .join("bin")
            .join("bash.exe");
        if exists(&candidate) {
            return Some(candidate);
        }
    }
    which("bash.exe").filter(|p| p.to_string_lossy().to_lowercase().contains("git"))
}

fn push_unique(list: &mut Vec<ShellInfo>, info: ShellInfo) {
    let exe_key = info.executable.to_string_lossy().to_lowercase();
    if list
        .iter()
        .any(|s| s.executable.to_string_lossy().to_lowercase() == exe_key || s.id == info.id)
    {
        return;
    }
    list.push(info);
}

/// Detect the handful of shells CmdDeck supports: cmd, PowerShell 5, PowerShell 7,
/// bash (Git Bash on Windows), and sh. Resolution uses `which` plus a few common
/// install locations, mirroring (in simplified form) the Electron shell discovery.
pub fn detect_shells() -> Vec<ShellInfo> {
    let mut list = Vec::new();

    #[cfg(windows)]
    {
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());

        let cmd_exe = std::env::var_os("ComSpec")
            .map(PathBuf::from)
            .filter(|p| exists(p))
            .unwrap_or_else(|| Path::new(&system_root).join("System32").join("cmd.exe"));
        if exists(&cmd_exe) {
            push_unique(
                &mut list,
                ShellInfo {
                    id: "cmd".into(),
                    name: "Command Prompt".into(),
                    executable: cmd_exe,
                    kind: ShellKind::Cmd,
                },
            );
        }

        let powershell_exe = Path::new(&system_root)
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe");
        if exists(&powershell_exe) {
            push_unique(
                &mut list,
                ShellInfo {
                    id: "powershell".into(),
                    name: "Windows PowerShell".into(),
                    executable: powershell_exe,
                    kind: ShellKind::PowerShell,
                },
            );
        }

        if let Some(pwsh) = which("pwsh.exe").or_else(find_pwsh7) {
            push_unique(
                &mut list,
                ShellInfo {
                    id: "pwsh".into(),
                    name: "PowerShell 7".into(),
                    executable: pwsh,
                    kind: ShellKind::PowerShell,
                },
            );
        }

        if let Some(bash) = which("bash.exe").or_else(find_git_bash) {
            push_unique(
                &mut list,
                ShellInfo {
                    id: "bash".into(),
                    name: "Git Bash".into(),
                    executable: bash,
                    kind: ShellKind::Posix,
                },
            );
        }

        if let Some(sh) = which("sh.exe") {
            push_unique(
                &mut list,
                ShellInfo {
                    id: "sh".into(),
                    name: "sh".into(),
                    executable: sh,
                    kind: ShellKind::Posix,
                },
            );
        }

        if let Some(wsl) = find_wsl() {
            push_unique(
                &mut list,
                ShellInfo {
                    id: "wsl".into(),
                    name: "WSL".into(),
                    executable: wsl,
                    kind: ShellKind::Posix,
                },
            );
        }
    }

    #[cfg(not(windows))]
    {
        for (id, name, candidates) in [
            ("sh", "sh", vec!["/bin/sh", "/usr/bin/sh"]),
            ("bash", "bash", vec!["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash", "/opt/homebrew/bin/bash"]),
            ("zsh", "zsh", vec!["/bin/zsh", "/usr/bin/zsh", "/usr/local/bin/zsh", "/opt/homebrew/bin/zsh"]),
            ("fish", "fish", vec!["/usr/bin/fish", "/usr/local/bin/fish", "/opt/homebrew/bin/fish"]),
            ("nu", "Nushell", vec!["/usr/bin/nu", "/usr/local/bin/nu", "/opt/homebrew/bin/nu"]),
        ] {
            let exe = which(id).or_else(|| {
                candidates
                    .into_iter()
                    .map(PathBuf::from)
                    .find(|p| exists(p))
            });
            if let Some(exe) = exe {
                push_unique(
                    &mut list,
                    ShellInfo {
                        id: id.into(),
                        name: name.into(),
                        executable: exe,
                        kind: ShellKind::Posix,
                    },
                );
            }
        }

        if let Ok(content) = std::fs::read_to_string("/etc/shells") {
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() || !line.starts_with('/') {
                    continue;
                }
                let path = PathBuf::from(line);
                if !exists(&path) {
                    continue;
                }
                let id = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("sh")
                    .to_string();
                if ["sh", "bash", "zsh", "fish", "nu"].contains(&id.as_str()) {
                    continue;
                }
                push_unique(
                    &mut list,
                    ShellInfo {
                        id: id.clone(),
                        name: id,
                        executable: path,
                        kind: ShellKind::Posix,
                    },
                );
            }
        }

        if let Some(pwsh) = which("pwsh") {
            push_unique(
                &mut list,
                ShellInfo {
                    id: "pwsh".into(),
                    name: "PowerShell 7".into(),
                    executable: pwsh,
                    kind: ShellKind::PowerShell,
                },
            );
        }
    }

    list
}

pub fn default_shell_id(shells: &[ShellInfo]) -> String {
    #[cfg(windows)]
    {
        if shells.iter().any(|s| s.id == "pwsh") {
            return "pwsh".into();
        }
        if shells.iter().any(|s| s.id == "powershell") {
            return "powershell".into();
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(shell_env) = std::env::var("SHELL") {
            for id in ["zsh", "bash", "fish", "nu", "sh"] {
                if shell_env.contains(id) && shells.iter().any(|s| s.id == id) {
                    return id.into();
                }
            }
        }
        for id in ["zsh", "bash", "fish", "nu"] {
            if shells.iter().any(|s| s.id == id) {
                return id.into();
            }
        }
    }
    shells
        .first()
        .map(|s| s.id.clone())
        .unwrap_or_else(|| "sh".into())
}

/// Translate legacy Electron shell/terminal ids to the simplified id set here.
pub fn migrate_shell_id(value: Option<&str>, shells: &[ShellInfo]) -> String {
    let default = default_shell_id(shells);
    let Some(value) = value else {
        return default;
    };
    match value {
        "builtin" | "terminal" | "iterm" | "warp" | "alacritty" | "kitty" | "hyper" | "" => default,
        "windows-terminal" => "cmd".into(),
        "git-bash" => "bash".into(),
        "wsl-bash" => "wsl".into(),
        other => other.to_string(),
    }
}

pub fn resolve_shell<'a>(id: &str, shells: &'a [ShellInfo]) -> Option<&'a ShellInfo> {
    shells
        .iter()
        .find(|s| s.id == id)
        .or_else(|| shells.iter().find(|s| s.id == default_shell_id(shells)))
        .or_else(|| shells.first())
}

pub fn spawn_args(shell: &ShellInfo, command: &str) -> Vec<String> {
    if shell.id == "wsl" {
        return vec!["-e".into(), "bash".into(), "-lc".into(), command.to_string()];
    }
    if shell.id == "fish" {
        return vec!["-lc".into(), command.to_string()];
    }
    if shell.id == "nu" {
        return vec!["-c".into(), command.to_string()];
    }
    match shell.kind {
        ShellKind::PowerShell => vec![
            "-NoProfile".into(),
            "-NoLogo".into(),
            "-Command".into(),
            command.to_string(),
        ],
        ShellKind::Cmd => vec!["/d".into(), "/s".into(), "/c".into(), command.to_string()],
        ShellKind::Posix => vec!["-lc".into(), command.to_string()],
    }
}
