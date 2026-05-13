import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('winStatusInsight', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadAndInstallUpdate: () => ipcRenderer.invoke('updates:download-install'),
  openLocalProjectsFromTray: () => ipcRenderer.invoke('projects:open-local'),
  stopStoppableProjectsFromTray: () => ipcRenderer.invoke('projects:stop-stoppable'),
  onNavigateTab: (callback) => {
    const handler = (_event, tabName) => callback(tabName)
    ipcRenderer.on('navigate-tab', handler)
    return () => ipcRenderer.removeListener('navigate-tab', handler)
  }
})
