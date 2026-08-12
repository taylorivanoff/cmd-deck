const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  shell,
  nativeTheme,
  Notification
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { randomUUID } = require('crypto');
const store = require('./store');
const runner = require('./runner');
const {
  createTerminalWindow,
  sendToTerminal,
  closeTerminalWindow
} = require('./terminal-window');
const {
  openEditorWindow,
  openSettingsWindow,
  getSettingsWindow,
  setDialogWindowsAlwaysOnTop,
  setLogWindowAlwaysOnTop,
  openLogWindow
} = require('./dialog-windows');
const { sendToLogWindow } = require('./log-window');
const logger = require('./logger');
const shells = require('./shells');
const license = require('standupmate-license');

const APP_NAME = 'CmdDeck';
const pendingStarts = new Set();

let ctx = {
  getMainWindow: () => null,
  sendToRenderer: () => {},
  updateTrayMenu: () => {},
  iconPath: ''
};

function setContext(next) {
  ctx = { ...ctx, ...next };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function imagesDir() {
  const dir = path.join(app.getPath('userData'), 'button-images');
  ensureDir(dir);
  return dir;
}

function sendToAllRenderers(channel, payload) {
  ctx.sendToRenderer(channel, payload);
  const settingsWin = getSettingsWindow();
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send(channel, payload);
  }
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
  const shellName = payload.shell ? ` [${payload.shell}]` : '';

  if (payload.status === 'running') {
    if (payload.pending) {
      logger.addLog('info', `Queued “${label}”${shellName}`, { macroId: payload.id });
    } else {
      const pid = payload.pid ? ` pid=${payload.pid}` : '';
      logger.addLog('info', `Started “${label}”${shellName}${pid}`, { macroId: payload.id });
    }
    return;
  }
  if (payload.status === 'success') {
    logger.addLog('info', `Finished “${label}”${shellName}`, { macroId: payload.id });
    return;
  }
  if (payload.status === 'error') {
    logger.addLog('error', `Failed “${label}”${shellName}: ${payload.error || 'Command failed'}`, {
      macroId: payload.id
    });
    return;
  }
  if (payload.status === 'stopped') {
    logger.addLog('warn', `Stopped “${label}”${shellName}`, { macroId: payload.id });
  }
}

function copyImageToStore(sourcePath) {
  const ext = path.extname(sourcePath).toLowerCase() || '.png';
  const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'];
  if (!allowed.includes(ext)) throw new Error('Unsupported image type.');
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
  sendToAllRenderers('macros:changed', macros);
  return macros;
}

function runMacroById(id) {
  const macro = store.getMacros().find((m) => m.id === id);
  if (!macro) return { ok: false, error: 'Macro not found.' };

  const result = runner.runMacro(macro);
  if (!result.ok) return result;

  if (macro.showTerminal) {
    createTerminalWindow(macro, ctx.iconPath, {
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
      stderr: running?.stderr || '',
      startedAt: running?.startedAt
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
  const pendingStatus = {
    id,
    status: 'running',
    name: macro.name || '',
    command: macro.command || '',
    showTerminal: !!macro.showTerminal,
    pending: true
  };
  logMacroStatus(pendingStatus);
  sendToAllRenderers('macros:status', pendingStatus);

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
        sendToAllRenderers('macros:status', failStatus);
        sendToAllRenderers('macros:toast', {
          message: result?.error || 'Failed to run',
          error: true
        });
      }
    } catch (err) {
      const failStatus = {
        id,
        status: 'error',
        error: err?.message || String(err),
        showTerminal: !!macro.showTerminal
      };
      logMacroStatus(failStatus);
      sendToAllRenderers('macros:status', failStatus);
      sendToAllRenderers('macros:toast', {
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

  const mainWindow = ctx.getMainWindow();
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
          iconPath: ctx.iconPath,
          parent: mainWindow,
          alwaysOnTop
        });
      }
    },
    { label: 'Duplicate', click: () => duplicateMacro(id) },
    { label: 'Move Left', enabled: index > 0, click: () => moveMacro(id, -1) },
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

function reloadPath() {
  try {
    shells.reloadRuntime();
    logger.addLog('info', 'Reloaded PATH and shell detection');
    if (Notification.isSupported()) {
      new Notification({
        title: APP_NAME,
        body: 'PATH reloaded',
        icon: ctx.iconPath
      }).show();
    }
  } catch (err) {
    logger.addLog('error', `Failed to reload PATH: ${err?.message || String(err)}`);
  }
}

function getAppState() {
  return {
    macros: decorateMacros(store.getMacros()),
    settings: store.getSettings(),
    runningIds: runner.getRunningIds(),
    shells: shells.listShells().map(({ id, name, detail }) => ({ id, name, detail })),
    defaultShell: shells.defaultShellId(),
    platform: process.platform,
    version: app.getVersion(),
    dark: nativeTheme.shouldUseDarkColors
  };
}

function getEditorInit(macroId) {
  const macro = macroId
    ? store.getMacros().find((m) => m.id === macroId)
    : null;

  return {
    shells: shells.listShells().map(({ id, name, detail }) => ({ id, name, detail })),
    defaultShell: shells.defaultShellId(),
    platform: process.platform,
    dark: nativeTheme.shouldUseDarkColors,
    macro: macro
      ? {
          id: macro.id,
          command: macro.command,
          name: macro.name,
          cwd: macro.cwd,
          imagePath: macro.imagePath,
          showTerminal: macro.showTerminal,
          shell: macro.shell,
          terminalApp: macro.terminalApp
        }
      : null
  };
}

function registerAppIpc() {
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
    if (partial?.imagePath === null && existing.imagePath) removeImageIfOwned(existing.imagePath);
    else if (partial?.imagePath && partial.imagePath !== existing.imagePath) {
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
      sendToAllRenderers('macros:status', stopped);
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

  ipcMain.handle('ui:getEditorInit', (_e, macroId) => getEditorInit(macroId || null));
  ipcMain.handle('ui:openEditor', (_e, id) => {
    const alwaysOnTop = !!store.getSettings().alwaysOnTop;
    openEditorWindow({
      macroId: id || null,
      iconPath: ctx.iconPath,
      parent: ctx.getMainWindow(),
      alwaysOnTop
    });
    return { ok: true };
  });
  ipcMain.handle('ui:openSettings', () => {
    const alwaysOnTop = !!store.getSettings().alwaysOnTop;
    openSettingsWindow({
      iconPath: ctx.iconPath,
      parent: ctx.getMainWindow(),
      alwaysOnTop
    });
    return { ok: true };
  });
  ipcMain.handle('ui:openLog', () => {
    const alwaysOnTop = !!store.getSettings().alwaysOnTop;
    openLogWindow({
      iconPath: ctx.iconPath,
      parent: ctx.getMainWindow(),
      alwaysOnTop
    });
    return { ok: true };
  });
  ipcMain.handle('ui:openLicense', () => {
    license.openLicenseDialog(ctx.getMainWindow());
    return { ok: true };
  });
  ipcMain.handle('log:get', () => logger.getLogs());
  ipcMain.handle('log:clear', () => {
    logger.clearLogs();
    return { ok: true };
  });
  ipcMain.handle('dialog:pickImage', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) || ctx.getMainWindow();
    const result = await dialog.showOpenDialog(owner, {
      title: 'Choose button image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    try {
      return copyImageToStore(result.filePaths[0]);
    } catch (err) {
      return { error: err.message || String(err) };
    }
  });
  ipcMain.handle('dialog:pickFolder', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) || ctx.getMainWindow();
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

function attachRunnerListeners() {
  runner.onStatus((payload) => {
    logMacroStatus(payload);
    sendToAllRenderers('macros:status', payload);
    if (payload?.id) sendToTerminal(payload.id, 'terminal:status', payload);
  });
  runner.onOutput((payload) => {
    if (payload?.id) sendToTerminal(payload.id, 'terminal:output', payload);
  });
}

function attachLoggerListener() {
  logger.onLog((entry) => {
    sendToLogWindow('log:entry', entry);
  });
}

module.exports = {
  APP_NAME,
  setContext,
  getAppState,
  registerAppIpc,
  attachRunnerListeners,
  attachLoggerListener,
  reloadPath,
  license,
  shells,
  logger,
  setDialogWindowsAlwaysOnTop,
  setLogWindowAlwaysOnTop
};
