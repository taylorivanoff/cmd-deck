(() => {
  const settingAot = document.getElementById('setting-aot');
  const settingMinimised = document.getElementById('setting-minimised');
  const settingColumns = document.getElementById('setting-columns');
  const settingColumnsOut = document.getElementById('setting-columns-out');
  const settingRows = document.getElementById('setting-rows');
  const settingRowsOut = document.getElementById('setting-rows-out');
  const settingOpacity = document.getElementById('setting-opacity');
  const settingOpacityOut = document.getElementById('setting-opacity-out');
  const settingsMeta = document.getElementById('settings-meta');

  function opacityToTransparencyPercent(opacity) {
    return Math.round((1 - Math.min(1, Math.max(0.35, Number(opacity) || 0.94))) * 100);
  }

  function transparencyPercentToOpacity(percent) {
    return Math.min(1, Math.max(0.35, 1 - (Number(percent) || 0) / 100));
  }

  function syncOpacityOutput() {
    settingOpacityOut.textContent = `${settingOpacity.value}%`;
  }

  function applySettings(settings) {
    settingAot.checked = !!settings.alwaysOnTop;
    settingMinimised.checked = !!settings.startMinimised;
    settingColumns.value = String(settings.columns || 3);
    settingColumnsOut.textContent = settingColumns.value;
    settingRows.value = String(settings.rows || 3);
    settingRowsOut.textContent = settingRows.value;
    settingOpacity.value = String(opacityToTransparencyPercent(settings.opacity));
    syncOpacityOutput();
  }

  async function init() {
    const state = await window.cmdDeck.getState();
    document.body.classList.add(`platform-${state.platform || 'win32'}`);
    if (state.dark) document.body.classList.add('dark');
    settingsMeta.textContent = `CmdDeck v${state.version || '1.0.0'} · ${state.platform}`;
    applySettings(state.settings || {});

    window.cmdDeck.onSettingsChanged((next) => {
      if (next) applySettings(next);
    });
  }

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
  settingRows.addEventListener('input', () => {
    settingRowsOut.textContent = settingRows.value;
  });
  settingRows.addEventListener('change', () => {
    window.cmdDeck.setSettings({ rows: Number(settingRows.value) });
  });
  settingOpacity.addEventListener('input', () => {
    syncOpacityOutput();
    window.cmdDeck.setSettings({ opacity: transparencyPercentToOpacity(settingOpacity.value) });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.close();
  });

  init().catch((err) => console.error(err));
})();
