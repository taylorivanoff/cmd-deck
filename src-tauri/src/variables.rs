use std::collections::HashMap;
use std::path::Path;

use chrono::Local;

/// Replace `{{date}}`, `{{time}}`, `{{cwd}}`, `{{profile}}`, `{{env:VAR}}`, `{{gitBranch}}`.
pub fn substitute(
    command: &str,
    cwd: Option<&str>,
    profile_name: Option<&str>,
    extra_env: &HashMap<String, String>,
) -> String {
    let now = Local::now();
    let date = now.format("%Y-%m-%d").to_string();
    let time = now.format("%H:%M:%S").to_string();
    let cwd_str = cwd.unwrap_or("");
    let profile_str = profile_name.unwrap_or("");
    let git_branch = cwd.and_then(git_branch_at).unwrap_or_default();

    let mut out = command.to_string();
    out = out.replace("{{date}}", &date);
    out = out.replace("{{time}}", &time);
    out = out.replace("{{cwd}}", cwd_str);
    out = out.replace("{{profile}}", profile_str);
    out = out.replace("{{gitBranch}}", &git_branch);

    while let Some(start) = out.find("{{env:") {
        let Some(end) = out[start..].find("}}") else {
            break;
        };
        let key = &out[start + 6..start + end];
        let value = extra_env
            .get(key)
            .cloned()
            .or_else(|| std::env::var(key).ok())
            .unwrap_or_default();
        out.replace_range(start..start + end + 2, &value);
    }

    out
}

fn git_branch_at(cwd: &str) -> Option<String> {
    let head = Path::new(cwd).join(".git").join("HEAD");
    let content = std::fs::read_to_string(head).ok()?;
    let content = content.trim();
    if let Some(rest) = content.strip_prefix("ref: refs/heads/") {
        return Some(rest.trim().to_string());
    }
    if content.len() >= 7 {
        return Some(content.chars().take(7).collect());
    }
    None
}
