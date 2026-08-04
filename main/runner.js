const { spawn } = require('child_process');
const fs = require('fs');
const { EventEmitter } = require('events');

const running = new Map();
const events = new EventEmitter();

function spawnCommand(command, cwd) {
  if (process.platform === 'win32') {
    return spawn(command, {
      shell: true,
      cwd,
      windowsHide: true,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }

  const shell = fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash';
  return spawn(shell, ['-lc', command], {
    cwd,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env }
  });
}

function runMacro(macro) {
  if (!macro?.command) {
    return { ok: false, error: 'Command is empty.' };
  }
  if (running.has(macro.id)) {
    return { ok: false, error: 'Already running.' };
  }

  const cwd = macro.cwd && fs.existsSync(macro.cwd) ? macro.cwd : undefined;

  let child;
  try {
    child = spawnCommand(macro.command, cwd);
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }

  attachChild(macro, child);
  return { ok: true, pid: child.pid, showTerminal: !!macro.showTerminal };
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

function attachChild(macro, child) {
  const state = {
    id: macro.id,
    pid: child.pid,
    child,
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
