const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cmdDeck', {
  getState: () => ipcRenderer.invoke('app:getState'),
  listMacros: () => ipcRenderer.invoke('macros:list'),
  addMacro: (partial) => ipcRenderer.invoke('macros:add', partial),
  updateMacro: (id, partial) => ipcRenderer.invoke('macros:update', id, partial),
  deleteMacro: (id) => ipcRenderer.invoke('macros:delete', id),
  reorderMacros: (orderedIds) => ipcRenderer.invoke('macros:reorder', orderedIds),
  runMacro: (id) => ipcRenderer.invoke('macros:run', id),
  stopMacro: (id) => ipcRenderer.invoke('macros:stop', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItem', filePath),
  onMacrosChanged: (cb) => {
    const listener = (_e, macros) => cb(macros);
    ipcRenderer.on('macros:changed', listener);
    return () => ipcRenderer.removeListener('macros:changed', listener);
  },
  onSettingsChanged: (cb) => {
    const listener = (_e, settings) => cb(settings);
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  },
  onStatus: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('macros:status', listener);
    return () => ipcRenderer.removeListener('macros:status', listener);
  }
});
