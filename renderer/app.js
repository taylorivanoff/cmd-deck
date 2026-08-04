(() => {
  const pad = document.getElementById('pad');
  const hint = document.getElementById('hint');
  const toast = document.getElementById('toast');

  let macros = [];
  let settings = { columns: 3, rows: 3, opacity: 0.94, alwaysOnTop: true, startMinimised: false };
  let running = new Set();
  let flash = new Map();
  let toastTimer = null;

  function buttonLabel(macro) {
    if (macro.name) return macro.name;
    const cmd = (macro.command || '').trim();
    if (!cmd) return 'Untitled';
    const first = cmd.split(/\r?\n/).find((line) => line.trim()) || cmd;
    return first.length > 48 ? `${first.slice(0, 45)}…` : first;
  }

  function showToast(message, isError = false) {
    toast.textContent = message;
    toast.classList.toggle('error', !!isError);
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 2800);
  }

  function toFileUrl(filePath) {
    if (!filePath) return '';
    if (/^(file|data):/i.test(filePath)) return filePath;
    const normalized = filePath.replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(normalized)) return `file:///${normalized}`;
    return `file://${normalized}`;
  }

  function applyLayout() {
    pad.style.setProperty('--columns', String(settings.columns || 3));
    pad.style.setProperty('--rows', String(settings.rows || 3));
  }

  function openEditor(macro = null) {
    window.cmdDeck.openEditor(macro?.id || null);
  }

  function openSettings() {
    window.cmdDeck.openSettings();
  }

  function render() {
    applyLayout();
    pad.innerHTML = '';

    for (const macro of macros) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'macro-btn';
      btn.dataset.id = macro.id;
      btn.title = macro.command || '';

      if (macro.imageUrl || macro.imagePath) {
        btn.classList.add('has-image');
        btn.style.backgroundImage = `url("${toFileUrl(macro.imageUrl || macro.imagePath)}")`;
      } else if (!macro.name) {
        const glyph = document.createElement('div');
        glyph.className = 'glyph';
        glyph.textContent = '>_';
        btn.appendChild(glyph);
      }

      if (macro.showTerminal) {
        const badge = document.createElement('div');
        badge.className = 'badge-terminal';
        badge.title = 'Opens a terminal window';
        badge.textContent = '>_';
        btn.appendChild(badge);
      }

      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = buttonLabel(macro);
      btn.appendChild(label);

      if (running.has(macro.id)) {
        btn.classList.add('running');
        const spinner = document.createElement('div');
        spinner.className = 'spinner';
        btn.appendChild(spinner);
      }

      const flashState = flash.get(macro.id);
      if (flashState) btn.classList.add(flashState);

      btn.addEventListener('click', async () => {
        if (running.has(macro.id)) {
          await window.cmdDeck.stopMacro(macro.id);
          return;
        }
        const result = await window.cmdDeck.runMacro(macro.id);
        if (!result?.ok) showToast(result?.error || 'Failed to run', true);
      });

      btn.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        openEditor(macro);
      });

      pad.appendChild(btn);
    }

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'add-tile';
    add.title = 'Add macro';
    add.setAttribute('aria-label', 'Add macro');
    add.textContent = '+';
    add.addEventListener('click', () => openEditor());
    pad.appendChild(add);

    if (macros.length) {
      hint.textContent = '';
      hint.classList.add('is-hidden');
    } else {
      hint.textContent = 'Add a key to get started';
      hint.classList.remove('is-hidden');
    }
  }

  function flashStatus(id, status) {
    flash.set(id, status);
    render();
    setTimeout(() => {
      if (flash.get(id) === status) {
        flash.delete(id);
        render();
      }
    }, 1400);
  }

  async function init() {
    const state = await window.cmdDeck.getState();
    macros = state.macros || [];
    settings = state.settings || settings;
    running = new Set(state.runningIds || []);

    document.body.classList.add(`platform-${state.platform || 'win32'}`);
    if (state.dark) document.body.classList.add('dark');

    render();

    window.cmdDeck.onMacrosChanged((next) => {
      macros = next || [];
      render();
    });

    window.cmdDeck.onSettingsChanged((next) => {
      settings = next || settings;
      render();
    });

    window.cmdDeck.onStatus((payload) => {
      if (!payload?.id) return;
      if (payload.status === 'running') {
        running.add(payload.id);
        render();
        return;
      }
      running.delete(payload.id);
      if (payload.status === 'success') {
        flashStatus(payload.id, 'success');
      } else if (payload.status === 'error') {
        flashStatus(payload.id, 'error');
        showToast(payload.error || 'Command failed', true);
      } else {
        render();
      }
    });
  }

  document.getElementById('btn-add').addEventListener('click', () => openEditor());
  document.getElementById('btn-settings').addEventListener('click', openSettings);

  init().catch((err) => {
    console.error(err);
    showToast('Failed to load CmdDeck', true);
  });
})();
