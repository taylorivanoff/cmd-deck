(() => {
  const params = new URLSearchParams(window.location.search);
  const editingId = params.get('id') || null;

  const editorForm = document.getElementById('editor-form');
  const fieldCommand = document.getElementById('field-command');
  const fieldName = document.getElementById('field-name');
  const fieldCwd = document.getElementById('field-cwd');
  const fieldTerminal = document.getElementById('field-terminal');
  const fieldShell = document.getElementById('field-shell');
  const shellPicker = document.getElementById('shell-picker');
  const shellPickerTrigger = document.getElementById('shell-picker-trigger');
  const shellPickerMenu = document.getElementById('shell-picker-menu');
  const shellPickerName = document.getElementById('shell-picker-name');
  const shellPickerPath = document.getElementById('shell-picker-path');
  const shellHint = document.getElementById('shell-hint');
  const imagePreview = document.getElementById('image-preview');
  const btnDelete = document.getElementById('btn-delete');
  const toast = document.getElementById('toast');

  let shellOptions = [];
  let defaultShell = 'powershell';
  let draftImagePath = null;
  let toastTimer = null;

  function migrateShellValue(value) {
    const map = {
      builtin: defaultShell,
      'windows-terminal': 'cmd',
      terminal: defaultShell,
      iterm: defaultShell,
      warp: defaultShell,
      alacritty: defaultShell,
      kitty: defaultShell,
      hyper: defaultShell
    };
    return map[value] || value || defaultShell;
  }

  function shellPath(shell) {
    return shell?.detail || shell?.executable || '';
  }

  function getShellOptions() {
    return shellOptions.length
      ? shellOptions
      : [{ id: defaultShell, name: defaultShell, detail: '' }];
  }

  function selectedShell() {
    return getShellOptions().find((s) => s.id === fieldShell.value) || getShellOptions()[0] || null;
  }

  function syncShellTrigger() {
    const shell = selectedShell();
    shellPickerName.textContent = shell?.name || defaultShell;
    const pathText = shellPath(shell);
    shellPickerPath.textContent = pathText;
    shellPickerPath.hidden = !pathText;
    shellPickerTrigger.title = pathText || shell?.name || '';
    shellHint.textContent = 'Uses this shell’s PATH and environment';
  }

  function setShellValue(id) {
    const options = getShellOptions();
    const wanted = migrateShellValue(id);
    fieldShell.value = options.some((s) => s.id === wanted) ? wanted : (options[0]?.id || defaultShell);
    syncShellTrigger();
    for (const btn of shellPickerMenu.querySelectorAll('.shell-picker-option')) {
      btn.classList.toggle('is-active', btn.dataset.id === fieldShell.value);
    }
  }

  function closeShellPicker() {
    shellPicker.classList.remove('is-open');
    shellPickerMenu.classList.add('hidden');
    shellPickerTrigger.setAttribute('aria-expanded', 'false');
  }

  function openShellPicker() {
    shellPicker.classList.add('is-open');
    shellPickerMenu.classList.remove('hidden');
    shellPickerTrigger.setAttribute('aria-expanded', 'true');
    const active = shellPickerMenu.querySelector('.shell-picker-option.is-active');
    if (active) active.focus();
  }

  function populateShellOptions(selectedId) {
    const options = getShellOptions();
    shellPickerMenu.innerHTML = '';

    for (const shell of options) {
      const item = document.createElement('li');
      item.setAttribute('role', 'presentation');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shell-picker-option';
      btn.dataset.id = shell.id;
      btn.setAttribute('role', 'option');
      btn.title = shellPath(shell) || shell.name;

      const name = document.createElement('span');
      name.className = 'shell-picker-name';
      name.textContent = shell.name;

      const pathEl = document.createElement('span');
      pathEl.className = 'shell-picker-path';
      const pathText = shellPath(shell);
      pathEl.textContent = pathText;
      pathEl.hidden = !pathText;

      btn.append(name, pathEl);
      btn.addEventListener('click', () => {
        setShellValue(shell.id);
        closeShellPicker();
      });

      item.appendChild(btn);
      shellPickerMenu.appendChild(item);
    }

    setShellValue(selectedId);
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

  function closeWindow() {
    window.close();
  }

  async function saveEditor(event) {
    event.preventDefault();
    const payload = {
      command: fieldCommand.value,
      name: fieldName.value,
      cwd: fieldCwd.value,
      imagePath: draftImagePath,
      showTerminal: fieldTerminal.checked,
      shell: fieldShell.value || defaultShell
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
    closeWindow();
  }

  async function deleteCurrent() {
    if (!editingId) return;
    const ok = confirm('Delete this macro?');
    if (!ok) return;
    await window.cmdDeck.deleteMacro(editingId);
    closeWindow();
  }

  async function init() {
    const state = await window.cmdDeck.getState();
    shellOptions = state.shells || [];
    defaultShell = state.defaultShell || (state.platform === 'darwin' ? 'zsh' : 'powershell');
    document.body.classList.add(`platform-${state.platform || 'win32'}`);
    if (state.dark) document.body.classList.add('dark');

    const macro = editingId
      ? (state.macros || []).find((m) => m.id === editingId)
      : null;

    document.title = editingId ? 'Edit Macro' : 'Add Macro';
    fieldCommand.value = macro?.command || '';
    fieldName.value = macro?.name || '';
    fieldCwd.value = macro?.cwd || '';
    fieldTerminal.checked = !!macro?.showTerminal;
    populateShellOptions(macro?.shell || macro?.terminalApp || defaultShell);
    setImagePreview(macro?.imagePath || null);
    btnDelete.classList.toggle('hidden', !editingId);
    fieldCommand.focus();
  }

  editorForm.addEventListener('submit', saveEditor);
  document.getElementById('btn-cancel').addEventListener('click', closeWindow);
  document.getElementById('btn-delete').addEventListener('click', deleteCurrent);

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

  shellPickerTrigger.addEventListener('click', () => {
    if (shellPicker.classList.contains('is-open')) closeShellPicker();
    else openShellPicker();
  });

  document.addEventListener('mousedown', (event) => {
    if (!shellPicker.contains(event.target)) closeShellPicker();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (shellPicker.classList.contains('is-open')) {
        event.preventDefault();
        closeShellPicker();
        shellPickerTrigger.focus();
        return;
      }
      closeWindow();
    }
  });

  init().catch((err) => {
    console.error(err);
    showToast('Failed to load editor', true);
  });
})();
