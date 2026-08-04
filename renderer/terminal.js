(() => {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const nameEl = document.getElementById('name');
  const commandEl = document.getElementById('command');
  const statusEl = document.getElementById('status');
  const outputEl = document.getElementById('output');
  const btnStop = document.getElementById('btn-stop');
  const btnClose = document.getElementById('btn-close');
  const term = new window.AnsiTerminal(outputEl);

  let finished = false;
  let startedAt = 0;
  let elapsedTimer = null;

  function formatElapsed(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const hours = Math.floor(totalSeconds / 3600);
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function runningStatusText(pid) {
    const elapsed = formatElapsed(Date.now() - startedAt);
    return pid ? `Running · ${elapsed} · pid ${pid}` : `Running · ${elapsed}`;
  }

  function refreshRunningStatus(pid) {
    if (!startedAt || finished) return;
    setStatus('running', runningStatusText(pid));
  }

  function startElapsedTimer(pid) {
    clearInterval(elapsedTimer);
    refreshRunningStatus(pid);
    elapsedTimer = setInterval(() => refreshRunningStatus(pid), 1000);
  }

  function labelFrom(meta) {
    const name = (meta?.name || '').trim();
    if (name) return name;
    const cmd = (meta?.command || '').trim();
    if (!cmd) return 'Command';
    return cmd.split(/\r?\n/).find((line) => line.trim()) || cmd;
  }

  function setStatus(state, text) {
    statusEl.dataset.state = state;
    statusEl.textContent = text;
    btnStop.disabled = state !== 'running';
  }

  function append(text, stream) {
    if (!text) return;
    if (stream === 'stderr') {
      term.write(text, { className: 'stderr', fallbackFg: 'var(--stderr)' });
      return;
    }
    if (stream === 'ok') {
      term.write(text, { className: 'ok', fallbackFg: 'var(--success)' });
      return;
    }
    if (stream === 'err') {
      term.write(text, { className: 'err', fallbackFg: 'var(--danger)' });
      return;
    }
    if (stream === 'meta-line') {
      term.write(text, { className: 'meta-line', fallbackFg: 'var(--muted)' });
      return;
    }
    term.write(text);
  }

  function applyMeta(meta) {
    if (!meta) return;
    nameEl.textContent = labelFrom(meta);
    commandEl.textContent = meta.command || '';
  }

  function applyRunningSnapshot(snapshot) {
    applyMeta(snapshot);
    term.clear();
    if (snapshot?.stdout) append(snapshot.stdout);
    if (snapshot?.stderr) append(snapshot.stderr, 'stderr');
    startedAt = Number(snapshot?.startedAt) || Date.now();
    finished = false;
    startElapsedTimer(snapshot?.pid);
  }

  function onFinished(payload) {
    finished = true;
    clearInterval(elapsedTimer);
    const duration = formatElapsed(Date.now() - (Number(payload?.startedAt) || startedAt || Date.now()));
    if (payload?.status === 'success') {
      setStatus('success', `${payload.code === 0 || payload.code == null ? 'Finished' : `Exit ${payload.code}`} · ${duration}`);
      append(`\n[exit ${payload.code ?? 0}]\n`, 'ok');
    } else {
      setStatus('error', `Failed · ${duration}`);
      append(`\n[${payload?.error || 'Command failed'}]\n`, 'err');
    }
  }

  btnStop.addEventListener('click', async () => {
    if (finished) return;
    append('\n[cancelling…]\n', 'meta-line');
    await window.cmdDeckTerminal.stop(id);
  });

  btnClose.addEventListener('click', async () => {
    await window.cmdDeckTerminal.close(id);
  });

  window.cmdDeckTerminal.onInit((payload) => {
    if (payload?.id !== id) return;
    applyRunningSnapshot(payload);
  });

  window.cmdDeckTerminal.onOutput((payload) => {
    if (payload?.id !== id) return;
    append(payload.chunk || '', payload.stream === 'stderr' ? 'stderr' : '');
  });

  window.cmdDeckTerminal.onStatus((payload) => {
    if (payload?.id !== id) return;
    if (payload.status === 'running') {
      applyMeta(payload);
      startedAt = Number(payload.startedAt) || startedAt || Date.now();
      startElapsedTimer(payload.pid);
      finished = false;
      return;
    }
    onFinished(payload);
  });

  window.cmdDeckTerminal.getBootstrap(id).then((boot) => {
    if (!boot) {
      setStatus('error', 'Not found');
      append('No active command for this terminal.\n', 'err');
      return;
    }
    applyRunningSnapshot(boot);
    if (boot.status && boot.status !== 'running') onFinished(boot);
  });
})();
