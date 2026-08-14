(() => {
  const params = new URLSearchParams(window.location.search);
  let editingId = params.get('id') || null;

  const editorForm = document.getElementById('editor-form');
  const fieldCommand = document.getElementById('field-command');
  const fieldName = document.getElementById('field-name');
  const fieldCwd = document.getElementById('field-cwd');
  const fieldTerminal = document.getElementById('field-terminal');
  const fieldShell = document.getElementById('field-shell');
  const fieldShortcut = document.getElementById('field-shortcut');
  const fieldConfirm = document.getElementById('field-confirm');
  const fieldConfirmMsg = document.getElementById('field-confirm-msg');
  const shellPicker = document.getElementById('shell-picker');
  const shellPickerTrigger = document.getElementById('shell-picker-trigger');
  const shellPickerMenu = document.getElementById('shell-picker-menu');
  const shellPickerName = document.getElementById('shell-picker-name');
  const shellPickerPath = document.getElementById('shell-picker-path');
  const shellHint = document.getElementById('shell-hint');
  const imagePreview = document.getElementById('image-preview');
  const btnDelete = document.getElementById('btn-delete');
  const toast = document.getElementById('toast');
  const deleteDialog = document.getElementById('delete-dialog');
  const deleteCancel = document.getElementById('delete-cancel');
  const deleteConfirm = document.getElementById('delete-confirm');
  const codeGutter = document.getElementById('code-gutter');
  const statusCursor = document.getElementById('status-cursor');
  const statusLines = document.getElementById('status-lines');
  const statusShell = document.getElementById('status-shell');

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
    shellPickerTrigger.title = pathText || shell?.name || 'Run with';
    shellHint.textContent = 'Uses this shell’s PATH and environment';
    statusShell.textContent = shell?.name || defaultShell;
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
    window.cmdDeck.closeWindow();
  }

  function lineCount(text) {
    if (!text) return 1;
    let n = 1;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) n++;
    }
    return n;
  }

  function syncGutter() {
    const lines = lineCount(fieldCommand.value);
    const width = String(lines).length;
    let html = '';
    for (let i = 1; i <= lines; i++) {
      html += `${i}\n`;
    }
    codeGutter.textContent = html;
    codeGutter.style.width = `${Math.max(2, width) + 1.25}ch`;
    statusLines.textContent = lines === 1 ? '1 line' : `${lines} lines`;
  }

  function syncCursor() {
    const value = fieldCommand.value;
    const pos = fieldCommand.selectionStart || 0;
    let line = 1;
    let col = 1;
    for (let i = 0; i < pos; i++) {
      if (value.charCodeAt(i) === 10) {
        line++;
        col = 1;
      } else {
        col++;
      }
    }
    statusCursor.textContent = `Ln ${line}, Col ${col}`;
  }

  function syncEditorChrome() {
    syncGutter();
    syncCursor();
  }

  function indentSelection(outdent) {
    const start = fieldCommand.selectionStart;
    const end = fieldCommand.selectionEnd;
    const value = fieldCommand.value;
    const tab = '\t';

    if (start !== end) {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const block = value.slice(lineStart, end);
      const lines = block.split('\n');
      const next = lines.map((line) => {
        if (outdent) {
          if (line.startsWith(tab)) return line.slice(1);
          if (line.startsWith('  ')) return line.slice(2);
          return line;
        }
        return tab + line;
      }).join('\n');
      fieldCommand.value = value.slice(0, lineStart) + next + value.slice(end);
      fieldCommand.selectionStart = lineStart;
      fieldCommand.selectionEnd = lineStart + next.length;
    } else if (outdent) {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const before = value.slice(lineStart, start);
      if (before.endsWith(tab)) {
        fieldCommand.value = value.slice(0, start - 1) + value.slice(start);
        fieldCommand.selectionStart = fieldCommand.selectionEnd = start - 1;
      } else if (before.endsWith('  ')) {
        fieldCommand.value = value.slice(0, start - 2) + value.slice(start);
        fieldCommand.selectionStart = fieldCommand.selectionEnd = start - 2;
      }
    } else {
      fieldCommand.value = value.slice(0, start) + tab + value.slice(end);
      fieldCommand.selectionStart = fieldCommand.selectionEnd = start + tab.length;
    }
    syncEditorChrome();
  }

  async function saveEditor(event) {
    if (event) event.preventDefault();
    const payload = {
      command: fieldCommand.value,
      name: fieldName.value,
      cwd: fieldCwd.value,
      imagePath: draftImagePath,
      showTerminal: fieldTerminal.checked,
      shell: fieldShell.value || defaultShell,
      actionType: 'runCommand',
      shortcut: fieldShortcut.value.trim() || null,
      confirmBeforeRun: fieldConfirm.checked,
      confirmMessage: fieldConfirmMsg.value.trim() || null,
    };
    if (!payload.command.trim()) {
      showToast('Command is required', true);
      fieldCommand.focus();
      return;
    }

    if (editingId) {
      await window.cmdDeck.updateMacro(editingId, payload);
    } else {
      await window.cmdDeck.addMacro(payload);
    }
    closeWindow();
  }

  function askDeleteConfirmation() {
    deleteDialog.classList.remove('hidden');
    deleteConfirm.focus();

    return new Promise((resolve) => {
      const finish = (confirmed) => {
        deleteDialog.classList.add('hidden');
        deleteCancel.removeEventListener('click', onCancel);
        deleteConfirm.removeEventListener('click', onConfirm);
        deleteDialog.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKeyDown);
        resolve(confirmed);
      };
      const onCancel = () => finish(false);
      const onConfirm = () => finish(true);
      const onBackdrop = (event) => {
        if (event.target === deleteDialog) finish(false);
      };
      const onKeyDown = (event) => {
        if (event.key === 'Escape') finish(false);
      };

      deleteCancel.addEventListener('click', onCancel);
      deleteConfirm.addEventListener('click', onConfirm);
      deleteDialog.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKeyDown);
    });
  }

  async function deleteCurrent() {
    if (!editingId) return;
    if (!await askDeleteConfirmation()) return;
    await window.cmdDeck.deleteMacro(editingId);
    closeWindow();
  }

  async function loadEditorData() {
    const data = await window.cmdDeck.getEditorInit(editingId);
    shellOptions = data.shells || [];
    defaultShell = data.defaultShell || (data.platform === 'darwin' ? 'zsh' : 'powershell');
    document.body.classList.add(`platform-${data.platform || 'win32'}`);
    if (data.dark) document.body.classList.add('dark');
    const hint = document.querySelector('.ide-status-hint');
    if (hint) {
      hint.textContent = data.platform === 'darwin'
        ? 'Tab indent · ⌘S save'
        : 'Tab indent · Ctrl+S save';
    }

    const macro = data.macro || null;

    document.title = editingId ? 'Edit Macro' : 'Add Macro';
    fieldCommand.value = macro?.command || '';
    fieldName.value = macro?.name || '';
    fieldCwd.value = macro?.cwd || '';
    fieldTerminal.checked = !!macro?.showTerminal;
    fieldShortcut.value = macro?.shortcut || '';
    fieldConfirm.checked = !!macro?.confirmBeforeRun;
    fieldConfirmMsg.value = macro?.confirmMessage || '';
    populateShellOptions(macro?.shell || macro?.terminalApp || defaultShell);
    setImagePreview(macro?.imagePath || null);
    btnDelete.classList.toggle('hidden', !editingId);
    syncEditorChrome();
  }

  async function openEditor(macroId) {
    editingId = macroId || null;
    await loadEditorData();
    fieldCommand.focus();
    const len = fieldCommand.value.length;
    fieldCommand.setSelectionRange(len, len);
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

  fieldCommand.addEventListener('input', syncEditorChrome);
  fieldCommand.addEventListener('scroll', () => {
    codeGutter.scrollTop = fieldCommand.scrollTop;
  });
  fieldCommand.addEventListener('click', syncCursor);
  fieldCommand.addEventListener('keyup', syncCursor);
  fieldCommand.addEventListener('select', syncCursor);

  fieldCommand.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      indentSelection(event.shiftKey);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      // keep default newline; status updates on input
    }
  });

  shellPickerTrigger.addEventListener('click', () => {
    if (shellPicker.classList.contains('is-open')) closeShellPicker();
    else openShellPicker();
  });

  document.addEventListener('mousedown', (event) => {
    if (!shellPicker.contains(event.target)) closeShellPicker();
  });

  document.addEventListener('keydown', (event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveEditor();
      return;
    }
    if (mod && event.key === 'Enter') {
      event.preventDefault();
      saveEditor();
      return;
    }
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

  window.cmdDeck.onEditorOpen((macroId) => {
    openEditor(macroId).catch((err) => {
      console.error(err);
      showToast('Failed to load editor', true);
    });
  });

  openEditor(editingId).catch((err) => {
    console.error(err);
    showToast('Failed to load editor', true);
  });
})();
