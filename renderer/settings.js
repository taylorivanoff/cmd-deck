(() => {
  const settingAot = document.getElementById('setting-aot');
  const settingMinimised = document.getElementById('setting-minimised');
  const settingOpacity = document.getElementById('setting-opacity');
  const settingOpacityOut = document.getElementById('setting-opacity-out');
  const packSelect = document.getElementById('pack-select');
  const settingsMeta = document.getElementById('settings-meta');
  const sheet = document.querySelector('.dialog-sheet');

  let lastFitW = 0;
  let lastFitH = 0;
  let revealed = false;
  let fitTimer = null;

  function opacityToTransparencyPercent(opacity) {
    return Math.round((1 - Math.min(1, Math.max(0.35, Number(opacity) || 0.94))) * 100);
  }

  function transparencyPercentToOpacity(percent) {
    return Math.min(1, Math.max(0.35, 1 - (Number(percent) || 0) / 100));
  }

  function syncOpacityOutput() {
    settingOpacityOut.textContent = `${settingOpacity.value}%`;
  }

  function currentWindow() {
    const t = window.__TAURI__;
    if (!t) return null;
    const get =
      t.webviewWindow?.getCurrentWebviewWindow ||
      t.window?.getCurrentWindow;
    return get ? get() : null;
  }

  async function fitWindowToContent() {
    if (!sheet) return;
    const width = Math.max(320, Math.ceil(sheet.getBoundingClientRect().width) || 340);
    const height = Math.max(200, Math.ceil(sheet.scrollHeight));
    const sizeChanged = width !== lastFitW || height !== lastFitH;
    lastFitW = width;
    lastFitH = height;

    const t = window.__TAURI__;
    const win = currentWindow();
    const LogicalSize = t?.dpi?.LogicalSize || t?.window?.LogicalSize;

    try {
      if (sizeChanged) {
        if (win && LogicalSize) {
          const size = new LogicalSize(width, height);
          await win.setSize(size);
          if (typeof win.setMinSize === 'function') await win.setMinSize(size);
        } else if (t?.core?.invoke) {
          const label = win?.label || 'settings';
          const value = { Logical: { width, height } };
          await t.core.invoke('plugin:window|set_size', { label, value });
          await t.core.invoke('plugin:window|set_min_size', { label, value });
        }
      }

      if (!revealed && win) {
        if (typeof win.show === 'function') await win.show();
        if (typeof win.unminimize === 'function') await win.unminimize();
        if (typeof win.setFocus === 'function') await win.setFocus();
        revealed = true;
      }
    } catch (err) {
      console.error('Failed to fit settings window', err);
      if (!revealed && win?.show) {
        try {
          await win.show();
          revealed = true;
        } catch (_) { /* ignore */ }
      }
    }
  }

  function scheduleFit() {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      requestAnimationFrame(() => {
        fitWindowToContent().catch((err) => console.error(err));
      });
    }, 16);
  }

  async function applySettings(settings) {
    settingAot.checked = !!settings.alwaysOnTop;
    settingMinimised.checked = !!settings.startMinimised;
    settingOpacity.value = String(opacityToTransparencyPercent(settings.opacity));
    syncOpacityOutput();
  }

  async function loadPacks() {
    const packs = await window.cmdDeck.listPacks();
    packSelect.innerHTML = '';
    for (const pack of packs || []) {
      const opt = document.createElement('option');
      opt.value = pack.path;
      opt.textContent = pack.name + (pack.description ? ` — ${pack.description}` : '');
      packSelect.appendChild(opt);
    }
  }

  async function init() {
    const state = await window.cmdDeck.getState();
    document.body.classList.add(`platform-${state.platform || 'win32'}`);
    if (state.dark) document.body.classList.add('dark');
    settingsMeta.textContent = `CmdDeck v${state.version || '1.0.0'} · ${state.platform}`;
    await applySettings(state.settings || {});
    await loadPacks();
    await fitWindowToContent();

    window.cmdDeck.onSettingsChanged((next) => {
      if (!next) return;
      applySettings(next);
      scheduleFit();
    });

    if (sheet && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => scheduleFit());
      ro.observe(sheet);
    }
  }

  settingAot.addEventListener('change', () => {
    window.cmdDeck.setSettings({ alwaysOnTop: settingAot.checked });
  });
  settingMinimised.addEventListener('change', () => {
    window.cmdDeck.setSettings({ startMinimised: settingMinimised.checked });
  });
  settingOpacity.addEventListener('input', () => {
    syncOpacityOutput();
    window.cmdDeck.setSettings({ opacity: transparencyPercentToOpacity(settingOpacity.value) });
  });

  document.getElementById('btn-open-log').addEventListener('click', () => {
    window.cmdDeck.openLog();
  });

  document.getElementById('btn-add-profile').addEventListener('click', async () => {
    const name = prompt('Profile name:', 'New profile');
    if (name === null) return;
    await window.cmdDeck.addProfile(name.trim());
  });

  document.getElementById('btn-import-pack').addEventListener('click', async () => {
    const path = await window.cmdDeck.pickPack();
    if (!path) return;
    const result = await window.cmdDeck.importPackFile(path, 'merge');
    if (result?.error) alert(result.error);
  });

  document.getElementById('btn-export-pack').addEventListener('click', async () => {
    const pack = await window.cmdDeck.exportPack();
    const suggested = pack?.name || 'cmddeck-pack';
    const path = await window.cmdDeck.savePack(suggested);
    if (!path) return;
    const result = await window.cmdDeck.exportPackToFile(path);
    if (result?.error) alert(result.error);
  });

  document.getElementById('btn-install-pack').addEventListener('click', async () => {
    const path = packSelect.value;
    if (!path) return;
    const result = await window.cmdDeck.importPackFile(path, 'merge');
    if (result?.error) alert(result.error);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.cmdDeck.closeWindow();
  });

  init().catch((err) => console.error(err));
})();
