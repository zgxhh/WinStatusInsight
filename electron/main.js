import { app, BrowserWindow, Menu, Tray, ipcMain, shell, Notification, dialog } from 'electron'
import path from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import updater from 'electron-updater'

const { autoUpdater } = updater

let mainWindow = null
let loadingWindow = null
let serverModule = null
let tray = null
let isQuitting = false
let appSettings = { closeToTray: false, localProjectAlertsEnabled: true, lastProjectAlertAt: 0, lastUpdateCheckAt: 0 }
let localServerUrl = ''
let projectAlertTimer = null
let lastProjectAlertSignature = ''
let cachedUpdateInfo = null
let updateDownloading = false

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function loadSettings() {
  try {
    if (!existsSync(settingsPath())) return appSettings
    appSettings = { ...appSettings, ...JSON.parse(readFileSync(settingsPath(), 'utf8')) }
  } catch {
    appSettings = { closeToTray: false, localProjectAlertsEnabled: true, lastProjectAlertAt: 0, lastUpdateCheckAt: 0 }
  }
  return appSettings
}

function saveSettings(nextSettings) {
  appSettings = { ...appSettings, ...nextSettings }
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(appSettings, null, 2), 'utf8')
  return appSettings
}

function resolveIconPath() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'icon-256.png')
    : path.join(app.getAppPath(), 'build', 'icon-256.png')
  return existsSync(iconPath) ? iconPath : undefined
}

function showMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function openLocalProjectsTab() {
  showMainWindow()
  mainWindow?.webContents.send('navigate-tab', 'projects')
}

function rebuildTrayMenu() {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示窗口', click: showMainWindow },
      { label: '打开本地项目页', click: openLocalProjectsTab },
      { label: '一键停止可停止项目', click: stopStoppableProjectsFromTray },
      { type: 'separator' },
      {
        label: '本地项目占用提醒',
        type: 'checkbox',
        checked: Boolean(appSettings.localProjectAlertsEnabled),
        click: (menuItem) => {
          saveSettings({ localProjectAlertsEnabled: menuItem.checked })
          if (menuItem.checked) startProjectAlertTimer()
          else stopProjectAlertTimer()
          rebuildTrayMenu()
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
}

function ensureTray() {
  if (tray) return tray
  const icon = resolveIconPath()
  tray = new Tray(icon || path.join(app.getAppPath(), 'build', 'icon-256.png'))
  tray.setToolTip('WinStatusInsight')
  rebuildTrayMenu()
  tray.on('double-click', showMainWindow)
  return tray
}

function removeTrayIfDisabled() {
  if (appSettings.closeToTray || appSettings.localProjectAlertsEnabled || !tray) return
  tray.destroy()
  tray = null
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

async function fetchLocalJson(url, options = {}) {
  if (!localServerUrl) throw new Error('本地服务尚未就绪')
  const response = await fetch(`${localServerUrl}${url}`, options)
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || '本地服务请求失败')
  return data
}

async function stopStoppableProjectsFromTray() {
  const projects = await fetchLocalJson('/api/local-projects')
  const pids = projects.filter((project) => !project.protected).flatMap((project) => project.pids || [])
  if (!pids.length) {
    new Notification({ title: 'WinStatusInsight', body: '当前没有可停止的本地项目。' }).show()
    return { message: '当前没有可停止的本地项目。' }
  }
  const result = await fetchLocalJson('/api/local-projects/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pids })
  })
  new Notification({ title: '本地项目已处理', body: result.message || '已停止可停止项目。' }).show()
  mainWindow?.webContents.send('navigate-tab', 'projects')
  return result
}

async function checkProjectAlerts() {
  if (!appSettings.localProjectAlertsEnabled || !localServerUrl) return
  try {
    const projects = await fetchLocalJson('/api/local-projects')
    const targets = projects
      .filter((project) => !project.protected)
      .filter((project) => Number(project.memoryGb || 0) >= 0.3 || Number(project.processCount || 0) >= 3)
      .slice(0, 4)
    if (!targets.length) return

    const signature = targets.map((project) => `${project.id}:${project.processCount}:${project.memoryGb}`).join('|')
    const now = Date.now()
    if (signature === lastProjectAlertSignature && now - Number(appSettings.lastProjectAlertAt || 0) < 30 * 60 * 1000) return
    lastProjectAlertSignature = signature
    saveSettings({ lastProjectAlertAt: now })
    ensureTray()

    const projectText = targets.map((project) => `${project.name} ${project.memoryGb}GB`).join('、')
    const notification = new Notification({
      title: '本地项目占用提醒',
      body: `检测到 ${targets.length} 个本地项目占用较高：${projectText}`,
      actions: [
        { type: 'button', text: '打开本地项目页' },
        { type: 'button', text: '一键停止' }
      ],
      closeButtonText: '忽略'
    })
    notification.on('click', openLocalProjectsTab)
    notification.on('action', (_event, index) => {
      if (index === 1) stopStoppableProjectsFromTray().catch((error) => {
        new Notification({ title: '本地项目处理失败', body: error.message }).show()
      })
      else openLocalProjectsTab()
    })
    notification.show()
  } catch {
    // Background reminders should never disturb the main app.
  }
}

function startProjectAlertTimer() {
  if (projectAlertTimer || !appSettings.localProjectAlertsEnabled) return
  ensureTray()
  projectAlertTimer = setInterval(checkProjectAlerts, 5 * 60 * 1000)
  setTimeout(checkProjectAlerts, 45 * 1000)
}

function stopProjectAlertTimer() {
  if (!projectAlertTimer) return
  clearInterval(projectAlertTimer)
  projectAlertTimer = null
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
    <p>正在启动本地分析服务，请稍等。首次运行会初始化桌面环境，期间不要连续点击。</p>
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
      nodeIntegration: false,
      preload: path.join(app.getAppPath(), 'electron', 'preload.cjs')
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
  localServerUrl = baseUrl
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
      nodeIntegration: false,
      preload: path.join(app.getAppPath(), 'electron', 'preload.cjs')
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    if (loadingWindow) loadingWindow.close()
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting && appSettings.closeToTray) {
      event.preventDefault()
      ensureTray()
      mainWindow.hide()
    }
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

function normalizeUpdateInfo(info = {}) {
  return {
    currentVersion: app.getVersion(),
    latestVersion: info.version || app.getVersion(),
    releaseDate: info.releaseDate || '',
    releaseName: info.releaseName || '',
    notes: Array.isArray(info.releaseNotes)
      ? info.releaseNotes.map((item) => item.note || item).join('\n')
      : String(info.releaseNotes || ''),
    files: info.files || []
  }
}

function hasNewerVersion(info = {}) {
  return Boolean(info.latestVersion && info.latestVersion !== info.currentVersion)
}

function sendUpdateStatus(payload) {
  mainWindow?.webContents.send('update-status', payload)
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus({ type: 'checking', message: '正在检查新版本...' })
  })

  autoUpdater.on('update-available', (info) => {
    cachedUpdateInfo = normalizeUpdateInfo(info)
    sendUpdateStatus({ type: 'available', info: cachedUpdateInfo, message: `发现新版本 ${cachedUpdateInfo.latestVersion}` })
  })

  autoUpdater.on('update-not-available', (info) => {
    cachedUpdateInfo = normalizeUpdateInfo(info)
    sendUpdateStatus({ type: 'not-available', info: cachedUpdateInfo, message: '当前已是最新版本' })
  })

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus({
      type: 'progress',
      progress: {
        percent: Number(progress.percent || 0),
        transferred: progress.transferred || 0,
        total: progress.total || 0,
        bytesPerSecond: progress.bytesPerSecond || 0
      },
      message: `正在下载更新 ${Math.round(progress.percent || 0)}%`
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    updateDownloading = false
    const normalized = normalizeUpdateInfo(info)
    sendUpdateStatus({ type: 'downloaded', info: normalized, message: '下载完成，正在重启安装...' })
    setTimeout(() => {
      isQuitting = true
      autoUpdater.quitAndInstall(false, true)
    }, 900)
  })

  autoUpdater.on('error', (error) => {
    updateDownloading = false
    sendUpdateStatus({ type: 'error', message: error.message || '更新失败，请稍后重试。' })
  })
}

async function checkForUpdates() {
  saveSettings({ lastUpdateCheckAt: Date.now() })
  if (!app.isPackaged) {
    const info = { currentVersion: app.getVersion(), latestVersion: app.getVersion() }
    cachedUpdateInfo = info
    return {
      ...info,
      hasUpdate: false,
      message: '更新检查仅在安装版中可用；开发环境不会访问 GitHub 更新源。'
    }
  }

  const result = await autoUpdater.checkForUpdates()
  const info = normalizeUpdateInfo(result?.updateInfo)
  cachedUpdateInfo = info
  return {
    ...info,
    hasUpdate: hasNewerVersion(info),
    message: hasNewerVersion(info) ? `发现新版本 ${info.latestVersion}` : '当前已是最新版本'
  }
}

async function downloadAndInstallUpdate() {
  if (!app.isPackaged) {
    return { ok: false, message: '下载并自动安装仅在安装版中可用。' }
  }
  if (updateDownloading) return { ok: true, message: '更新正在下载中，请稍候。' }
  updateDownloading = true
  sendUpdateStatus({ type: 'download-started', info: cachedUpdateInfo, message: '开始下载更新，完成后将自动重启安装。' })
  await autoUpdater.downloadUpdate()
  return { ok: true, message: '更新正在下载，完成后将自动重启安装。' }
}

ipcMain.handle('settings:get', () => appSettings)
ipcMain.handle('settings:update', (event, nextSettings = {}) => {
  const patch = {}
  if ('closeToTray' in nextSettings) patch.closeToTray = Boolean(nextSettings.closeToTray)
  if ('localProjectAlertsEnabled' in nextSettings) patch.localProjectAlertsEnabled = Boolean(nextSettings.localProjectAlertsEnabled)
  const saved = saveSettings(patch)
  if (saved.closeToTray || saved.localProjectAlertsEnabled) ensureTray()
  else removeTrayIfDisabled()
  if (saved.localProjectAlertsEnabled) startProjectAlertTimer()
  else stopProjectAlertTimer()
  rebuildTrayMenu()
  return saved
})
ipcMain.handle('updates:check', checkForUpdates)
ipcMain.handle('updates:download-install', downloadAndInstallUpdate)
ipcMain.handle('projects:open-local', () => {
  openLocalProjectsTab()
  return { ok: true }
})
ipcMain.handle('projects:stop-stoppable', stopStoppableProjectsFromTray)
ipcMain.handle('projects:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: '选择项目根目录',
    properties: ['openDirectory']
  })
  return result.canceled ? '' : result.filePaths[0] || ''
})

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const targetWindow = mainWindow || loadingWindow
    if (!targetWindow) return
    if (targetWindow.isMinimized()) targetWindow.restore()
    targetWindow.show()
    targetWindow.focus()
  })

  app.whenReady().then(() => {
    loadSettings()
    setupAutoUpdater()
    if (appSettings.closeToTray || appSettings.localProjectAlertsEnabled) ensureTray()
    return createWindow().then(() => {
      if (appSettings.localProjectAlertsEnabled) startProjectAlertTimer()
    })
  })
}

app.on('window-all-closed', () => {
  stopProjectAlertTimer()
  if (serverModule?.server) serverModule.server.close()
  if (process.platform !== 'darwin' && !appSettings.closeToTray) app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && gotSingleInstanceLock) createWindow()
})
