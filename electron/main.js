import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'

let mainWindow = null
let loadingWindow = null
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

async function waitForServerAddress(server, timeoutMs = 12000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const address = server.address()
    if (typeof address === 'object' && address?.port) return address
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Local server did not expose a listening address')
}

async function startLocalServer() {
  process.env.PORT = '0'
  process.env.WIN_STATUS_INSIGHT_APP_ROOT = app.getAppPath()
  process.env.WIN_STATUS_INSIGHT_DATA_DIR = path.join(app.getPath('userData'), 'data')
  process.env.WIN_STATUS_INSIGHT_SCRIPT_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'scripts', 'collect-status.ps1')
    : path.join(app.getAppPath(), 'scripts', 'collect-status.ps1')

  serverModule = await import('../server/index.js')
  const address = await waitForServerAddress(serverModule.server)
  return `http://127.0.0.1:${address.port}`
}

function loadingHtml() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>WinStatusInsight 正在启动</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: 100vw;
      height: 100vh;
      display: grid;
      place-items: center;
      overflow: hidden;
      color: #edf6ff;
      font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
      background:
        radial-gradient(circle at 22% 18%, rgba(36, 214, 165, 0.18), transparent 32%),
        radial-gradient(circle at 78% 22%, rgba(72, 169, 248, 0.16), transparent 34%),
        linear-gradient(145deg, #081019, #111a23);
    }
    .card {
      width: 420px;
      padding: 28px;
      border: 1px solid rgba(36, 214, 165, 0.32);
      border-radius: 8px;
      background: rgba(12, 22, 31, 0.92);
      box-shadow: 0 22px 70px rgba(0, 0, 0, 0.38), 0 0 0 1px rgba(72, 169, 248, 0.08) inset;
    }
    .eyebrow {
      margin-bottom: 6px;
      color: #24d6a5;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 28px;
      line-height: 1.15;
    }
    p {
      margin: 0 0 22px;
      color: #9eb1c6;
      line-height: 1.5;
      font-size: 14px;
    }
    .bar {
      position: relative;
      height: 10px;
      overflow: hidden;
      border-radius: 999px;
      background: #182a38;
    }
    .bar::before {
      content: "";
      position: absolute;
      top: 0;
      left: -42%;
      width: 42%;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #24d6a5, #48a9f8);
      animation: loading 1.25s ease-in-out infinite;
    }
    .hint {
      margin-top: 14px;
      color: #6f879e;
      font-size: 12px;
    }
    @keyframes loading {
      from { left: -42%; }
      to { left: 100%; }
    }
  </style>
</head>
<body>
  <section class="card">
    <div class="eyebrow">LOCAL SYSTEM OBSERVER</div>
    <h1>WinStatusInsight</h1>
    <p>正在启动本地分析服务，请稍等。便携版首次运行需要解压，期间不要连续双击。</p>
    <div class="bar"></div>
    <div class="hint">正在准备 Electron 窗口、Express 服务和 PowerShell 采集脚本...</div>
  </section>
</body>
</html>`)}`
}

function createLoadingWindow() {
  const icon = resolveIconPath()
  loadingWindow = new BrowserWindow({
    width: 520,
    height: 300,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'WinStatusInsight 正在启动',
    backgroundColor: '#081019',
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  loadingWindow.loadURL(loadingHtml())
  loadingWindow.on('closed', () => {
    loadingWindow = null
  })
}

async function createWindow() {
  createLoadingWindow()
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
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    if (loadingWindow) loadingWindow.close()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  await mainWindow.loadURL(baseUrl)
}

app.setAppUserModelId('cn.zgxhh.winstatusinsight')

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const targetWindow = mainWindow || loadingWindow
    if (!targetWindow) return
    if (targetWindow.isMinimized()) targetWindow.restore()
    targetWindow.focus()
  })

  app.whenReady().then(createWindow)
}

app.on('window-all-closed', () => {
  if (serverModule?.server) serverModule.server.close()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && gotSingleInstanceLock) createWindow()
})
