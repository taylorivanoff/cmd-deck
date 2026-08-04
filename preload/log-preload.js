const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cmdDeckLog', {
  getLogs: () => ipcRenderer.invoke('log:get'),
  clearLogs: () => ipcRenderer.invoke('log:clear'),
  onEntry: (cb) => {
    const listener = (_e, entry) => cb(entry);
    ipcRenderer.on('log:entry', listener);
    return () => ipcRenderer.removeListener('log:entry', listener);
  }
});
