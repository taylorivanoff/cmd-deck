use std::process::{Command, Stdio};
use std::sync::Arc;

use parking_lot::Mutex;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use crate::path_env;
use crate::runner::{self, SpawnOutcome};
use crate::state::{AppState, Macro};
use crate::variables;

pub fn run_ssh_macro(app: &AppHandle, macro_: &Macro, profile_name: Option<&str>) -> Result<SpawnOutcome, String> {
    let host = macro_
        .ssh_host
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or("SSH host is required.")?;
    let user = macro_
        .ssh_user
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or("SSH user is required.")?;
    let command = macro_.command.trim();
    if command.is_empty() {
        return Err("Command is empty.".into());
    }

    let resolved = variables::substitute(
        command,
        macro_.cwd.as_deref(),
        profile_name,
        &macro_.env,
    );

    let port = macro_.ssh_port.unwrap_or(22);
    let target = format!("{user}@{host}");
    let mut cmd = Command::new("ssh");
    cmd.args([
        "-p",
        &port.to_string(),
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
    ]);
    if let Some(key) = macro_.ssh_key_path.as_deref().filter(|s| !s.is_empty()) {
        cmd.args(["-i", key]);
    }
    cmd.arg(&target);
    cmd.arg(&resolved);

    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    path_env::apply_enhanced_path(&mut cmd);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| format!("SSH failed: {e}"))?;
    let pid = child.id();
    let started_at = runner::now_ms();
    let shell_id = "ssh".to_string();

    let entry = Arc::new(Mutex::new(crate::state::RunningEntry {
        id: macro_.id.clone(),
        pid,
        shell: shell_id.clone(),
        show_terminal: macro_.show_terminal,
        name: macro_.name.clone(),
        command: resolved.clone(),
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
        "showTerminal": macro_.show_terminal, "name": macro_.name, "command": resolved,
        "startedAt": started_at
    });
    runner::log_macro_status(app, &running_payload);
    let _ = app.emit("macros:status", running_payload.clone());
    let _ = app.emit_to(format!("terminal-{}", macro_.id), "terminal:status", running_payload);

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    let out_handle = stdout_pipe.map(|s| {
        let app2 = app.clone();
        let entry2 = entry.clone();
        let id2 = macro_.id.clone();
        std::thread::spawn(move || runner::read_stream(app2, entry2, id2, s, "stdout"))
    });
    let err_handle = stderr_pipe.map(|s| {
        let app2 = app.clone();
        let entry2 = entry.clone();
        let id2 = macro_.id.clone();
        std::thread::spawn(move || runner::read_stream(app2, entry2, id2, s, "stderr"))
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
        runner::finalize(&app_ctrl, &entry_ctrl, status);
    });

    Ok(SpawnOutcome { pid, shell_id })
}
