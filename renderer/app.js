(() => {
  const pad = document.getElementById('pad');
  const hint = document.getElementById('hint');
  const toast = document.getElementById('toast');

  const editorOverlay = document.getElementById('editor-overlay');
  const editorForm = document.getElementById('editor-form');
  const editorTitle = document.getElementById('editor-title');
  const fieldCommand = document.getElementById('field-command');
  const fieldName = document.getElementById('field-name');
  const fieldCwd = document.getElementById('field-cwd');
  const fieldTerminal = document.getElementById('field-terminal');
  const imagePreview = document.getElementById('image-preview');
  const btnDelete = document.getElementById('btn-delete');

  const settingsOverlay = document.getElementById('settings-overlay');
  const settingAot = document.getElementById('setting-aot');
  const settingMinimised = document.getElementById('setting-minimised');
  const settingColumns = document.getElementById('setting-columns');
  const settingColumnsOut = document.getElementById('setting-columns-out');
  const settingsMeta = document.getElementById('settings-meta');

  let macros = [];
  let settings = { columns: 3, alwaysOnTop: true, startMinimised: false };
  let running = new Set();
  let flash = new Map();
  let editingId = null;
  let draftImagePath = null;
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

  function setImagePreview(imagePath) {
    draftImagePath = imagePath || null;
    if (draftImagePath) {
      imagePreview.classList.remove('empty');
      imagePreview.style.backgroundImage = `url("${toFileUrl(draftImagePath)}")`;
      imagePreview.textContent = '';
    } else {
      imagePreview.classList.add('empty');
      imagePreview.style.backgroundImage = '';
      imagePreview.textContent = 'None';
    }
  }

  function openEditor(macro = null) {
    editingId = macro?.id || null;
    editorTitle.textContent = editingId ? 'Edit Macro' : 'Add Macro';
    fieldCommand.value = macro?.command || '';
    fieldName.value = macro?.name || '';
    fieldCwd.value = macro?.cwd || '';
    fieldTerminal.checked = !!macro?.showTerminal;
    setImagePreview(macro?.imagePath || null);
    btnDelete.classList.toggle('hidden', !editingId);
    editorOverlay.classList.remove('hidden');
    fieldCommand.focus();
  }

  function closeEditor() {
    editorOverlay.classList.add('hidden');
    editingId = null;
  }

  function openSettings() {
    settingAot.checked = !!settings.alwaysOnTop;
    settingMinimised.checked = !!settings.startMinimised;
    settingColumns.value = String(settings.columns || 3);
    settingColumnsOut.textContent = settingColumns.value;
    settingsOverlay.classList.remove('hidden');
  }

  function closeSettings() {
    settingsOverlay.classList.add('hidden');
  }

  function applyColumns() {
    pad.style.setProperty('--columns', String(settings.columns || 3));
  }

  function render() {
    applyColumns();
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

    hint.textContent = macros.length
      ? 'Click to run · click again to stop · right-click to edit'
      : 'Add a macro to get started';
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

  async function saveEditor(event) {
    event.preventDefault();
    const payload = {
      command: fieldCommand.value,
      name: fieldName.value,
      cwd: fieldCwd.value,
      imagePath: draftImagePath,
      showTerminal: fieldTerminal.checked
    };
    if (!payload.command.trim()) {
      showToast('Command is required', true);
      return;
    }

    if (editingId) {
      await window.cmdDeck.updateMacro(editingId, payload);
    } else {
      await window.cmdDeck.addMacro(payload);
    }
    closeEditor();
  }

  async function deleteCurrent() {
    if (!editingId) return;
    const ok = confirm('Delete this macro?');
    if (!ok) return;
    await window.cmdDeck.deleteMacro(editingId);
    closeEditor();
  }

  async function init() {
    const state = await window.cmdDeck.getState();
    macros = state.macros || [];
    settings = state.settings || settings;
    running = new Set(state.runningIds || []);

    document.body.classList.add(`platform-${state.platform || 'win32'}`);
    if (state.dark) document.body.classList.add('dark');
    settingsMeta.textContent = `CmdDeck v${state.version || '1.0.0'} · ${state.platform}`;

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
  document.getElementById('editor-close').addEventListener('click', closeEditor);
  document.getElementById('btn-cancel').addEventListener('click', closeEditor);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('btn-delete').addEventListener('click', deleteCurrent);
  editorForm.addEventListener('submit', saveEditor);

  document.getElementById('btn-pick-image').addEventListener('click', async () => {
    const result = await window.cmdDeck.pickImage();
    if (!result) return;
    if (result.error) {
      showToast(result.error, true);
      return;
    }
    setImagePreview(result);
  });

  document.getElementById('btn-clear-image').addEventListener('click', () => setImagePreview(null));

  document.getElementById('btn-pick-cwd').addEventListener('click', async () => {
    const folder = await window.cmdDeck.pickFolder();
    if (folder) fieldCwd.value = folder;
  });

  editorOverlay.addEventListener('click', (event) => {
    if (event.target === editorOverlay) closeEditor();
  });
  settingsOverlay.addEventListener('click', (event) => {
    if (event.target === settingsOverlay) closeSettings();
  });

  settingAot.addEventListener('change', () => {
    window.cmdDeck.setSettings({ alwaysOnTop: settingAot.checked });
  });
  settingMinimised.addEventListener('change', () => {
    window.cmdDeck.setSettings({ startMinimised: settingMinimised.checked });
  });
  settingColumns.addEventListener('input', () => {
    settingColumnsOut.textContent = settingColumns.value;
  });
  settingColumns.addEventListener('change', () => {
    window.cmdDeck.setSettings({ columns: Number(settingColumns.value) });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!editorOverlay.classList.contains('hidden')) closeEditor();
      else if (!settingsOverlay.classList.contains('hidden')) closeSettings();
    }
  });

  init().catch((err) => {
    console.error(err);
    showToast('Failed to load CmdDeck', true);
  });
})();
