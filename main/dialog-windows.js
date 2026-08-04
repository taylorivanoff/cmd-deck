const { BrowserWindow, screen } = require('electron');
const path = require('path');

/** @type {BrowserWindow | null} */
let editorWindow = null;
/** @type {BrowserWindow | null} */
let settingsWindow = null;

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

function createAuxWindow({ width, height, minWidth, minHeight, title, html, query, iconPath, parent }) {
  const win = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    title,
    icon: iconPath,
    show: false,
    autoHideMenuBar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    backgroundColor: '#1c1c1e',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.setMenu(null);
  win.loadFile(path.join(__dirname, '..', 'renderer', html), { query: query || {} });

  win.once('ready-to-show', () => {
    centerOnParent(win, parent);
    win.show();
    win.focus();
  });

  return win;
}

function openEditorWindow({ macroId = null, iconPath, parent } = {}) {
  const query = macroId ? { id: String(macroId) } : {};
  const title = macroId ? 'Edit Macro' : 'Add Macro';

  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.setTitle(title);
    editorWindow.loadFile(path.join(__dirname, '..', 'renderer', 'editor.html'), { query });
    if (editorWindow.isMinimized()) editorWindow.restore();
    editorWindow.show();
    editorWindow.focus();
    return editorWindow;
  }

  editorWindow = createAuxWindow({
    width: 440,
    height: 620,
    minWidth: 360,
    minHeight: 480,
    title,
    html: 'editor.html',
    query,
    iconPath,
    parent
  });

  editorWindow.on('closed', () => {
    editorWindow = null;
  });

  return editorWindow;
}

function openSettingsWindow({ iconPath, parent } = {}) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = createAuxWindow({
    width: 380,
    height: 420,
    minWidth: 320,
    minHeight: 340,
    title: 'Settings',
    html: 'settings.html',
    iconPath,
    parent
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  return settingsWindow;
}

function getEditorWindow() {
  if (!editorWindow || editorWindow.isDestroyed()) {
    editorWindow = null;
    return null;
  }
  return editorWindow;
}

function getSettingsWindow() {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    settingsWindow = null;
    return null;
  }
  return settingsWindow;
}

function closeDialogWindows() {
  if (editorWindow && !editorWindow.isDestroyed()) editorWindow.destroy();
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.destroy();
  editorWindow = null;
  settingsWindow = null;
}

module.exports = {
  openEditorWindow,
  openSettingsWindow,
  getEditorWindow,
  getSettingsWindow,
  closeDialogWindows
};
