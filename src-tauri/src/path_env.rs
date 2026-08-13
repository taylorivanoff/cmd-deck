use std::collections::HashSet;
use std::path::PathBuf;

/// Rebuild a login-like PATH so GUI-launched processes find common dev tools
/// (Scoop, Homebrew, nvm, Herd, etc.) in addition to the OS environment.
pub fn enhanced_path() -> String {
    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut seen = HashSet::new();

    let mut push_dir = |dir: PathBuf| {
        if dir.as_os_str().is_empty() {
            return;
        }
        let key = dir.to_string_lossy().to_lowercase();
        if seen.insert(key) {
            dirs.push(dir);
        }
    };

    if let Ok(path) = std::env::var("PATH") {
        for part in std::env::split_paths(&path) {
            push_dir(part);
        }
    }

    #[cfg(windows)]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let local = PathBuf::from(&local);
            push_dir(local.join("Programs").join("Microsoft VS Code").join("bin"));
            push_dir(local.join("Programs").join("Git").join("cmd"));
            push_dir(local.join("Programs").join("Git").join("bin"));
            push_dir(local.join("Microsoft").join("WindowsApps"));
            push_dir(local.join("Programs").join("PowerShell").join("7"));
        }
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            let home = PathBuf::from(&userprofile);
            push_dir(home.join("scoop").join("shims"));
            push_dir(home.join(".cargo").join("bin"));
            push_dir(home.join("AppData").join("Roaming").join("npm"));
            push_dir(home.join("AppData").join("Local").join("Programs").join("Herd").join("bin"));
        }
        if let Ok(pf) = std::env::var("ProgramFiles") {
            let pf = PathBuf::from(pf);
            push_dir(pf.join("PowerShell").join("7"));
            push_dir(pf.join("nodejs"));
            push_dir(pf.join("Git").join("cmd"));
            push_dir(pf.join("Git").join("bin"));
        }
    }

    #[cfg(not(windows))]
    {
        if let Ok(home) = std::env::var("HOME") {
            let home = PathBuf::from(&home);
            push_dir(home.join(".local").join("bin"));
            push_dir(home.join(".cargo").join("bin"));
            push_dir(home.join("bin"));
            push_dir(home.join(".nvm").join("versions").join("node").join("current").join("bin"));
            push_dir(PathBuf::from("/opt/homebrew/bin"));
            push_dir(PathBuf::from("/usr/local/bin"));
            push_dir(home.join("Library").join("Application Support").join("Herd").join("bin"));
        }
        if let Ok(path) = std::fs::read_to_string("/etc/paths") {
            for line in path.lines() {
                let line = line.trim();
                if !line.is_empty() {
                    push_dir(PathBuf::from(line));
                }
            }
        }
    }

    std::env::join_paths(dirs.iter())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| std::env::var("PATH").unwrap_or_default())
}

pub fn apply_enhanced_path(cmd: &mut std::process::Command) {
    let path = enhanced_path();
    if !path.is_empty() {
        cmd.env("PATH", path);
    }
}
