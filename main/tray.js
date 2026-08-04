const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

let tray = null;

function createTray(iconPath, handlers) {
  if (tray) return tray;

  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) image = nativeImage.createEmpty();
  if (process.platform === 'darwin') {
    image = image.resize({ width: 18, height: 18 });
    image.setTemplateImage(true);
  } else if (!image.isEmpty()) {
    image = image.resize({ width: 16, height: 16 });
  }

  tray = new Tray(image);
  tray.setToolTip('CmdDeck');
  updateTrayMenu(handlers);

  tray.on('click', () => handlers.toggleWindow());
  tray.on('double-click', () => handlers.showWindow());
  return tray;
}

function updateTrayMenu(handlers) {
  if (!tray || tray.isDestroyed()) return;
  const settings = handlers.getSettings();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show CmdDeck', click: () => handlers.showWindow() },
    { label: 'Hide CmdDeck', click: () => handlers.hideWindow() },
    { type: 'separator' },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: !!settings.alwaysOnTop,
      click: (item) => handlers.setAlwaysOnTop(item.checked)
    },
    {
      label: 'Start Minimised',
      type: 'checkbox',
      checked: !!settings.startMinimised,
      click: (item) => handlers.setStartMinimised(item.checked)
    },
    { type: 'separator' },
    { label: 'Reload PATH', click: () => handlers.reloadPath() },
    { label: 'Check for Updates', click: () => handlers.checkForUpdates() },
    { label: `Version ${app.getVersion()}`, enabled: false },
    { label: 'Quit', click: () => handlers.quit() }
  ]));
}

function destroyTray() {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
}

function getIconPath() {
  return path.join(app.getAppPath(), 'resources', 'icon.png');
}

module.exports = {
  createTray,
  updateTrayMenu,
  destroyTray,
  getIconPath
};
