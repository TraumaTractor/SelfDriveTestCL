// The only bridge between the app and the desktop shell: a few update-related calls, nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  info: () => ipcRenderer.invoke('updates:info'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  restart: () => ipcRenderer.invoke('updates:restart'),
  useTokenFromClipboard: () => ipcRenderer.invoke('updates:token'),
});
