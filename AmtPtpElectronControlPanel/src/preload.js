const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('amtPtp', {
  readSettings: () => ipcRenderer.invoke('settings:read'),
  applySettings: (settings) => ipcRenderer.invoke('settings:apply', settings),
  getBattery: () => ipcRenderer.invoke('battery:get'),
  openTouchpadSettings: () => ipcRenderer.invoke('touchpad:openSettings'),
  getAutostart: () => ipcRenderer.invoke('autostart:get'),
  setAutostart: (enabled) => ipcRenderer.invoke('autostart:set', enabled),
  getLocale: () => ipcRenderer.invoke('locale:get'),
  onBatteryUpdated: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on('battery-updated', listener);
    return () => ipcRenderer.removeListener('battery-updated', listener);
  }
});
