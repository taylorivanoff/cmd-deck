const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { attachResizeLogging } = require('./window-debug');

/** @type {Map<string, BrowserWindow>} */
const windows = new Map();

function titleFor(macroMeta) {
  const label = (macroMeta?.name || '').trim() || (macroMeta?.command || '').trim().split(/\r?\n/)[0] || 'Command';
  return `CmdDeck - ${label}`;
}

function createTerminalWindow(macroMeta, iconPath, options = {}) {
  const id = macroMeta.id;
  const existing = windows.get(id);
  if (existing && !existing.isDestroyed()) {
    existing.setTitle(titleFor(macroMeta));
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }

  const display = screen.getPrimaryDisplay().workArea;
  const width = Math.min(720, Math.max(480, Math.floor(display.width * 0.45)));
  const height = Math.min(480, Math.max(320, Math.floor(display.height * 0.5)));

  const win = new BrowserWindow({
    width,
    height,
    minWidth: 420,
    minHeight: 280,
    title: titleFor(macroMeta),
    icon: iconPath,
    autoHideMenuBar: true,
    backgroundColor: '#0c0c0c',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'terminal-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.setMenu(null);
  attachResizeLogging(win, 'Terminal window');
  win.loadFile(path.join(__dirname, '..', 'renderer', 'terminal.html'), {
    query: { id }
  });

  win.on('close', () => {
    if (typeof options.onUserClose === 'function') options.onUserClose(id);
  });

  win.on('closed', () => {
    windows.delete(id);
  });

  windows.set(id, win);
  return win;
}

function getTerminalWindow(id) {
  const win = windows.get(id);
  if (!win || win.isDestroyed()) {
    windows.delete(id);
    return null;
  }
  return win;
}

function sendToTerminal(id, channel, payload) {
  const win = getTerminalWindow(id);
  if (!win) return;
  win.webContents.send(channel, payload);
}

function closeTerminalWindow(id) {
  const win = getTerminalWindow(id);
  if (!win) return;
  win.destroy();
  windows.delete(id);
}

function closeAllTerminalWindows() {
  for (const [id, win] of windows) {
    if (!win.isDestroyed()) win.destroy();
    windows.delete(id);
  }
}

module.exports = {
  createTerminalWindow,
  getTerminalWindow,
  sendToTerminal,
  closeTerminalWindow,
  closeAllTerminalWindows
};
