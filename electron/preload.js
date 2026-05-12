import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('winStatusInsight', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings)
})
