const { spawn } = require('child_process');
const fs = require('fs');
const { EventEmitter } = require('events');
const shells = require('./shells');

const running = new Map();
const events = new EventEmitter();

function lookLikeMissingCommand(text) {
  const t = String(text || '');
  return /is not recognized as/i.test(t)
    || /command not found/i.test(t)
    || /not found/i.test(t)
    || /Could not find command/i.test(t)
    || /The term '.+' is not recognized/i.test(t)
    || /unknown command/i.test(t)
    || /No such file or directory/i.test(t);
}

function formatFailure(state, code, signal) {
  const detail = (state.stderr || '').trim() || (state.stdout || '').trim();
  if (lookLikeMissingCommand(detail)) {
    const first = detail.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    return first || 'Command not found.';
  }
  if (detail) {
    const first = detail.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    return first.length > 160 ? `${first.slice(0, 157)}…` : first;
  }
  if (signal) return `Signal ${signal}`;
  if (code == null) return 'Command failed.';
  return `Exit code ${code}`;
}

function runMacro(macro) {
  if (!macro?.command) {
    return { ok: false, error: 'Command is empty.' };
  }
  if (running.has(macro.id)) {
    return { ok: false, error: 'Already running.' };
  }

  const cwd = macro.cwd && fs.existsSync(macro.cwd) ? macro.cwd : undefined;
  const shellId = shells.migrateShellId(macro.shell || macro.terminalApp);

  let child;
  try {
    child = shells.spawnWithShell(shellId, macro.command, cwd);
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }

  attachChild(macro, child, shellId);
  return { ok: true, pid: child.pid, showTerminal: !!macro.showTerminal, shell: shellId };
}

function appendOutput(state, stream, chunk) {
  const text = chunk.toString();
  state[stream] += text;
  if (state[stream].length > 200000) state[stream] = state[stream].slice(-200000);
  events.emit('output', {
    id: state.id,
    stream,
    chunk: text
  });
}

function finalize(state, { code = null, signal = null, error = null } = {}) {
  if (!running.has(state.id)) return;
  running.delete(state.id);

  if (error) {
    events.emit('status', {
      id: state.id,
      status: 'error',
      shell: state.shell,
      showTerminal: state.showTerminal,
      error
    });
    return;
  }

  if (state.stopping) {
    events.emit('status', {
      id: state.id,
      status: 'stopped',
      code,
      signal,
      shell: state.shell,
      showTerminal: state.showTerminal
    });
    return;
  }

  const ok = code === 0;
  events.emit('status', {
    id: state.id,
    status: ok ? 'success' : 'error',
    code,
    signal,
    shell: state.shell,
    showTerminal: state.showTerminal,
    error: ok ? null : formatFailure(state, code, signal)
  });
}

function attachChild(macro, child, shellId) {
  const state = {
    id: macro.id,
    pid: child.pid,
    child,
    shell: shellId,
    showTerminal: !!macro.showTerminal,
    name: macro.name || '',
    command: macro.command || '',
    startedAt: Date.now(),
    stdout: '',
    stderr: '',
    settled: false
  };
  running.set(macro.id, state);
  events.emit('status', {
    id: macro.id,
    status: 'running',
    pid: child.pid,
    shell: shellId,
    showTerminal: state.showTerminal,
    name: state.name,
    command: state.command
  });

  child.stdout?.on('data', (chunk) => appendOutput(state, 'stdout', chunk));
  child.stderr?.on('data', (chunk) => appendOutput(state, 'stderr', chunk));

  const settle = (payload) => {
    if (state.settled) return;
    state.settled = true;
    finalize(state, payload);
  };

  child.on('error', (err) => {
    settle({ error: err.message || String(err) });
  });

  // Prefer `close` (stdio flushed) for accurate "command not found" text.
  // Fall back from `exit` so the pad never stays stuck on a spinner.
  child.on('exit', (code, signal) => {
    setTimeout(() => {
      settle({ code, signal });
    }, 150);
  });

  child.on('close', (code, signal) => {
    settle({ code, signal });
  });

  // Spawn can complete so fast that exitCode is already set.
  if (child.exitCode != null || child.signalCode != null) {
    setTimeout(() => {
      settle({ code: child.exitCode, signal: child.signalCode });
    }, 150);
  }
}

function stopMacro(id) {
  const state = running.get(id);
  if (!state?.pid) return { ok: false, error: 'Not running.' };
  state.stopping = true;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(state.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    } else {
      try {
        process.kill(-state.pid, 'SIGTERM');
      } catch (_) {
        process.kill(state.pid, 'SIGTERM');
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function getRunningIds() {
  return [...running.keys()];
}

function getRunning(id) {
  const state = running.get(id);
  if (!state) return null;
  return {
    id: state.id,
    pid: state.pid,
    shell: state.shell,
    showTerminal: state.showTerminal,
    name: state.name,
    command: state.command,
    startedAt: state.startedAt,
    stdout: state.stdout,
    stderr: state.stderr
  };
}

function onStatus(listener) {
  events.on('status', listener);
  return () => events.off('status', listener);
}

function onOutput(listener) {
  events.on('output', listener);
  return () => events.off('output', listener);
}

module.exports = {
  runMacro,
  stopMacro,
  getRunningIds,
  getRunning,
  onStatus,
  onOutput
};
