use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::Arc;

use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::logger;
use crate::path_env;
use crate::shells;
use crate::ssh_runner;
use crate::state::{AppState, Macro, RunningEntry};
use crate::store;
use crate::variables;

pub const MAX_BUFFER: usize = 200_000;

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn cap_string(s: &mut String, max: usize) {
    if s.len() <= max {
        return;
    }
    let mut start = s.len() - max;
    while start < s.len() && !s.is_char_boundary(start) {
        start += 1;
    }
    *s = s[start..].to_string();
}

fn looks_like_missing_command(text: &str) -> bool {
    let patterns = [
        "is not recognized as",
        "command not found",
        "not found",
        "could not find command",
        "unknown command",
        "no such file or directory",
    ];
    let lower = text.to_lowercase();
    patterns.iter().any(|p| lower.contains(p))
}

fn first_line(text: &str) -> Option<String> {
    text.split(['\r', '\n'])
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .map(|s| s.to_string())
}

fn format_failure(stdout: &str, stderr: &str, code: Option<i32>) -> String {
    let detail = if !stderr.trim().is_empty() {
        stderr.trim()
    } else {
        stdout.trim()
    };

    if looks_like_missing_command(detail) {
        return first_line(detail).unwrap_or_else(|| "Command not found.".into());
    }
    if !detail.is_empty() {
        let line = first_line(detail).unwrap_or_default();
        return if line.chars().count() > 160 {
            let truncated: String = line.chars().take(157).collect();
            format!("{truncated}…")
        } else {
            line
        };
    }
    match code {
        Some(c) => format!("Exit code {c}"),
        None => "Command failed.".into(),
    }
}

fn macro_label(name: &str, command: &str) -> String {
    let name = name.trim();
    if !name.is_empty() {
        return name.to_string();
    }
    let cmd = command
        .split(['\r', '\n'])
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .unwrap_or("Command");
    if cmd.chars().count() > 60 {
        let truncated: String = cmd.chars().take(57).collect();
        format!("{truncated}…")
    } else {
        cmd.to_string()
    }
}

pub fn log_macro_status(app: &AppHandle, payload: &Value) {
    let Some(id) = payload.get("id").and_then(|v| v.as_str()) else {
        return;
    };
    let state = app.state::<AppState>();
    let label = payload
        .get("name")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            store::find_macro(&state, id)
                .map(|m| macro_label(&m.name, &m.command))
                .unwrap_or_else(|| "Macro".into())
        });
    let shell_suffix = payload
        .get("shell")
        .and_then(|v| v.as_str())
        .map(|s| format!(" [{s}]"))
        .unwrap_or_default();
    let status = payload.get("status").and_then(|v| v.as_str()).unwrap_or("");

    match status {
        "running" => {
            let pending = payload
                .get("pending")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if pending {
                logger::add_log(app, "info", &format!("Queued \u{201c}{label}\u{201d}{shell_suffix}"), Some(id));
            } else {
                let pid_suffix = payload
                    .get("pid")
                    .and_then(|v| v.as_u64())
                    .map(|p| format!(" pid={p}"))
                    .unwrap_or_default();
                logger::add_log(
                    app,
                    "info",
                    &format!("Started \u{201c}{label}\u{201d}{shell_suffix}{pid_suffix}"),
                    Some(id),
                );
            }
        }
        "success" => {
            logger::add_log(app, "info", &format!("Finished \u{201c}{label}\u{201d}{shell_suffix}"), Some(id));
        }
        "error" => {
            let error = payload
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Command failed");
            logger::add_log(
                app,
                "error",
                &format!("Failed \u{201c}{label}\u{201d}{shell_suffix}: {error}"),
                Some(id),
            );
        }
        "stopped" => {
            logger::add_log(app, "warn", &format!("Stopped \u{201c}{label}\u{201d}{shell_suffix}"), Some(id));
        }
        _ => {}
    }
}

pub fn read_stream<R: Read>(
    app: AppHandle,
    entry: Arc<Mutex<RunningEntry>>,
    id: String,
    mut stream: R,
    which: &'static str,
) {
    let mut buf = [0u8; 8192];
    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let text = String::from_utf8_lossy(&buf[..n]).into_owned();
                {
                    let mut e = entry.lock();
                    let field = if which == "stdout" {
                        &mut e.stdout
                    } else {
                        &mut e.stderr
                    };
                    field.push_str(&text);
                    cap_string(field, MAX_BUFFER);
                }
                let _ = app.emit(
                    "macro:output",
                    json!({ "id": id, "stream": which, "chunk": text }),
                );
                let _ = app.emit_to(
                    format!("terminal-{id}"),
                    "terminal:output",
                    json!({ "id": id, "stream": which, "chunk": text }),
                );
            }
            Err(_) => break,
        }
    }
}

pub fn finalize(app: &AppHandle, entry: &Arc<Mutex<RunningEntry>>, status: std::io::Result<std::process::ExitStatus>) {
    let (id, name, command, shell, show_terminal, started_at, stopping, stdout, stderr) = {
        let e = entry.lock();
        (
            e.id.clone(),
            e.name.clone(),
            e.command.clone(),
            e.shell.clone(),
            e.show_terminal,
            e.started_at,
            e.stopping,
            e.stdout.clone(),
            e.stderr.clone(),
        )
    };

    {
        let state = app.state::<AppState>();
        state.running.lock().remove(&id);
    }

    let payload = match status {
        Err(e) => json!({
            "id": id, "status": "error", "shell": shell, "showTerminal": show_terminal,
            "name": name, "command": command, "startedAt": started_at, "error": e.to_string()
        }),
        Ok(exit_status) => {
            if stopping {
                json!({
                    "id": id, "status": "stopped", "code": exit_status.code(), "shell": shell,
                    "showTerminal": show_terminal, "name": name, "command": command, "startedAt": started_at
                })
            } else {
                let ok = exit_status.success();
                json!({
                    "id": id,
                    "status": if ok { "success" } else { "error" },
                    "code": exit_status.code(),
                    "shell": shell,
                    "showTerminal": show_terminal,
                    "name": name,
                    "command": command,
                    "startedAt": started_at,
                    "error": if ok { Value::Null } else { json!(format_failure(&stdout, &stderr, exit_status.code())) }
                })
            }
        }
    };

    log_macro_status(app, &payload);
    let _ = app.emit("macros:status", payload.clone());
    let _ = app.emit_to(format!("terminal-{id}"), "terminal:status", payload);
}

pub struct SpawnOutcome {
    pub pid: u32,
    pub shell_id: String,
}

fn resolved_command(macro_: &Macro, profile_name: Option<&str>) -> String {
    variables::substitute(
        &macro_.command,
        macro_.cwd.as_deref(),
        profile_name,
        &macro_.env,
    )
}

fn run_open_url(macro_: &Macro, profile_name: Option<&str>) -> Result<(), String> {
    let url = resolved_command(macro_, profile_name);
    if url.trim().is_empty() {
        return Err("URL is empty.".into());
    }
    tauri_plugin_opener::open_url(url.trim(), None::<&str>)
        .map_err(|e| e.to_string())
}

fn run_open_path(macro_: &Macro, profile_name: Option<&str>) -> Result<(), String> {
    let path = resolved_command(macro_, profile_name);
    if path.trim().is_empty() {
        return Err("Path is empty.".into());
    }
    tauri_plugin_opener::open_path(path.trim(), None::<&str>)
        .map_err(|e| e.to_string())
}

fn emit_instant_success(app: &AppHandle, macro_: &Macro, shell_id: &str, command: &str) {
    let started_at = now_ms();
    let payload = json!({
        "id": macro_.id, "status": "success", "shell": shell_id,
        "showTerminal": macro_.show_terminal, "name": macro_.name,
        "command": command, "startedAt": started_at
    });
    log_macro_status(app, &payload);
    let _ = app.emit("macros:status", payload);
}

pub fn run_macro(app: &AppHandle, macro_: &Macro) -> Result<SpawnOutcome, String> {
    let state = app.state::<AppState>();
    let profile_name = store::profile_name_for_macro(&state, &macro_.id);

    match macro_.action_type.as_str() {
        "openUrl" => {
            let command = resolved_command(macro_, profile_name.as_deref());
            run_open_url(macro_, profile_name.as_deref())?;
            emit_instant_success(app, macro_, "openUrl", &command);
            return Ok(SpawnOutcome {
                pid: 0,
                shell_id: "openUrl".into(),
            });
        }
        "openPath" => {
            let command = resolved_command(macro_, profile_name.as_deref());
            run_open_path(macro_, profile_name.as_deref())?;
            emit_instant_success(app, macro_, "openPath", &command);
            return Ok(SpawnOutcome {
                pid: 0,
                shell_id: "openPath".into(),
            });
        }
        "ssh" => {
            return ssh_runner::run_ssh_macro(app, macro_, profile_name.as_deref());
        }
        _ => {}
    }

    let command = resolved_command(macro_, profile_name.as_deref());
    if command.trim().is_empty() {
        return Err("Command is empty.".into());
    }

    let shells_list = shells::detect_shells();
    let shell_id = shells::migrate_shell_id(macro_.shell.as_deref(), &shells_list);
    let shell = shells::resolve_shell(&shell_id, &shells_list).ok_or("No shell available.")?;

    let cwd = macro_
        .cwd
        .as_ref()
        .filter(|c| std::path::Path::new(c).exists());

    let args = shells::spawn_args(shell, &command);
    let mut cmd = Command::new(&shell.executable);
    cmd.args(&args);
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }
    for (key, value) in &macro_.env {
        cmd.env(key, value);
    }
    path_env::apply_enhanced_path(&mut cmd);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    let started_at = now_ms();

    let entry = Arc::new(Mutex::new(RunningEntry {
        id: macro_.id.clone(),
        pid,
        shell: shell_id.clone(),
        show_terminal: macro_.show_terminal,
        name: macro_.name.clone(),
        command: command.clone(),
        started_at,
        stdout: String::new(),
        stderr: String::new(),
        stopping: false,
    }));

    {
        let state = app.state::<AppState>();
        state.running.lock().insert(macro_.id.clone(), entry.clone());
    }

    let running_payload = json!({
        "id": macro_.id, "status": "running", "pid": pid, "shell": shell_id,
        "showTerminal": macro_.show_terminal, "name": macro_.name, "command": command,
        "startedAt": started_at
    });
    log_macro_status(app, &running_payload);
    let _ = app.emit("macros:status", running_payload.clone());
    let _ = app.emit_to(format!("terminal-{}", macro_.id), "terminal:status", running_payload);

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    let out_handle = stdout_pipe.map(|s| {
        let app2 = app.clone();
        let entry2 = entry.clone();
        let id2 = macro_.id.clone();
        std::thread::spawn(move || read_stream(app2, entry2, id2, s, "stdout"))
    });
    let err_handle = stderr_pipe.map(|s| {
        let app2 = app.clone();
        let entry2 = entry.clone();
        let id2 = macro_.id.clone();
        std::thread::spawn(move || read_stream(app2, entry2, id2, s, "stderr"))
    });

    let app_ctrl = app.clone();
    let entry_ctrl = entry.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        if let Some(h) = out_handle {
            let _ = h.join();
        }
        if let Some(h) = err_handle {
            let _ = h.join();
        }
        finalize(&app_ctrl, &entry_ctrl, status);
    });

    Ok(SpawnOutcome { pid, shell_id })
}

pub fn stop_macro(app: &AppHandle, id: &str) -> Value {
    let state = app.state::<AppState>();
    let entry = {
        let running = state.running.lock();
        running.get(id).cloned()
    };
    let Some(entry) = entry else {
        return json!({ "ok": false, "error": "Not running." });
    };

    let pid = {
        let mut e = entry.lock();
        e.stopping = true;
        e.pid
    };

    if pid == 0 {
        state.running.lock().remove(id);
        return json!({ "ok": true });
    }

    #[cfg(windows)]
    {
        let result = Command::new("taskkill")
            .args(["/pid", &pid.to_string(), "/t", "/f"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        match result {
            Ok(_) => json!({ "ok": true }),
            Err(e) => json!({ "ok": false, "error": e.to_string() }),
        }
    }

    #[cfg(unix)]
    {
        unsafe {
            let group_result = libc::kill(-(pid as i32), libc::SIGTERM);
            if group_result != 0 {
                libc::kill(pid as i32, libc::SIGTERM);
            }
        }
        json!({ "ok": true })
    }
}
