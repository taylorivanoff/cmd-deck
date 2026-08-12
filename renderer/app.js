(() => {
  const pad = document.getElementById('pad');
  const hint = document.getElementById('hint');
  const toast = document.getElementById('toast');
  const ctxMenu = document.getElementById('ctx-menu');
  const settingColumns = document.getElementById('setting-columns');
  const settingRows = document.getElementById('setting-rows');

  let macros = [];
  let settings = { columns: 3, rows: 1, opacity: 0.94, alwaysOnTop: true, startMinimised: false, sizeLocked: false };
  const btnLock = document.getElementById('btn-lock');
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
    pad.style.setProperty('--rows', String(settings.rows || 1));
  }

  function syncLockButton() {
    const locked = settings.sizeLocked === true;
    btnLock.classList.toggle('is-on', locked);
    btnLock.setAttribute('aria-pressed', locked ? 'true' : 'false');
    btnLock.title = locked ? 'Unlock size' : 'Lock size';
    btnLock.setAttribute('aria-label', locked ? 'Unlock size' : 'Lock size');
  }

  function syncGridInputs() {
    const cols = settings.columns || 3;
    const rows = settings.rows || 1;
    if (document.activeElement !== settingColumns) settingColumns.value = String(cols);
    if (document.activeElement !== settingRows) settingRows.value = String(rows);

    for (const stepper of document.querySelectorAll('.grid-stepper')) {
      const key = stepper.dataset.key;
      const min = Number(stepper.dataset.min);
      const max = Number(stepper.dataset.max);
      const value = key === 'columns' ? cols : rows;
      const up = stepper.querySelector('.grid-arrow[data-dir="1"]');
      const down = stepper.querySelector('.grid-arrow[data-dir="-1"]');
      if (up) up.disabled = value >= max;
      if (down) down.disabled = value <= min;
    }
  }

  function clampInt(value, min, max, fallback) {
    const n = Number.parseInt(String(value), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  async function commitGridSetting(key, input, min, max) {
    const fallback = key === 'rows' ? 1 : 3;
    const next = clampInt(input.value, min, max, settings[key] || fallback);
    input.value = String(next);
    if (settings[key] === next) {
      syncGridInputs();
      return;
    }
    settings = { ...settings, [key]: next };
    syncGridInputs();
    applyLayout();
    await window.cmdDeck.setSettings({ [key]: next });
  }

  async function nudgeGridSetting(key, delta, min, max) {
    const fallback = key === 'rows' ? 1 : 3;
    const current = settings[key] || fallback;
    const next = Math.min(max, Math.max(min, current + delta));
    if (next === current) return;
    settings = { ...settings, [key]: next };
    syncGridInputs();
    applyLayout();
    await window.cmdDeck.setSettings({ [key]: next });
  }

  function bindEditableStepper(input, key) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const stepper = input.closest('.grid-stepper');
        const min = Number(stepper.dataset.min);
        const max = Number(stepper.dataset.max);
        nudgeGridSetting(key, event.key === 'ArrowUp' ? 1 : -1, min, max);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
    });
    input.addEventListener('change', () => {
      const stepper = input.closest('.grid-stepper');
      commitGridSetting(key, input, Number(stepper.dataset.min), Number(stepper.dataset.max));
    });
    input.addEventListener('blur', () => {
      const stepper = input.closest('.grid-stepper');
      commitGridSetting(key, input, Number(stepper.dataset.min), Number(stepper.dataset.max));
    });
  }

  function openEditor(macro = null) {
    window.cmdDeck.openEditor(macro?.id || null);
  }

  function openSettings() {
    window.cmdDeck.openSettings();
  }

  function hideContextMenu() {
    ctxMenu.classList.add('hidden');
    ctxMenu.innerHTML = '';
  }

  function addCtxItem(label, { danger = false, disabled = false, onClick } = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = danger ? 'ctx-item danger' : 'ctx-item';
    btn.setAttribute('role', 'menuitem');
    btn.textContent = label;
    btn.disabled = !!disabled;
    btn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideContextMenu();
      if (typeof onClick === 'function') await onClick();
    });
    ctxMenu.appendChild(btn);
  }

  function addCtxSep() {
    const sep = document.createElement('div');
    sep.className = 'ctx-sep';
    sep.setAttribute('role', 'separator');
    ctxMenu.appendChild(sep);
  }

  function showContextMenu(event, macro) {
    event.preventDefault();
    event.stopPropagation();
    hideContextMenu();

    const index = macros.findIndex((m) => m.id === macro.id);
    const isRunning = running.has(macro.id);

    addCtxItem(isRunning ? 'Stop' : 'Run', {
      onClick: async () => {
        if (isRunning) {
          await window.cmdDeck.stopMacro(macro.id);
          return;
        }
        const result = await window.cmdDeck.runMacro(macro.id);
        if (!result?.ok) showToast(result?.error || 'Failed to run', true);
      }
    });
    addCtxSep();
    addCtxItem('Edit', { onClick: () => openEditor(macro) });
    addCtxItem('Duplicate', {
      onClick: async () => {
        const name = (macro.name || '').trim();
        await window.cmdDeck.addMacro({
          command: macro.command,
          name: name ? `${name} copy` : '',
          imagePath: macro.imagePath || null,
          cwd: macro.cwd || null,
          showTerminal: !!macro.showTerminal,
          shell: macro.shell || macro.terminalApp || null
        });
      }
    });
    addCtxItem('Move Left', {
      disabled: index <= 0,
      onClick: async () => {
        if (index <= 0) return;
        const ids = macros.map((m) => m.id);
        const [item] = ids.splice(index, 1);
        ids.splice(index - 1, 0, item);
        await window.cmdDeck.reorderMacros(ids);
      }
    });
    addCtxItem('Move Right', {
      disabled: index < 0 || index >= macros.length - 1,
      onClick: async () => {
        if (index < 0 || index >= macros.length - 1) return;
        const ids = macros.map((m) => m.id);
        const [item] = ids.splice(index, 1);
        ids.splice(index + 1, 0, item);
        await window.cmdDeck.reorderMacros(ids);
      }
    });
    addCtxSep();
    addCtxItem('Delete', {
      danger: true,
      onClick: async () => {
        const ok = confirm('Delete this macro?');
        if (!ok) return;
        await window.cmdDeck.deleteMacro(macro.id);
      }
    });

    ctxMenu.classList.remove('hidden');

    const edge = 8;
    const innerWidth = document.documentElement.clientWidth || window.innerWidth;
    const innerHeight = document.documentElement.clientHeight || window.innerHeight;
    ctxMenu.style.maxHeight = `${Math.max(80, innerHeight - edge * 2)}px`;
    const rect = ctxMenu.getBoundingClientRect();
    let left = event.clientX;
    let top = event.clientY;

    // Prefer opening above the pointer when there is not enough room below.
    if (top + rect.height > innerHeight - edge && top - rect.height >= edge) {
      top -= rect.height;
    }

    if (left + rect.width > innerWidth - edge) left = innerWidth - rect.width - edge;
    if (top + rect.height > innerHeight - edge) top = innerHeight - rect.height - edge;
    if (left < edge) left = edge;
    if (top < edge) top = edge;
    ctxMenu.style.left = `${left}px`;
    ctxMenu.style.top = `${top}px`;
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
          running.delete(macro.id);
          render();
          await window.cmdDeck.stopMacro(macro.id);
          return;
        }
        // Optimistic: show running state immediately while main warms/spawns.
        running.add(macro.id);
        render();
        const result = await window.cmdDeck.runMacro(macro.id);
        if (!result?.ok) {
          running.delete(macro.id);
          render();
          showToast(result?.error || 'Failed to run', true);
        }
      });

      btn.addEventListener('contextmenu', (event) => {
        showContextMenu(event, macro);
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

    syncGridInputs();
    syncLockButton();
    render();

    window.cmdDeck.onMacrosChanged((next) => {
      macros = next || [];
      render();
    });

    window.cmdDeck.onSettingsChanged((next) => {
      settings = next || settings;
      syncGridInputs();
      syncLockButton();
      render();
    });

    window.cmdDeck.onStatus((payload) => {
      if (!payload?.id) return;
      if (payload.status === 'running') {
        running.add(payload.id);
        render();
        return;
      }
      // Always clear spinner for finished/failed/stopped — including missing commands.
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

    window.cmdDeck.onToast((payload) => {
      if (!payload?.message) return;
      showToast(payload.message, !!payload.error);
    });
  }

  document.getElementById('btn-add').addEventListener('click', () => openEditor());
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  btnLock.addEventListener('click', async () => {
    const next = settings.sizeLocked === false;
    settings = { ...settings, sizeLocked: next };
    syncLockButton();
    await window.cmdDeck.setSettings({ sizeLocked: next });
  });

  document.addEventListener('mousedown', (event) => {
    if (!ctxMenu.classList.contains('hidden') && !ctxMenu.contains(event.target)) {
      hideContextMenu();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideContextMenu();
  });
  window.addEventListener('blur', hideContextMenu);
  window.addEventListener('resize', hideContextMenu);

  bindEditableStepper(settingColumns, 'columns');
  bindEditableStepper(settingRows, 'rows');

  document.querySelectorAll('.grid-stepper').forEach((stepper) => {
    stepper.querySelectorAll('.grid-arrow').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = stepper.dataset.key;
        const min = Number(stepper.dataset.min);
        const max = Number(stepper.dataset.max);
        const dir = Number(btn.dataset.dir) || 0;
        nudgeGridSetting(key, dir, min, max);
      });
    });
  });

  init().catch((err) => {
    console.error(err);
    showToast('Failed to load CmdDeck', true);
  });
})();

