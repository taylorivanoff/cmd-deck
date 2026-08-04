const { BrowserWindow, screen } = require('electron');
const path = require('path');

/** @type {BrowserWindow | null} */
let logWindow = null;

function centerOnParent(win, parent) {
  if (!parent || parent.isDestroyed()) {
    win.center();
    return;
  }
  const pb = parent.getBounds();
  const wb = win.getBounds();
  const x = Math.round(pb.x + (pb.width - wb.width) / 2);
  const y = Math.round(pb.y + (pb.height - wb.height) / 2);
  const display = screen.getDisplayMatching(pb).workArea;
  win.setPosition(
    Math.min(Math.max(display.x, x), display.x + display.width - wb.width),
    Math.min(Math.max(display.y, y), display.y + display.height - wb.height)
  );
}

function openLogWindow({ iconPath, parent, alwaysOnTop = false } = {}) {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.setAlwaysOnTop(!!alwaysOnTop);
    logWindow.setOpacity(1);
    if (logWindow.isMinimized()) logWindow.restore();
    logWindow.show();
    logWindow.focus();
    logWindow.moveTop();
    return logWindow;
  }

  logWindow = new BrowserWindow({
    width: 560,
    height: 420,
    minWidth: 420,
    minHeight: 280,
    title: 'CmdDeck Activity Log',
    icon: iconPath,
    show: false,
    alwaysOnTop: !!alwaysOnTop,
    autoHideMenuBar: true,
    minimizable: true,
    maximizable: true,
    backgroundColor: '#1c1c1e',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'log-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  logWindow.setMenu(null);
  logWindow.setOpacity(1);
  logWindow.loadFile(path.join(__dirname, '..', 'renderer', 'log.html'));

  logWindow.once('ready-to-show', () => {
    centerOnParent(logWindow, parent);
    logWindow.setOpacity(1);
    logWindow.show();
    logWindow.focus();
    logWindow.moveTop();
  });

  logWindow.on('closed', () => {
    logWindow = null;
  });

  return logWindow;
}

function getLogWindow() {
  if (!logWindow || logWindow.isDestroyed()) {
    logWindow = null;
    return null;
  }
  return logWindow;
}

function sendToLogWindow(channel, payload) {
  const win = getLogWindow();
  if (!win) return;
  win.webContents.send(channel, payload);
}

function setLogWindowAlwaysOnTop(value) {
  const win = getLogWindow();
  if (win) win.setAlwaysOnTop(!!value);
}

function closeLogWindow() {
  if (logWindow && !logWindow.isDestroyed()) logWindow.destroy();
  logWindow = null;
}

module.exports = {
  openLogWindow,
  getLogWindow,
  sendToLogWindow,
  setLogWindowAlwaysOnTop,
  closeLogWindow
};
