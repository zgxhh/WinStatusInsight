import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'

let mainWindow = null
let serverModule = null

function resolveIconPath() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'icon-256.png')
    : path.join(app.getAppPath(), 'build', 'icon-256.png')
  return existsSync(iconPath) ? iconPath : undefined
}

async function waitForServer(url, timeoutMs = 12000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // The local server can take a moment to bind after Electron starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Local server did not respond: ${url}`)
}

async function startLocalServer() {
  process.env.PORT = '0'
  process.env.WIN_STATUS_INSIGHT_APP_ROOT = app.getAppPath()
  process.env.WIN_STATUS_INSIGHT_DATA_DIR = path.join(app.getPath('userData'), 'data')
  process.env.WIN_STATUS_INSIGHT_SCRIPT_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'scripts', 'collect-status.ps1')
    : path.join(app.getAppPath(), 'scripts', 'collect-status.ps1')

  serverModule = await import('../server/index.js')
  const address = serverModule.server.address()
  const actualPort = typeof address === 'object' && address ? address.port : 5274
  return `http://127.0.0.1:${actualPort}`
}

async function createWindow() {
  const baseUrl = await startLocalServer()
  await waitForServer(baseUrl)
  const icon = resolveIconPath()

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1120,
    minHeight: 720,
    title: 'WinStatusInsight',
    backgroundColor: '#0b1118',
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  await mainWindow.loadURL(baseUrl)
}

app.setAppUserModelId('cn.zgxhh.winstatusinsight')

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (serverModule?.server) serverModule.server.close()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
