(() => {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const nameEl = document.getElementById('name');
  const commandEl = document.getElementById('command');
  const statusEl = document.getElementById('status');
  const outputEl = document.getElementById('output');
  const btnStop = document.getElementById('btn-stop');
  const btnClose = document.getElementById('btn-close');

  let finished = false;

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

  function append(text, className) {
    if (!text) return;
    const span = document.createElement('span');
    if (className) span.className = className;
    span.textContent = text;
    outputEl.appendChild(span);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  function applyMeta(meta) {
    if (!meta) return;
    nameEl.textContent = labelFrom(meta);
    commandEl.textContent = meta.command || '';
  }

  function applyRunningSnapshot(snapshot) {
    applyMeta(snapshot);
    outputEl.textContent = '';
    if (snapshot?.stdout) append(snapshot.stdout);
    if (snapshot?.stderr) append(snapshot.stderr, 'stderr');
    setStatus('running', snapshot?.pid ? `Running · pid ${snapshot.pid}` : 'Running');
    finished = false;
  }

  function onFinished(payload) {
    finished = true;
    if (payload?.status === 'success') {
      setStatus('success', payload.code === 0 || payload.code == null ? 'Finished' : `Exit ${payload.code}`);
      append(`\n[exit ${payload.code ?? 0}]\n`, 'ok');
    } else {
      setStatus('error', 'Failed');
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
      setStatus('running', payload.pid ? `Running · pid ${payload.pid}` : 'Running');
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
