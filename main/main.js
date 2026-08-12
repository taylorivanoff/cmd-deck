const { app } = require('electron');
const path = require('path');
const loadElectronTrayBase = require('./load-electron-tray-base');
const { configureAppIsolation, run } = loadElectronTrayBase();

configureAppIsolation({
  appId: 'io.github.taylorivanoff.cmd-deck',
  appName: 'CmdDeck'
});

const store = require('./store');
const { attachResizeLogging } = require('./window-debug');
const {
  closeDialogWindows,
  warmEditorWindow
} = require('./dialog-windows');
const { closeLogWindow } = require('./log-window');
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
  tray: {
    extraSections: () => [[{ label: 'Reload PATH', click: () => reloadPath() }]]
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

      registerAppIpc();
    },
    onReady: (ctx) => {
      attachRunnerListeners();
      attachLoggerListener();
      logger.addLog('info', `${APP_NAME} ready`);

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
    },
  }
});
