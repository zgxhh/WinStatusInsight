const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('winStatusInsight', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadAndInstallUpdate: () => ipcRenderer.invoke('updates:download-install'),
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('update-status', handler)
    return () => ipcRenderer.removeListener('update-status', handler)
  },
  openLocalProjectsFromTray: () => ipcRenderer.invoke('projects:open-local'),
  stopStoppableProjectsFromTray: () => ipcRenderer.invoke('projects:stop-stoppable'),
  onNavigateTab: (callback) => {
    const handler = (_event, tabName) => callback(tabName)
    ipcRenderer.on('navigate-tab', handler)
    return () => ipcRenderer.removeListener('navigate-tab', handler)
  }
})
