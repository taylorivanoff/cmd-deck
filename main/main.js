const { app } = require('electron');
const path = require('path');
const { run } = require('electron-tray-base');
const license = require('standupmate-license');
const store = require('./store');
const { attachResizeLogging } = require('./window-debug');
const {
  closeDialogWindows,
  closeLogWindow,
  warmEditorWindow
} = require('./dialog-windows');
const { closeAllTerminalWindows } = require('./terminal-window');
const {
  APP_NAME,
  setContext,
  getAppState,
  registerAppIpc,
  attachRunnerListeners,
  attachLoggerListener,
  reloadPath,
  shells,
  logger,
  setDialogWindowsAlwaysOnTop,
  setLogWindowAlwaysOnTop
} = require('./app-ipc');

const iconPath = path.join(app.getAppPath(), 'resources', 'icon.png');

run({
  appName: APP_NAME,
  appId: 'io.github.taylorivanoff.cmd-deck',
  iconPath,
  splashPath: path.join(app.getAppPath(), 'resources', 'splash.html'),
  store: { instance: store.settingsStore },
  window: {
    html: path.join(__dirname, '..', 'renderer', 'index.html'),
    preload: path.join(__dirname, '..', 'preload', 'preload.js'),
    minWidth: 335,
    minHeight: 140,
    defaultBounds: { width: 380, height: 460 },
    maximizable: false,
    fullscreenable: false
  },
  updater: {
    configureFeed: (autoUpdater) => license.configureUpdaterFeed(autoUpdater)
  },
  tray: {
    extraSections: () => {
      const licenseItems = license.getTrayMenuItems();
      const sections = [[{ label: 'Reload PATH', click: () => reloadPath() }]];
      if (licenseItems.length) sections.push(licenseItems);
      return sections;
    }
  },
  dev: { entryModule: module },
  hooks: {
    getSettings: () => store.getSettings(),
    setSettings: (partial) => store.setSettings(partial),
    getAppState,
    onSettingsChanged: (partial, settings, ctx) => {
      if (partial.alwaysOnTop !== undefined) {
        setDialogWindowsAlwaysOnTop(settings.alwaysOnTop);
        setLogWindowAlwaysOnTop(settings.alwaysOnTop);
      }
      if (partial.sizeLocked !== undefined) {
        const win = ctx.getMainWindow();
        if (win && !win.isDestroyed()) win.setResizable(!settings.sizeLocked);
      }
    },
    registerIpc: (ctx) => {
      setContext({
        getMainWindow: ctx.getMainWindow,
        sendToRenderer: ctx.sendToRenderer,
        updateTrayMenu: ctx.updateTrayMenu,
        iconPath
      });

      license.init({
        productSlug: 'cmd-deck',
        appVersion: app.getVersion(),
        parentWindow: () => ctx.getMainWindow()
      });

      registerAppIpc();
    },
    onReady: (ctx) => {
      attachRunnerListeners();
      attachLoggerListener();
      logger.addLog('info', `${APP_NAME} ready`);

      license.on('change', () => ctx.updateTrayMenu());
      ctx.updateTrayMenu();

      setImmediate(() => {
        try {
          shells.warmRuntime();
          warmEditorWindow({ iconPath });
        } catch (err) {
          console.warn('CmdDeck runtime warm-up failed:', err?.message || err);
        }
      });
    },
    onWindowCreated: (win) => {
      attachResizeLogging(win, 'Main window');
      win.setResizable(!store.getSettings().sizeLocked);
    },
    onBeforeQuit: () => {
      closeDialogWindows();
      closeLogWindow();
      closeAllTerminalWindows();
      license.closeLicenseDialog();
    },
  }
});
