/**
 * Recreates the Electron `window.cmdDeck` preload API on top of
 * `window.tauriTrayBridge` (see vendor/tauri-tray-bridge.js).
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
    getDeck: () => invoke("deck_get"),
    setActiveProfile: (profileId) => invoke("deck_set_active_profile", { profileId }),
    setActivePage: (pageId) => invoke("deck_set_active_page", { pageId }),
    addProfile: (name) => invoke("deck_add_profile", { name }),
    addPage: (name) => invoke("deck_add_page", { name }),
    deletePage: (pageId) => invoke("deck_delete_page", { pageId }),
    duplicateProfile: (profileId) => invoke("deck_duplicate_profile", { profileId }),
    listPacks: () => invoke("packs_list"),
    exportPack: (profileId) => invoke("packs_export", { profileId: profileId || null }),
    exportPackToFile: (path, profileId) => invoke("packs_export_to_file", { path, profileId: profileId || null }),
    importPack: (pack, mode) => invoke("packs_import", { pack, mode }),
    importPackFile: (path, mode) => invoke("packs_import_file", { path, mode }),
    pickPack: () => invoke("dialog_pick_pack"),
    savePack: (suggestedName) => invoke("dialog_save_pack", { suggestedName }),
    getLanInfo: () => invoke("lan_get_info"),
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
    onDeckChanged: (cb) => onEvent("deck:changed", cb),
    onSettingsChanged: (cb) => onEvent("settings:changed", cb),
    onStatus: (cb) => onEvent("macros:status", cb),
    onToast: (cb) => onEvent("macros:toast", cb),
    onEditorOpen: (cb) => onEvent("editor:open", cb),
  };
})(typeof window !== "undefined" ? window : globalThis);
