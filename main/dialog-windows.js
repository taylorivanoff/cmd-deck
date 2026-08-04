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

function bringToFront(win, alwaysOnTop) {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(!!alwaysOnTop);
  win.setOpacity(1);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.moveTop();
}

function createAuxWindow({ width, height, minWidth, minHeight, title, html, query, iconPath, parent, alwaysOnTop, resizable = true }) {
  const win = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    title,
    icon: iconPath,
    show: false,
    alwaysOnTop: !!alwaysOnTop,
    autoHideMenuBar: true,
    resizable: !!resizable,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#1c1c1e',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.setMenu(null);
  win.setOpacity(1);
  win.loadFile(path.join(__dirname, '..', 'renderer', html), { query: query || {} });

  win.once('ready-to-show', () => {
    centerOnParent(win, parent);
    bringToFront(win, alwaysOnTop);
  });

  return win;
}

function openEditorWindow({ macroId = null, iconPath, parent, alwaysOnTop = false } = {}) {
  const query = macroId ? { id: String(macroId) } : {};
  const title = macroId ? 'Edit Macro' : 'Add Macro';

  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.setTitle(title);
    editorWindow.loadFile(path.join(__dirname, '..', 'renderer', 'editor.html'), { query });
    bringToFront(editorWindow, alwaysOnTop);
    return editorWindow;
  }

  editorWindow = createAuxWindow({
    width: 440,
    height: 620,
    minWidth: 360,
    minHeight: 600,
    title,
    html: 'editor.html',
    query,
    iconPath,
    parent,
    alwaysOnTop
  });

  editorWindow.on('closed', () => {
    editorWindow = null;
  });

  return editorWindow;
}

function openSettingsWindow({ iconPath, parent, alwaysOnTop = false } = {}) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    bringToFront(settingsWindow, alwaysOnTop);
    return settingsWindow;
  }

  settingsWindow = createAuxWindow({
    width: 360,
    height: 320,
    minWidth: 300,
    minHeight: 280,
    title: 'Settings',
    html: 'settings.html',
    iconPath,
    parent,
    alwaysOnTop,
    resizable: false
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

function setDialogWindowsAlwaysOnTop(value) {
  const onTop = !!value;
  if (editorWindow && !editorWindow.isDestroyed()) editorWindow.setAlwaysOnTop(onTop);
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.setAlwaysOnTop(onTop);
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
  setDialogWindowsAlwaysOnTop,
  closeDialogWindows
};
