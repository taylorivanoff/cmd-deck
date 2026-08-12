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

  /** Close/destroy this webview window. Prefer over `window.close()` (blank page on Windows). */
  function closeCurrentWindow() {
    const t = api();
    const get =
      t.webviewWindow?.getCurrentWebviewWindow ||
      t.window?.getCurrentWindow;
    if (!get) {
      window.close();
      return Promise.resolve();
    }
    const win = get();
    return (win.destroy || win.close).call(win).catch(() => window.close());
  }

  const trayBridge = {
    invoke,
    listen,
    closeCurrentWindow,
    getSettings: () => invoke("settings_get"),
    setSettings: (partial) => invoke("settings_set", { partial }),
    getAppState: () => invoke("app_get_state"),
    onSettingsChanged: (cb) => listen("settings:changed", cb),
    onTrayAction: (cb) => listen("tray:action", cb),
  };

  global.tauriTrayBridge = trayBridge;
})(typeof window !== "undefined" ? window : globalThis);
