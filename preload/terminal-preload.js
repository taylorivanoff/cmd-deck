const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cmdDeckTerminal', {
  getBootstrap: (id) => ipcRenderer.invoke('terminal:bootstrap', id),
  stop: (id) => ipcRenderer.invoke('macros:stop', id),
  close: (id) => ipcRenderer.invoke('terminal:close', id),
  onInit: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('terminal:init', listener);
    return () => ipcRenderer.removeListener('terminal:init', listener);
  },
  onOutput: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('terminal:output', listener);
    return () => ipcRenderer.removeListener('terminal:output', listener);
  },
  onStatus: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('terminal:status', listener);
    return () => ipcRenderer.removeListener('terminal:status', listener);
  }
});
