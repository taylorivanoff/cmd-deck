const {
  app,
  BrowserWindow,
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
const { createTray, updateTrayMenu, destroyTray, getIconPath } = require('./tray');

const APP_NAME = 'CmdDeck';
const START_MINIMIZED_ARG = '--start-minimised';

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

function getWindowBounds() {
  const saved = store.getWindowBounds();
  const defaults = { width: 380, height: 460 };
  if (!saved) return defaults;
  const displays = screen.getAllDisplays();
  const inBounds = displays.some((d) => {
    const { x, y, width, height } = d.bounds;
    return saved.x >= x && saved.x < x + width && saved.y >= y && saved.y < y + height;
  });
  if (!inBounds) return defaults;
  return {
    x: saved.x,
    y: saved.y,
    width: Math.max(280, saved.width || defaults.width),
    height: Math.max(320, saved.height || defaults.height)
  };
}

function saveWindowBounds() {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized() && !mainWindow.isMaximized()) {
    store.setWindowBounds(mainWindow.getBounds());
  }
}

function createSplash() {
  const splashPath = path.join(app.getAppPath(), 'resources', 'splash.html');
  splashWindow = new BrowserWindow({
    width: 280,
    height: 320,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: { nodeIntegration: false }
  });
  splashWindow.loadFile(splashPath);
  splashWindow.center();
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
      trafficLightPosition: { x: 12, y: 12 },
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

function createWindow() {
  if (mainWindow) return mainWindow;

  const bounds = getWindowBounds();
  const settings = store.getSettings();

  mainWindow = new BrowserWindow({
    ...bounds,
    show: false,
    alwaysOnTop: settings.alwaysOnTop,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    minWidth: 280,
    minHeight: 320,
    icon: getIconPath(),
    ...platformWindowOptions(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setMenu(null);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    closeSplash();
    const startMinimised = process.argv.includes(START_MINIMIZED_ARG) || getStartMinimised();
    if (!startMinimised) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.on('resize', saveWindowBounds);
  mainWindow.on('move', saveWindowBounds);
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
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
  if (trayHandlers) updateTrayMenu(trayHandlers);
  sendToRenderer('settings:changed', store.getSettings());
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
}

function showUpdateDialog(options) {
  return dialog.showMessageBox({ noLink: true, ...options });
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    if (manual) {
      await showUpdateDialog({
        type: 'info',
        title: APP_NAME,
        message: 'Updates are only available in the installed app.',
        buttons: ['OK']
      });
    }
    return;
  }
  manualUpdateCheck = manual;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    if (manual) {
      await showUpdateDialog({
        type: 'error',
        title: APP_NAME,
        message: 'Could not check for updates.',
        detail: err?.message || String(err),
        buttons: ['OK']
      });
    }
    manualUpdateCheck = false;
  }
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    if (!manualUpdateCheck) return;
    showUpdateDialog({
      type: 'info',
      title: APP_NAME,
      message: `Update ${info.version} available.`,
      detail: 'Downloading in the background. You will be prompted when it is ready to install.',
      buttons: ['OK']
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    showUpdateDialog({
      type: 'info',
      title: APP_NAME,
      message: 'You are up to date.',
      detail: `Version ${info?.version || app.getVersion()} is the latest.`,
      buttons: ['OK']
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    manualUpdateCheck = false;
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
        autoUpdater.quitAndInstall(false, true);
      }
    });
  });

  autoUpdater.on('error', (err) => {
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    showUpdateDialog({
      type: 'error',
      title: APP_NAME,
      message: 'Could not check for updates.',
      detail: err?.message || String(err),
      buttons: ['OK']
    });
  });

  checkForUpdates(false);
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

function registerIpc() {
  ipcMain.handle('app:getState', () => ({
    macros: decorateMacros(store.getMacros()),
    settings: store.getSettings(),
    runningIds: runner.getRunningIds(),
    platform: process.platform,
    version: app.getVersion(),
    dark: nativeTheme.shouldUseDarkColors
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

  ipcMain.handle('macros:run', (_e, id) => {
    const macro = store.getMacros().find((m) => m.id === id);
    if (!macro) return { ok: false, error: 'Macro not found.' };

    if (macro.showTerminal) {
      createTerminalWindow(macro, getIconPath(), {
        onUserClose: (macroId) => {
          if (runner.getRunning(macroId)) runner.stopMacro(macroId);
        }
      });
    }

    const result = runner.runMacro(macro);
    if (result.ok && macro.showTerminal) {
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
  });

  ipcMain.handle('macros:stop', (_e, id) => runner.stopMacro(id));

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
    }
    if (partial?.startMinimised !== undefined) syncLoginItemArgs();
    if (trayHandlers) updateTrayMenu(trayHandlers);
    sendToRenderer('settings:changed', settings);
    return settings;
  });

  ipcMain.handle('dialog:pickImage', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
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

  ipcMain.handle('dialog:pickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
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

  runner.onStatus((payload) => {
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
  closeAllTerminalWindows();
  closeSplash();
  destroyTray();
});
