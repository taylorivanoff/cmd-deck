/**
 * Shared bridge helpers for tray apps using tauri-tray-base.
 * Apps typically wrap these into window.ghStats / window.fontChecker / etc.
 *
 * Requires tauri.conf.json: { "app": { "withGlobalTauri": true } }
 */
(function (global) {
  function api() {
    const t = global.__TAURI__;
    if (!t || !t.core) {
      throw new Error("Tauri API not available (enable withGlobalTauri)");
    }
    return t;
  }

  async function invoke(cmd, args) {
    return api().core.invoke(cmd, args || {});
  }

  function listen(event, handler) {
    return api().event.listen(event, (e) => handler(e.payload));
  }

  function getCurrentWindow() {
    const t = api();
    const get =
      t.webviewWindow?.getCurrentWebviewWindow ||
      t.window?.getCurrentWindow;
    if (!get) {
      throw new Error("Tauri window API not available");
    }
    return get();
  }

  /** Close/destroy this webview window. Prefer over `window.close()` (blank page on Windows). */
  function closeCurrentWindow() {
    try {
      const win = getCurrentWindow();
      return (win.destroy || win.close).call(win).catch(() => window.close());
    } catch (_) {
      window.close();
      return Promise.resolve();
    }
  }

  /** Soft close — triggers CloseRequested so tray apps can hide-to-tray. */
  function closeWindow() {
    try {
      const win = getCurrentWindow();
      return win.close().catch(() => window.close());
    } catch (_) {
      window.close();
      return Promise.resolve();
    }
  }

  function minimizeWindow() {
    try {
      return getCurrentWindow().minimize();
    } catch (_) {
      return Promise.resolve();
    }
  }

  async function toggleMaximizeWindow() {
    try {
      const win = getCurrentWindow();
      const maximized = await win.isMaximized();
      if (maximized) {
        return win.unmaximize();
      }
      return win.maximize();
    } catch (_) {
      return undefined;
    }
  }

  /**
   * Wire [data-window-action] buttons: minimize | maximize | close.
   * @param {ParentNode} [root=document]
   */
  function bindWindowControls(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-window-action]").forEach((btn) => {
      if (btn.dataset.windowBound === "1") return;
      btn.dataset.windowBound = "1";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const action = btn.getAttribute("data-window-action");
        if (action === "minimize") minimizeWindow();
        else if (action === "maximize") toggleMaximizeWindow();
        else if (action === "close") closeWindow();
      });
    });
  }

  const trayBridge = {
    invoke,
    listen,
    getCurrentWindow,
    closeCurrentWindow,
    closeWindow,
    minimizeWindow,
    toggleMaximizeWindow,
    bindWindowControls,
    getSettings: () => invoke("settings_get"),
    setSettings: (partial) => invoke("settings_set", { partial }),
    getAppState: () => invoke("app_get_state"),
    onSettingsChanged: (cb) => listen("settings:changed", cb),
    onTrayAction: (cb) => listen("tray:action", cb),
    onCheckUpdates: (cb) => listen("tray:check-updates", cb),
    onUpdaterStatus: (cb) => listen("updater:status", cb),
  };

  global.tauriTrayBridge = trayBridge;
})(typeof window !== "undefined" ? window : globalThis);
