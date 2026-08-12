/**
 * Recreates the Electron `window.cmdDeck` preload API on top of
 * `window.tauriTrayBridge` (see vendor/tauri-tray-bridge.js) so the existing
 * renderer JS (app.js / editor.js / settings.js) works unchanged.
 */
(function (global) {
  const { invoke, listen } = global.tauriTrayBridge;

  function onEvent(event, cb) {
    let unlisten = null;
    let cancelled = false;
    listen(event, cb).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }

  global.cmdDeck = {
    getState: () => invoke("cmddeck_get_state"),
    getEditorInit: (macroId) => invoke("ui_get_editor_init", { macroId: macroId || null }),
    listMacros: () => invoke("macros_list"),
    addMacro: (partial) => invoke("macros_add", { partial }),
    updateMacro: (id, partial) => invoke("macros_update", { id, partial }),
    deleteMacro: (id) => invoke("macros_delete", { id }),
    reorderMacros: (orderedIds) => invoke("macros_reorder", { orderedIds }),
    runMacro: (id) => invoke("macros_run", { id }),
    stopMacro: (id) => invoke("macros_stop", { id }),
    getSettings: () => invoke("settings_get"),
    setSettings: (partial) => invoke("settings_set", { partial }),
    pickImage: () => invoke("dialog_pick_image"),
    pickFolder: () => invoke("dialog_pick_folder"),
    openEditor: (id) => invoke("ui_open_editor", { id: id || null }),
    openSettings: () => invoke("ui_open_settings"),
    openLog: () => invoke("ui_open_log"),
    showMacroMenu: (id) => invoke("ui_macro_context_menu", { id }),
    listShells: () => invoke("shells_list"),
    showItemInFolder: (filePath) => invoke("shell_show_item", { path: filePath }),
    closeWindow: () => global.tauriTrayBridge.closeCurrentWindow(),
    onMacrosChanged: (cb) => onEvent("macros:changed", cb),
    onSettingsChanged: (cb) => onEvent("settings:changed", cb),
    onStatus: (cb) => onEvent("macros:status", cb),
    onToast: (cb) => onEvent("macros:toast", cb),
    onEditorOpen: (cb) => onEvent("editor:open", cb),
  };
})(typeof window !== "undefined" ? window : globalThis);
