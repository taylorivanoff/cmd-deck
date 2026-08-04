const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  screen,
  shell,
  nativeTheme
} = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { randomUUID } = require('crypto');
const store = require('./store');
const runner = require('./runner');
const {
  createTerminalWindow,
  sendToTerminal,
  closeTerminalWindow,
  closeAllTerminalWindows
} = require('./terminal-window');
const {
  openEditorWindow,
  openSettingsWindow,
  getSettingsWindow,
  setDialogWindowsAlwaysOnTop,
  closeDialogWindows
} = require('./dialog-windows');
const {
  openLogWindow,
  sendToLogWindow,
  setLogWindowAlwaysOnTop,
  closeLogWindow
} = require('./log-window');
const logger = require('./logger');
const shells = require('./shells');
const { createTray, updateTrayMenu, destroyTray, getIconPath } = require('./tray');

const APP_NAME = 'CmdDeck';
const START_MINIMIZED_ARG = '--start-minimised';
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let mainWindow = null;
let splashWindow = null;
let trayHandlers = null;
let isQuitting = false;
let manualUpdateCheck = false;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  // Dev-only: reload BrowserWindows on renderer changes; hard-restart on main/preload changes.
  if (!app.isPackaged) {
    try {
      require('electron-reloader')(module, {
        watchRenderer: true,
        ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/bun.lock', '**/package-lock.json']
      });
    } catch (_) {
      // electron-reloader is a devDependency; ignore if missing.
    }
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function imagesDir() {
  const dir = path.join(app.getPath('userData'), 'button-images');
  ensureDir(dir);
  return dir;
}

function getStartMinimised() {
  return store.getSettings().startMinimised;
}

function syncLoginItemArgs() {
  const login = app.getLoginItemSettings();
  if (!login.openAtLogin) return;
  app.setLoginItemSettings({
    openAtLogin: true,
    path: process.execPath,
    args: getStartMinimised() ? [START_MINIMIZED_ARG] : []
  });
}

const MIN_WIDTH = 140;
const MIN_HEIGHT = 140;
const DEFAULT_BOUNDS = { width: 380, height: 460 };
let saveBoundsTimer = null;

function normalizeBounds(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_BOUNDS };
  return {
    x: Number.isFinite(raw.x) ? Math.round(raw.x) : undefined,
    y: Number.isFinite(raw.y) ? Math.round(raw.y) : undefined,
    width: Math.max(MIN_WIDTH, Math.round(raw.width || DEFAULT_BOUNDS.width)),
    height: Math.max(MIN_HEIGHT, Math.round(raw.height || DEFAULT_BOUNDS.height))
  };
}

function boundsVisibleOnAnyDisplay(bounds) {
  const displays = screen.getAllDisplays();
  if (!displays.length) return true;
  // Treat as visible if the window's center (or top-left) lands on a display.
  const cx = (bounds.x ?? 0) + bounds.width / 2;
  const cy = (bounds.y ?? 0) + bounds.height / 2;
  return displays.some((d) => {
    const { x, y, width, height } = d.bounds;
    const onCenter = cx >= x && cx < x + width && cy >= y && cy < y + height;
    const onOrigin = Number.isFinite(bounds.x)
      && Number.isFinite(bounds.y)
      && bounds.x < x + width
      && bounds.x + bounds.width > x
      && bounds.y < y + height
      && bounds.y + bounds.height > y;
    return onCenter || onOrigin;
  });
}

function getWindowBounds() {
  const saved = normalizeBounds(store.getWindowBounds());
  if (!Number.isFinite(saved.x) || !Number.isFinite(saved.y)) {
    return { width: saved.width, height: saved.height };
  }
  if (!boundsVisibleOnAnyDisplay(saved)) {
    return { width: saved.width, height: saved.height };
  }
  return saved;
}

function saveWindowBounds(immediate = false) {
  const persist = () => {
    saveBoundsTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) return;
    store.setWindowBounds(normalizeBounds(mainWindow.getBounds()));
  };

  if (immediate) {
    if (saveBoundsTimer) {
      clearTimeout(saveBoundsTimer);
      saveBoundsTimer = null;
    }
    persist();
    return;
  }

  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(persist, 150);
}

function createSplash() {
  const splashPath = path.join(app.getAppPath(), 'resources', 'splash.html');
  // Opaque window (not transparent): on Windows, mainWindow.setOpacity can
  // bleed into other transparent BrowserWindows in the same process.
  splashWindow = new BrowserWindow({
    width: 280,
    height: 320,
    frame: false,
    transparent: false,
    backgroundColor: '#1c1c1e',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: { nodeIntegration: false }
  });
  splashWindow.setOpacity(1);
  splashWindow.setMenu(null);
  splashWindow.loadFile(splashPath);
  splashWindow.center();
  splashWindow.show();
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.destroy();
    splashWindow = null;
  }
}

function platformWindowOptions() {
  const isMac = process.platform === 'darwin';
  if (isMac) {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 10, y: 7 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: '#00000000'
    };
  }
  return {
    frame: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f3f3f3',
    autoHideMenuBar: true
  };
}

function applyWindowOpacity(value) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Never apply pad transparency while the splash is up — Windows can
  // composite that opacity onto sibling windows.
  if (splashWindow && !splashWindow.isDestroyed()) return;
  const opacity = Math.min(1, Math.max(0.35, Number(value) || 0.94));
  mainWindow.setOpacity(opacity);
}

function createWindow() {
  if (mainWindow) return mainWindow;

  const bounds = getWindowBounds();
  const settings = store.getSettings();

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    show: false,
    alwaysOnTop: settings.alwaysOnTop,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    icon: getIconPath(),
    ...platformWindowOptions(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Electron can drop x/y when constructing with show:false - re-apply explicitly.
  if (Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
    mainWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    }, false);
  } else {
    mainWindow.setSize(bounds.width, bounds.height, false);
  }

  mainWindow.setMenu(null);
  // Keep main at full opacity until splash closes (see applyWindowOpacity).
  mainWindow.setOpacity(1);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    closeSplash();
    applyWindowOpacity(store.getSettings().opacity);
    const startMinimised = process.argv.includes(START_MINIMIZED_ARG) || getStartMinimised();
    if (!startMinimised) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.on('resize', () => saveWindowBounds(false));
  mainWindow.on('move', () => saveWindowBounds(false));
  mainWindow.on('resized', () => saveWindowBounds(true));
  mainWindow.on('moved', () => saveWindowBounds(true));
  mainWindow.on('close', (event) => {
    saveWindowBounds(true);
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('hide', () => saveWindowBounds(true));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function showWindow() {
  if (!mainWindow) createWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
}

function toggleWindow() {
  if (!mainWindow || !mainWindow.isVisible()) showWindow();
  else hideWindow();
}

function applyAlwaysOnTop(value) {
  store.setSettings({ alwaysOnTop: value });
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(value);
  setDialogWindowsAlwaysOnTop(value);
  setLogWindowAlwaysOnTop(value);
  if (trayHandlers) updateTrayMenu(trayHandlers);
  sendToRenderer('settings:changed', store.getSettings());
}

function macroLabel(macro) {
  if (!macro) return 'Macro';
  const name = (macro.name || '').trim();
  if (name) return name;
  const cmd = (macro.command || '').trim().split(/\r?\n/).find((line) => line.trim()) || 'Command';
  return cmd.length > 60 ? `${cmd.slice(0, 57)}…` : cmd;
}

function logMacroStatus(payload) {
  if (!payload?.id) return;
  const macro = store.getMacros().find((m) => m.id === payload.id);
  const label = payload.name || macroLabel(macro);
  const shell = payload.shell ? ` [${payload.shell}]` : '';

  if (payload.status === 'running') {
    if (payload.pending) {
      logger.addLog('info', `Queued “${label}”${shell}`, { macroId: payload.id });
    } else {
      const pid = payload.pid ? ` pid=${payload.pid}` : '';
      logger.addLog('info', `Started “${label}”${shell}${pid}`, { macroId: payload.id });
    }
    return;
  }
  if (payload.status === 'success') {
    logger.addLog('info', `Finished “${label}”${shell}`, { macroId: payload.id });
    return;
  }
  if (payload.status === 'error') {
    logger.addLog('error', `Failed “${label}”${shell}: ${payload.error || 'Command failed'}`, {
      macroId: payload.id
    });
    return;
  }
  if (payload.status === 'stopped') {
    logger.addLog('warn', `Stopped “${label}”${shell}`, { macroId: payload.id });
  }
}

function setStartMinimised(value) {
  store.setSettings({ startMinimised: value });
  syncLoginItemArgs();
  if (trayHandlers) updateTrayMenu(trayHandlers);
  sendToRenderer('settings:changed', store.getSettings());
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
  const settingsWin = getSettingsWindow();
  if (settingsWin) settingsWin.webContents.send(channel, payload);
}

function showUpdateDialog(options) {
  return dialog.showMessageBox({ noLink: true, ...options });
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) return;
  manualUpdateCheck = manual;
  try {
    await autoUpdater.checkForUpdates();
  } catch (_) {
    manualUpdateCheck = false;
  }
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-not-available', () => {
    manualUpdateCheck = false;
  });

  autoUpdater.on('update-downloaded', (info) => {
    const installNow = manualUpdateCheck;
    manualUpdateCheck = false;
    if (installNow) {
      isQuitting = true;
      autoUpdater.quitAndInstall(true, true);
      return;
    }
    showUpdateDialog({
      type: 'info',
      title: APP_NAME,
      message: `Version ${info.version} is ready to install.`,
      detail: 'Restart the app to apply the update.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) {
        isQuitting = true;
        autoUpdater.quitAndInstall(true, true);
      }
    });
  });

  autoUpdater.on('error', () => {
    manualUpdateCheck = false;
  });

  checkForUpdates(false);
  setInterval(() => checkForUpdates(false), UPDATE_CHECK_INTERVAL_MS);
}

function copyImageToStore(sourcePath) {
  const ext = path.extname(sourcePath).toLowerCase() || '.png';
  const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'];
  if (!allowed.includes(ext)) {
    throw new Error('Unsupported image type.');
  }
  const dest = path.join(imagesDir(), `${randomUUID()}${ext}`);
  fs.copyFileSync(sourcePath, dest);
  return dest;
}

function removeImageIfOwned(imagePath) {
  if (!imagePath) return;
  const dir = imagesDir();
  if (imagePath.startsWith(dir) && fs.existsSync(imagePath)) {
    try { fs.unlinkSync(imagePath); } catch (_) { /* ignore */ }
  }
}

function decorateMacros(macros) {
  return (macros || []).map((macro) => ({
    ...macro,
    imageUrl: macro.imagePath && fs.existsSync(macro.imagePath)
      ? pathToFileURL(macro.imagePath).href
      : null
  }));
}

function broadcastMacros() {
  const macros = decorateMacros(store.getMacros());
  sendToRenderer('macros:changed', macros);
  return macros;
}

/** @type {Set<string>} */
const pendingStarts = new Set();

function runMacroById(id) {
  const macro = store.getMacros().find((m) => m.id === id);
  if (!macro) return { ok: false, error: 'Macro not found.' };

  // Spawn first — creating the terminal BrowserWindow is comparatively slow.
  const result = runner.runMacro(macro);
  if (!result.ok) return result;

  if (macro.showTerminal) {
    createTerminalWindow(macro, getIconPath(), {
      onUserClose: (macroId) => {
        if (runner.getRunning(macroId)) runner.stopMacro(macroId);
      }
    });
    const running = runner.getRunning(id);
    sendToTerminal(id, 'terminal:init', {
      id,
      name: macro.name,
      command: macro.command,
      pid: running?.pid,
      stdout: running?.stdout || '',
      stderr: running?.stderr || ''
    });
  }
  return result;
}

function queueMacroRun(id) {
  const macro = store.getMacros().find((m) => m.id === id);
  if (!macro) return { ok: false, error: 'Macro not found.' };
  if (runner.getRunning(id) || pendingStarts.has(id)) {
    return { ok: false, error: 'Already running.' };
  }

  pendingStarts.add(id);
  // Optimistic UI feedback before PATH/shell work finishes.
  const pendingStatus = {
    id,
    status: 'running',
    name: macro.name || '',
    command: macro.command || '',
    showTerminal: !!macro.showTerminal,
    pending: true
  };
  logMacroStatus(pendingStatus);
  sendToRenderer('macros:status', pendingStatus);

  setImmediate(() => {
    if (!pendingStarts.has(id)) return;
    pendingStarts.delete(id);
    try {
      const result = runMacroById(id);
      if (!result?.ok) {
        const failStatus = {
          id,
          status: 'error',
          error: result?.error || 'Failed to run',
          showTerminal: !!macro.showTerminal
        };
        logMacroStatus(failStatus);
        sendToRenderer('macros:status', failStatus);
        sendToRenderer('macros:toast', {
          message: result?.error || 'Failed to run',
          error: true
        });
        return;
      }
    } catch (err) {
      const failStatus = {
        id,
        status: 'error',
        error: err?.message || String(err),
        showTerminal: !!macro.showTerminal
      };
      logMacroStatus(failStatus);
      sendToRenderer('macros:status', failStatus);
      sendToRenderer('macros:toast', {
        message: err?.message || String(err),
        error: true
      });
    }
  });

  return { ok: true, queued: true };
}

function duplicateMacro(id) {
  const existing = store.getMacros().find((m) => m.id === id);
  if (!existing) return null;
  const name = (existing.name || '').trim();
  store.addMacro({
    command: existing.command,
    name: name ? `${name} copy` : '',
    imagePath: existing.imagePath || null,
    cwd: existing.cwd || null,
    showTerminal: !!existing.showTerminal,
    shell: existing.shell || existing.terminalApp || null
  });
  return broadcastMacros();
}

function moveMacro(id, direction) {
  const macros = store.getMacros();
  const index = macros.findIndex((m) => m.id === id);
  if (index < 0) return null;
  const target = index + direction;
  if (target < 0 || target >= macros.length) return broadcastMacros();
  const next = macros.slice();
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  store.setMacros(next);
  return broadcastMacros();
}

function popupMacroContextMenu(event, id) {
  const macro = store.getMacros().find((m) => m.id === id);
  if (!macro) return { ok: false };

  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const isRunning = !!runner.getRunning(id);
  const macros = store.getMacros();
  const index = macros.findIndex((m) => m.id === id);
  const alwaysOnTop = !!store.getSettings().alwaysOnTop;

  const menu = Menu.buildFromTemplate([
    {
      label: isRunning ? 'Stop' : 'Run',
      click: () => {
        if (isRunning) runner.stopMacro(id);
        else {
          const result = runMacroById(id);
          if (!result?.ok && win && !win.isDestroyed()) {
            win.webContents.send('macros:toast', { message: result?.error || 'Failed to run', error: true });
          }
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Edit',
      click: () => {
        openEditorWindow({
          macroId: id,
          iconPath: getIconPath(),
          parent: mainWindow,
          alwaysOnTop
        });
      }
    },
    {
      label: 'Duplicate',
      click: () => duplicateMacro(id)
    },
    {
      label: 'Move Left',
      enabled: index > 0,
      click: () => moveMacro(id, -1)
    },
    {
      label: 'Move Right',
      enabled: index >= 0 && index < macros.length - 1,
      click: () => moveMacro(id, 1)
    },
    { type: 'separator' },
    {
      label: 'Delete',
      click: async () => {
        const result = await dialog.showMessageBox(win, {
          type: 'warning',
          buttons: ['Delete', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
          title: APP_NAME,
          message: 'Delete this macro?',
          detail: (macro.name || macro.command || '').trim() || undefined
        });
        if (result.response !== 0) return;
        if (macro.imagePath) removeImageIfOwned(macro.imagePath);
        if (runner.getRunning(id)) runner.stopMacro(id);
        store.deleteMacro(id);
        broadcastMacros();
      }
    }
  ]);

  menu.popup({ window: win || undefined });
  return { ok: true };
}

function registerIpc() {
  ipcMain.handle('app:getState', () => ({
    macros: decorateMacros(store.getMacros()),
    settings: store.getSettings(),
    runningIds: runner.getRunningIds(),
    shells: shells.listShells().map(({ id, name, detail }) => ({ id, name, detail })),
    defaultShell: shells.defaultShellId(),
    platform: process.platform,
    version: app.getVersion(),
    dark: nativeTheme.shouldUseDarkColors
  }));

  ipcMain.handle('shells:list', () => ({
    shells: shells.listShells().map(({ id, name, detail }) => ({ id, name, detail })),
    defaultShell: shells.defaultShellId()
  }));

  ipcMain.handle('macros:list', () => decorateMacros(store.getMacros()));

  ipcMain.handle('macros:add', (_e, partial) => {
    store.addMacro(partial || {});
    return broadcastMacros();
  });

  ipcMain.handle('macros:update', (_e, id, partial) => {
    const existing = store.getMacros().find((m) => m.id === id);
    if (!existing) return null;
    if (partial?.imagePath === null && existing.imagePath) {
      removeImageIfOwned(existing.imagePath);
    } else if (partial?.imagePath && partial.imagePath !== existing.imagePath) {
      removeImageIfOwned(existing.imagePath);
    }
    store.updateMacro(id, partial || {});
    return broadcastMacros();
  });

  ipcMain.handle('macros:delete', (_e, id) => {
    const existing = store.getMacros().find((m) => m.id === id);
    if (existing?.imagePath) removeImageIfOwned(existing.imagePath);
    store.deleteMacro(id);
    return broadcastMacros();
  });

  ipcMain.handle('macros:reorder', (_e, orderedIds) => {
    store.reorderMacros(orderedIds || []);
    return broadcastMacros();
  });

  ipcMain.handle('macros:run', (_e, id) => queueMacroRun(id));

  ipcMain.handle('macros:stop', (_e, id) => {
    const wasPending = pendingStarts.delete(id);
    const result = runner.stopMacro(id);
    if (wasPending && !runner.getRunning(id)) {
      const stopped = { id, status: 'stopped' };
      logMacroStatus(stopped);
      sendToRenderer('macros:status', stopped);
      return { ok: true };
    }
    return result;
  });

  ipcMain.handle('ui:macroContextMenu', (event, id) => popupMacroContextMenu(event, id));

  ipcMain.handle('terminal:bootstrap', (_e, id) => {
    const running = runner.getRunning(id);
    if (running) {
      return {
        id,
        status: 'running',
        name: running.name,
        command: running.command,
        pid: running.pid,
        stdout: running.stdout,
        stderr: running.stderr
      };
    }
    const macro = store.getMacros().find((m) => m.id === id);
    if (!macro) return null;
    return {
      id,
      status: 'error',
      name: macro.name,
      command: macro.command,
      error: 'No active command.'
    };
  });

  ipcMain.handle('terminal:close', (_e, id) => {
    if (runner.getRunning(id)) runner.stopMacro(id);
    closeTerminalWindow(id);
    return { ok: true };
  });

  ipcMain.handle('settings:get', () => store.getSettings());

  ipcMain.handle('settings:set', (_e, partial) => {
    const prev = store.getSettings();
    const settings = store.setSettings(partial || {});
    if (partial?.alwaysOnTop !== undefined && partial.alwaysOnTop !== prev.alwaysOnTop) {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(settings.alwaysOnTop);
      setDialogWindowsAlwaysOnTop(settings.alwaysOnTop);
      setLogWindowAlwaysOnTop(settings.alwaysOnTop);
    }
    if (partial?.opacity !== undefined) applyWindowOpacity(settings.opacity);
    if (partial?.startMinimised !== undefined) syncLoginItemArgs();
    if (trayHandlers) updateTrayMenu(trayHandlers);
    sendToRenderer('settings:changed', settings);
    return settings;
  });

  ipcMain.handle('ui:openEditor', (_e, id) => {
    const alwaysOnTop = !!store.getSettings().alwaysOnTop;
    openEditorWindow({
      macroId: id || null,
      iconPath: getIconPath(),
      parent: mainWindow,
      alwaysOnTop
    });
    return { ok: true };
  });

  ipcMain.handle('ui:openSettings', () => {
    const alwaysOnTop = !!store.getSettings().alwaysOnTop;
    openSettingsWindow({
      iconPath: getIconPath(),
      parent: mainWindow,
      alwaysOnTop
    });
    return { ok: true };
  });

  ipcMain.handle('ui:openLog', () => {
    const alwaysOnTop = !!store.getSettings().alwaysOnTop;
    openLogWindow({
      iconPath: getIconPath(),
      parent: mainWindow,
      alwaysOnTop
    });
    return { ok: true };
  });

  ipcMain.handle('log:get', () => logger.getLogs());
  ipcMain.handle('log:clear', () => {
    logger.clearLogs();
    return { ok: true };
  });

  ipcMain.handle('dialog:pickImage', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showOpenDialog(owner, {
      title: 'Choose button image',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'] }
      ]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    try {
      return copyImageToStore(result.filePaths[0]);
    } catch (err) {
      return { error: err.message || String(err) };
    }
  });

  ipcMain.handle('dialog:pickFolder', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showOpenDialog(owner, {
      title: 'Choose working directory',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('shell:showItem', (_e, filePath) => {
    if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
  });
}

app.whenReady().then(() => {
  syncLoginItemArgs();
  createSplash();
  registerIpc();
  createWindow();

  // Warm PATH/shell detection off the click path.
  setImmediate(() => {
    try {
      shells.warmRuntime();
    } catch (err) {
      console.warn('CmdDeck runtime warm-up failed:', err?.message || err);
    }
  });

  trayHandlers = {
    showWindow,
    hideWindow,
    toggleWindow,
    getSettings: () => store.getSettings(),
    setAlwaysOnTop: applyAlwaysOnTop,
    setStartMinimised,
    checkForUpdates: () => checkForUpdates(true),
    quit: () => {
      isQuitting = true;
      app.quit();
    }
  };
  createTray(getIconPath(), trayHandlers);
  setupAutoUpdater();

  logger.onLog((entry) => {
    sendToLogWindow('log:entry', entry);
  });
  logger.addLog('info', `${APP_NAME} ready`);

  runner.onStatus((payload) => {
    logMacroStatus(payload);
    sendToRenderer('macros:status', payload);
    if (payload?.id) sendToTerminal(payload.id, 'terminal:status', payload);
  });

  runner.onOutput((payload) => {
    if (payload?.id) sendToTerminal(payload.id, 'terminal:output', payload);
  });

  app.on('activate', () => {
    showWindow();
  });
});

app.on('window-all-closed', () => {
  // Stay alive in the tray unless the user chose Quit.
  if (isQuitting) app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  saveWindowBounds(true);
  closeDialogWindows();
  closeLogWindow();
  closeAllTerminalWindows();
  closeSplash();
  destroyTray();
});
