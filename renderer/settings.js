(() => {
  const settingAot = document.getElementById('setting-aot');
  const settingMinimised = document.getElementById('setting-minimised');
  const settingOpacity = document.getElementById('setting-opacity');
  const settingOpacityOut = document.getElementById('setting-opacity-out');
  const settingLan = document.getElementById('setting-lan');
  const settingLanPort = document.getElementById('setting-lan-port');
  const lanUrl = document.getElementById('lan-url');
  const packSelect = document.getElementById('pack-select');
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

  async function syncLanUrl() {
    const info = await window.cmdDeck.getLanInfo();
    if (!info.enabled) {
      lanUrl.textContent = 'Remote disabled';
      return;
    }
    lanUrl.textContent = `Open http://<your-ip>:${info.port}/?token=${info.token} on your phone (same Wi‑Fi)`;
  }

  function applySettings(settings) {
    settingAot.checked = !!settings.alwaysOnTop;
    settingMinimised.checked = !!settings.startMinimised;
    settingOpacity.value = String(opacityToTransparencyPercent(settings.opacity));
    settingLan.checked = !!settings.lanWebEnabled;
    settingLanPort.value = String(settings.lanWebPort || 8742);
    syncOpacityOutput();
    syncLanUrl();
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
    applySettings(state.settings || {});
    await loadPacks();

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
  settingOpacity.addEventListener('input', () => {
    syncOpacityOutput();
    window.cmdDeck.setSettings({ opacity: transparencyPercentToOpacity(settingOpacity.value) });
  });
  settingLan.addEventListener('change', async () => {
    await window.cmdDeck.setSettings({ lanWebEnabled: settingLan.checked });
    syncLanUrl();
  });
  settingLanPort.addEventListener('change', async () => {
    await window.cmdDeck.setSettings({ lanWebPort: Number(settingLanPort.value) || 8742 });
    syncLanUrl();
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
