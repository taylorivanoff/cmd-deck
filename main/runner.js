const { spawn } = require('child_process');
const fs = require('fs');
const { EventEmitter } = require('events');
const shells = require('./shells');

const running = new Map();
const events = new EventEmitter();

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
    stderr: ''
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

  child.on('error', (err) => {
    running.delete(macro.id);
    events.emit('status', {
      id: macro.id,
      status: 'error',
      shell: shellId,
      showTerminal: state.showTerminal,
      error: err.message || String(err)
    });
  });

  child.on('close', (code, signal) => {
    running.delete(macro.id);
    const status = code === 0 ? 'success' : 'error';
    events.emit('status', {
      id: macro.id,
      status,
      code,
      signal,
      shell: shellId,
      showTerminal: state.showTerminal,
      error: code === 0 ? null : (state.stderr.trim() || (signal ? `Signal ${signal}` : `Exit code ${code}`))
    });
  });
}

function stopMacro(id) {
  const state = running.get(id);
  if (!state?.pid) return { ok: false, error: 'Not running.' };
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
