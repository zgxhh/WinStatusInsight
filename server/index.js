import express from 'express'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = process.env.WIN_STATUS_INSIGHT_APP_ROOT || path.resolve(__dirname, '..')
const processCwd = String(rootDir).replace(/\//g, '\\').toLowerCase().endsWith('.asar') ? path.dirname(rootDir) : rootDir
const dataDir = process.env.WIN_STATUS_INSIGHT_DATA_DIR || path.join(rootDir, 'data')
const snapshotsDir = path.join(dataDir, 'snapshots')
const scriptPath = process.env.WIN_STATUS_INSIGHT_SCRIPT_PATH || path.join(rootDir, 'scripts', 'collect-status.ps1')
const oldLogsDir = 'C:\\Users\\HUAWEI\\Documents\\Codex\\2026-05-10\\win\\lag-logs'
const port = Number(process.env.PORT || 5274)
const powershellExe =
  process.env.WIN_STATUS_INSIGHT_POWERSHELL_PATH ||
  path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const userProfile = process.env.USERPROFILE || 'C:\\Users\\HUAWEI'
const movedRoot = 'D:\\MovedFromC'

const app = express()
app.use(express.json())

const SYSTEM_NAMES = new Set([
  'system',
  'registry',
  'smss',
  'csrss',
  'wininit',
  'services',
  'lsass',
  'svchost',
  'fontdrvhost',
  'dwm',
  'explorer',
  'sihost',
  'runtimebroker',
  'searchindexer',
  'searchhost',
  'startmenuexperiencehost',
  'securityhealthservice',
  'securityhealthsystray',
  'ctfmon',
  'audiodg',
  'wudfhost'
])

const PROTECTED_HINTS = [
  'defender',
  'antimalware',
  'windows update',
  'mousocoreworker',
  'tiworker',
  'trustedinstaller',
  'securityhealth',
  'svchost',
  'protect',
  'antivirus',
  'huorong',
  'hips',
  'safe service'
]

const APP_HINTS = [
  { pattern: /chrome|msedge|firefox/i, type: 'browser', action: '浏览器占用较高，可以先关闭不用的标签页或扩展。' },
  { pattern: /onedrive|baidunetdisk|yun/i, type: 'sync', action: '同步/网盘进程占用较高，可以暂停同步或避开开发目录。' },
  { pattern: /code|devenv|rider|webstorm|hbuilder/i, type: 'ide', action: '开发工具占用较高，可以关闭不用的项目窗口或插件。' },
  { pattern: /node|npm|pnpm|vite|dotnet/i, type: 'dev', action: '开发服务占用较高，可以停止不用的本地服务。' },
  { pattern: /jianying|photoshop|adobe|obs/i, type: 'media', action: '创作软件占用较高，可以保存后关闭暂时不用的工程。' }
]

function toArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function normalizeText(value) {
  return String(value || '').toLowerCase()
}

function bytesToGb(bytes) {
  return Number((Number(bytes || 0) / 1024 / 1024 / 1024).toFixed(2))
}

function psLiteral(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`
}

function sourceToMovedTarget(source) {
  const root = path.win32.parse(source).root
  return path.win32.join(movedRoot, source.slice(root.length))
}

const DISK_MIGRATION_ITEMS = [
  { id: 'yarn', label: 'Yarn 缓存', source: path.win32.join(userProfile, 'AppData\\Local\\Yarn') },
  { id: 'npm-cache', label: 'npm 缓存', source: path.win32.join(userProfile, 'AppData\\Local\\npm-cache') },
  { id: 'nuget-home', label: '.nuget 包缓存', source: path.win32.join(userProfile, '.nuget') },
  { id: 'nuget-local', label: 'NuGet 本地缓存', source: path.win32.join(userProfile, 'AppData\\Local\\NuGet') },
  { id: 'pnpm', label: 'pnpm 缓存', source: path.win32.join(userProfile, 'AppData\\Local\\pnpm') },
  { id: 'ms-playwright', label: 'Playwright 浏览器缓存', source: path.win32.join(userProfile, 'AppData\\Local\\ms-playwright') },
  { id: 'azure-functions-tools', label: 'Azure Functions Tools', source: path.win32.join(userProfile, 'AppData\\Local\\AzureFunctionsTools') }
].map((item) => ({ ...item, target: sourceToMovedTarget(item.source), type: 'dev-cache', risk: '低风险开发缓存，可重建' }))

const DISK_CLEAN_ITEMS = [
  {
    id: 'temp-old',
    label: 'Temp 旧临时文件',
    path: path.win32.join(userProfile, 'AppData\\Local\\Temp'),
    type: 'clean',
    risk: '低风险：只删除超过 24 小时且未占用的临时项',
    action: '清理 24 小时前的未占用临时文件'
  },
  {
    id: 'electron-temp',
    label: 'Electron 解压残留',
    path: path.win32.join(userProfile, 'AppData\\Local\\Temp'),
    type: 'clean',
    risk: '低风险：只清理 3DZ*、ns*.tmp 等超过 24 小时的残留目录',
    action: '清理旧的 Electron 解压残留'
  },
  {
    id: 'recycle-bin',
    label: '回收站',
    path: 'C:\\$RECYCLE.BIN',
    openPath: 'shell:RecycleBinFolder',
    type: 'clean',
    risk: '高影响：清空后普通撤销不可用',
    action: '清空 C 盘回收站'
  }
]

const DISK_APP_CACHE_ITEMS = [
  {
    id: 'chrome-model',
    label: 'Chrome 本地模型',
    path: path.win32.join(userProfile, 'AppData\\Local\\Google\\Chrome\\User Data\\OptGuideOnDeviceModel'),
    type: 'app-cache',
    risk: '谨慎',
    action: '关闭 Chrome 后可手动删除，之后可能重新下载；工具不自动删除。'
  },
  {
    id: 'codex-data',
    label: 'Codex 数据',
    path: path.win32.join(userProfile, '.codex'),
    type: 'app-cache',
    risk: '高风险',
    action: '只做容量分析，不移动不删除。'
  },
  {
    id: 'jianying',
    label: '剪映缓存/数据',
    path: path.win32.join(userProfile, 'AppData\\Local\\JianyingPro'),
    type: 'app-cache',
    risk: '谨慎',
    action: '建议在软件设置里清理或迁移，不直接硬搬。'
  },
  {
    id: 'wechat-devtools',
    label: '微信开发者工具',
    path: path.win32.join(userProfile, 'AppData\\Local\\微信开发者工具'),
    type: 'app-cache',
    risk: '谨慎',
    action: '建议通过软件设置清理缓存，不直接硬搬。'
  },
  {
    id: 'douyin',
    label: '抖音数据',
    path: path.win32.join(userProfile, 'AppData\\Roaming\\douyin'),
    type: 'app-cache',
    risk: '谨慎',
    action: '建议在应用内清理缓存，不直接删除。'
  },
  {
    id: 'wechat',
    label: '微信数据',
    path: path.win32.join(userProfile, 'AppData\\Roaming\\Tencent\\WeChat'),
    type: 'app-cache',
    risk: '高风险',
    action: '聊天与文件数据风险高，只提示通过微信设置处理。'
  }
]

const migrationItemById = new Map(DISK_MIGRATION_ITEMS.map((item) => [item.id, item]))
const cleanItemById = new Map(DISK_CLEAN_ITEMS.map((item) => [item.id, item]))

function runPowerShellJson(script, fallback = []) {
  return new Promise((resolve, reject) => {
    execFile(
      powershellExe,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; ${script}`],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message))
          return
        }
        const content = String(stdout || '').trim()
        if (!content) {
          resolve(fallback)
          return
        }
        try {
          resolve(JSON.parse(content))
        } catch (parseError) {
          reject(new Error(`PowerShell 返回内容无法解析：${parseError.message}`))
        }
      }
    )
  })
}

function diskScanScript() {
  return `
$ErrorActionPreference = "SilentlyContinue"
$migrationItems = ${psLiteral(JSON.stringify(DISK_MIGRATION_ITEMS))} | ConvertFrom-Json
$cleanItems = ${psLiteral(JSON.stringify(DISK_CLEAN_ITEMS))} | ConvertFrom-Json
$appItems = ${psLiteral(JSON.stringify(DISK_APP_CACHE_ITEMS))} | ConvertFrom-Json
$movedRoot = ${psLiteral(movedRoot)}

function Get-PathSize([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return [int64]0 }
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($null -eq $item) { return [int64]0 }
  if (-not $item.PSIsContainer) { return [int64]$item.Length }
  $sum = [int64]0
  Get-ChildItem -LiteralPath $Path -Force -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    if (-not $_.PSIsContainer) { $sum += [int64]$_.Length }
  }
  return $sum
}

function Get-OldTempSize([string]$Path, [string[]]$Patterns) {
  if (-not (Test-Path -LiteralPath $Path)) { return [int64]0 }
  $cutoff = (Get-Date).AddHours(-24)
  $sum = [int64]0
  $children = Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $cutoff }
  if ($Patterns.Count -gt 0) {
    $children = $children | Where-Object {
      $name = $_.Name
      foreach ($pattern in $Patterns) {
        if ($name -like $pattern) { return $true }
      }
      return $false
    }
  }
  foreach ($child in $children) { $sum += Get-PathSize $child.FullName }
  return $sum
}

function Get-ItemState($Item) {
  $source = [string]$Item.source
  $target = [string]$Item.target
  $exists = Test-Path -LiteralPath $source
  $targetExists = Test-Path -LiteralPath $target
  $isJunction = $false
  $junctionTarget = ""
  $sourceSize = [int64]0
  $targetSize = if ($targetExists) { Get-PathSize $target } else { [int64]0 }
  if ($exists) {
    $sourceItem = Get-Item -LiteralPath $source -Force -ErrorAction SilentlyContinue
    $isJunction = (($sourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
    if ($sourceItem.Target) { $junctionTarget = [string]$sourceItem.Target }
    if (-not $isJunction) { $sourceSize = Get-PathSize $source }
  }
  $status = "未发现"
  $operation = ""
  if ($isJunction) {
    $status = "已迁移"
    $operation = "open"
  } elseif ($exists -and $targetExists) {
    $status = "需人工确认"
    $operation = "open"
  } elseif ($exists) {
    $status = "可迁移"
    $operation = "migrate"
  }
  [pscustomobject]@{
    id = $Item.id
    label = $Item.label
    type = $Item.type
    path = $source
    target = $target
    exists = [bool]$exists
    targetExists = [bool]$targetExists
    isJunction = [bool]$isJunction
    junctionTarget = $junctionTarget
    sizeBytes = [int64]($sourceSize + $(if ($isJunction) { $targetSize } else { 0 }))
    targetSizeBytes = [int64]$targetSize
    status = $status
    risk = $Item.risk
    action = if ($status -eq "需人工确认") { "目标目录已存在，源目录还不是 Junction，请人工确认后再操作。" } else { "迁移到 D:\\MovedFromC 并创建 Junction。" }
    operation = $operation
  }
}

$drives = foreach ($name in @("C", "D")) {
  $drive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($name):'"
  if ($drive) {
    $total = [int64]$drive.Size
    $free = [int64]$drive.FreeSpace
    [pscustomobject]@{
      drive = "$($name):"
      totalBytes = $total
      freeBytes = $free
      usedBytes = [int64]($total - $free)
      freePercent = if ($total -gt 0) { [math]::Round($free * 100 / $total, 1) } else { 0 }
    }
  }
}

$cleanRows = foreach ($item in $cleanItems) {
  $path = [string]$item.path
  $size = if ($item.id -eq "temp-old") {
    Get-OldTempSize $path @()
  } elseif ($item.id -eq "electron-temp") {
    Get-OldTempSize $path @("3DZ*", "ns*.tmp")
  } else {
    Get-PathSize $path
  }
  [pscustomobject]@{
    id = $item.id
    label = $item.label
    type = $item.type
    path = $path
    target = ""
    exists = [bool](Test-Path -LiteralPath $path)
    isJunction = $false
    junctionTarget = ""
    sizeBytes = [int64]$size
    targetSizeBytes = [int64]0
    status = if ($size -gt 0) { "可清理" } else { "暂无可清理" }
    risk = $item.risk
    action = $item.action
    operation = if ($size -gt 0) { "clean" } else { "open" }
  }
}

$appRows = foreach ($item in $appItems) {
  $path = [string]$item.path
  [pscustomobject]@{
    id = $item.id
    label = $item.label
    type = $item.type
    path = $path
    target = ""
    exists = [bool](Test-Path -LiteralPath $path)
    isJunction = $false
    junctionTarget = ""
    sizeBytes = [int64](Get-PathSize $path)
    targetSizeBytes = [int64]0
    status = "只读建议"
    risk = $item.risk
    action = $item.action
    operation = "open"
  }
}

$migrationRows = foreach ($item in $migrationItems) { Get-ItemState $item }
$items = @($migrationRows) + @($cleanRows) + @($appRows)
$largeItems = $items | Sort-Object -Property sizeBytes -Descending | Select-Object -First 10

[pscustomobject]@{
  generatedAt = (Get-Date).ToString("o")
  movedRoot = [pscustomobject]@{
    path = $movedRoot
    exists = [bool](Test-Path -LiteralPath $movedRoot)
    sizeBytes = [int64](Get-PathSize $movedRoot)
  }
  drives = @($drives)
  items = @($items)
  largeItems = @($largeItems)
  summary = "只读扫描完成；仅低风险项目提供操作入口。"
} | ConvertTo-Json -Depth 8 -Compress
`
}

function isRecycleBinShellPath(value) {
  return String(value || '').toLowerCase() === 'shell:recyclebinfolder'
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function openWindowsPath(targetPath) {
  return new Promise((resolve, reject) => {
    execFile(
      powershellExe,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Start-Process -FilePath explorer.exe -ArgumentList @('${String(targetPath).replace(/'/g, "''")}')`],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message))
          return
        }
        resolve()
      }
    )
  })
}

async function getPathSize(filePath) {
  let info
  try {
    info = await fs.lstat(filePath)
  } catch {
    return 0
  }
  if (info.isSymbolicLink()) return 0
  if (info.isFile()) return info.size
  if (!info.isDirectory()) return 0

  return new Promise((resolve) => {
    execFile(
      'robocopy.exe',
      [filePath, filePath, '/L', '/E', '/BYTES', '/XJ', '/R:0', '/W:0', '/NFL', '/NDL', '/NJH'],
      { windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (_error, stdout) => {
        const rows = String(stdout || '')
          .split(/\r?\n/)
          .map((line) => (line.match(/\d+/g) || []).map(Number))
          .filter((numbers) => numbers.length >= 6)
        resolve(rows[2]?.[0] || 0)
      }
    )
  })
}

async function getFilteredChildrenSize(filePath, { olderThanHours = 24, patterns = [] } = {}) {
  if (!(await pathExists(filePath))) return 0
  const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000
  let total = 0
  let entries = []
  try {
    entries = await fs.readdir(filePath, { withFileTypes: true })
  } catch {
    return 0
  }

  for (const entry of entries) {
    if (patterns.length && !patterns.some((pattern) => pattern.test(entry.name))) continue
    const fullPath = path.win32.join(filePath, entry.name)
    try {
      const info = await fs.lstat(fullPath)
      if (info.mtimeMs >= cutoff) continue
      total += info.isFile() ? info.size : await getPathSize(fullPath)
    } catch {
      // Locked temp items are simply skipped during scan.
    }
  }
  return total
}

async function getJunctionState(filePath) {
  try {
    const info = await fs.lstat(filePath)
    const isJunction = info.isSymbolicLink()
    let junctionTarget = ''
    if (isJunction) {
      try {
        junctionTarget = await fs.realpath(filePath)
      } catch {
        junctionTarget = ''
      }
    }
    return { exists: true, isJunction, junctionTarget }
  } catch {
    return { exists: false, isJunction: false, junctionTarget: '' }
  }
}

async function getDrives() {
  const script = `
$ErrorActionPreference = "SilentlyContinue"
$items = foreach ($name in @("C", "D")) {
  $drive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($name):'"
  if ($drive) {
    $total = [int64]$drive.Size
    $free = [int64]$drive.FreeSpace
    [pscustomobject]@{
      drive = "$($name):"
      totalBytes = $total
      freeBytes = $free
      usedBytes = [int64]($total - $free)
      freePercent = if ($total -gt 0) { [math]::Round($free * 100 / $total, 1) } else { 0 }
    }
  }
}
@($items) | ConvertTo-Json -Compress
`
  return toArray(await runPowerShellJson(script, []))
}

async function buildMigrationDiskRow(item) {
  const sourceState = await getJunctionState(item.source)
  const targetExists = await pathExists(item.target)
  const targetSize = targetExists ? await getPathSize(item.target) : 0
  const sourceSize = sourceState.exists && !sourceState.isJunction ? await getPathSize(item.source) : 0
  let status = '未发现'
  let operation = ''
  let action = '迁移到 D:\\MovedFromC 并创建 Junction。'
  if (sourceState.isJunction) {
    status = '已迁移'
    operation = 'open'
  } else if (sourceState.exists && targetExists) {
    status = '需人工确认'
    operation = 'open'
    action = '目标目录已存在，源目录还不是 Junction，请人工确认后再操作。'
  } else if (!sourceState.exists && targetExists) {
    status = '目标已存在'
    operation = 'open'
    action = '源目录不存在但目标目录存在，请人工确认是否需要重新创建 Junction。'
  } else if (sourceState.exists) {
    status = '可迁移'
    operation = 'migrate'
  }

  return {
    id: item.id,
    label: item.label,
    type: item.type,
    path: item.source,
    target: item.target,
    exists: sourceState.exists,
    targetExists,
    isJunction: sourceState.isJunction,
    junctionTarget: sourceState.junctionTarget,
    sizeBytes: sourceState.isJunction ? targetSize : sourceSize,
    targetSizeBytes: targetSize,
    status,
    risk: item.risk,
    action,
    operation
  }
}

async function buildCleanDiskRow(item) {
  const sizeBytes =
    item.id === 'temp-old'
      ? await getPathSize(item.path)
      : item.id === 'electron-temp'
        ? await getFilteredChildrenSize(item.path, { patterns: [/^3DZ/i, /^ns.*\.tmp$/i] })
        : await getPathSize(item.path)
  return {
    id: item.id,
    label: item.label,
    type: item.type,
    path: item.path,
    target: '',
    exists: await pathExists(item.path),
    isJunction: false,
    junctionTarget: '',
    sizeBytes,
    targetSizeBytes: 0,
    status: sizeBytes > 0 ? '可清理' : '暂无可清理',
    risk: item.risk,
    action: item.action,
    operation: sizeBytes > 0 ? 'clean' : 'open'
  }
}

async function buildAppCacheDiskRow(item) {
  return {
    id: item.id,
    label: item.label,
    type: item.type,
    path: item.path,
    target: '',
    exists: await pathExists(item.path),
    isJunction: false,
    junctionTarget: '',
    sizeBytes: await getPathSize(item.path),
    targetSizeBytes: 0,
    status: '只读建议',
    risk: item.risk,
    action: item.action,
    operation: 'open'
  }
}

async function scanDiskCheck() {
  const [drives, migrationRows, cleanRows, appRows, movedRootExists] = await Promise.all([
    getDrives(),
    Promise.all(DISK_MIGRATION_ITEMS.map(buildMigrationDiskRow)),
    Promise.all(DISK_CLEAN_ITEMS.map(buildCleanDiskRow)),
    Promise.all(DISK_APP_CACHE_ITEMS.map(buildAppCacheDiskRow)),
    pathExists(movedRoot)
  ])
  const movedRootSize = movedRootExists ? await getPathSize(movedRoot) : 0
  const items = [...migrationRows, ...cleanRows, ...appRows]
  const largeItems = [...items].sort((a, b) => Number(b.sizeBytes || 0) - Number(a.sizeBytes || 0)).slice(0, 10)

  return {
    generatedAt: new Date().toISOString(),
    movedRoot: {
      path: movedRoot,
      exists: movedRootExists,
      sizeBytes: movedRootSize
    },
    drives,
    items,
    largeItems,
    summary: '只读扫描完成；仅低风险项目提供操作入口。'
  }
}

function cleanDiskItemScript(item) {
  if (item.id === 'recycle-bin') {
    return `
$ErrorActionPreference = "SilentlyContinue"
$before = [int64]0
if (Test-Path -LiteralPath ${psLiteral(item.path)}) {
  Get-ChildItem -LiteralPath ${psLiteral(item.path)} -Force -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    if (-not $_.PSIsContainer) { $before += [int64]$_.Length }
  }
}
Clear-RecycleBin -DriveLetter C -Force -ErrorAction SilentlyContinue
[pscustomobject]@{
  ok = $true
  id = ${psLiteral(item.id)}
  message = "已请求清空 C 盘回收站"
  removedCount = 0
  skippedCount = 0
  freedBytes = $before
} | ConvertTo-Json -Compress
`
  }

  const patterns = item.id === 'electron-temp' ? '@("3DZ*", "ns*.tmp")' : '@()'
  return `
$ErrorActionPreference = "SilentlyContinue"
$root = ${psLiteral(item.path)}
$cutoff = (Get-Date).AddHours(-24)
$patterns = ${patterns}
$liveParents = @()
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -like "$root\\*" } | ForEach-Object {
  $liveParents += (Split-Path $_.ExecutablePath -Parent)
}
function Test-LivePath([string]$Path) {
  foreach ($live in $liveParents) {
    if ($Path.StartsWith($live, [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}
function Get-PathSize([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return [int64]0 }
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($null -eq $item) { return [int64]0 }
  if (-not $item.PSIsContainer) { return [int64]$item.Length }
  $sum = [int64]0
  Get-ChildItem -LiteralPath $Path -Force -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    if (-not $_.PSIsContainer) { $sum += [int64]$_.Length }
  }
  return $sum
}
$removed = 0
$skipped = 0
$freed = [int64]0
$errors = @()
$children = Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $cutoff }
if ($patterns.Count -gt 0) {
  $children = $children | Where-Object {
    $name = $_.Name
    foreach ($pattern in $patterns) {
      if ($name -like $pattern) { return $true }
    }
    return $false
  }
}
foreach ($child in $children) {
  if (Test-LivePath $child.FullName) { $skipped += 1; continue }
  $size = Get-PathSize $child.FullName
  try {
    Remove-Item -LiteralPath $child.FullName -Recurse -Force -ErrorAction Stop
    $removed += 1
    $freed += $size
  } catch {
    $skipped += 1
    if ($errors.Count -lt 5) { $errors += $_.Exception.Message }
  }
}
[pscustomobject]@{
  ok = $true
  id = ${psLiteral(item.id)}
  message = "清理完成：删除 $removed 项，跳过 $skipped 项"
  removedCount = $removed
  skippedCount = $skipped
  freedBytes = $freed
  errors = @($errors)
} | ConvertTo-Json -Depth 5 -Compress
`
}

function migrateDiskItemScript(item) {
  return `
$ErrorActionPreference = "Stop"
$source = ${psLiteral(item.source)}
$target = ${psLiteral(item.target)}
$expectedRoot = ${psLiteral(movedRoot)}
function Get-PathSize([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return [int64]0 }
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($null -eq $item) { return [int64]0 }
  if (-not $item.PSIsContainer) { return [int64]$item.Length }
  $sum = [int64]0
  Get-ChildItem -LiteralPath $Path -Force -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    if (-not $_.PSIsContainer) { $sum += [int64]$_.Length }
  }
  return $sum
}
if (-not (Test-Path -LiteralPath $source)) {
  [pscustomobject]@{ ok = $true; id = ${psLiteral(item.id)}; message = "源目录不存在，已跳过"; skipped = $true } | ConvertTo-Json -Compress
  exit 0
}
$sourceItem = Get-Item -LiteralPath $source -Force
if (($sourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
  [pscustomobject]@{ ok = $true; id = ${psLiteral(item.id)}; message = "源目录已经是 Junction，不重复迁移"; skipped = $true; path = $source; target = $sourceItem.Target } | ConvertTo-Json -Compress
  exit 0
}
if (Test-Path -LiteralPath $target) {
  throw "目标目录已存在，源目录还不是 Junction。为避免覆盖，请人工确认：$target"
}
if (-not $target.StartsWith($expectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "目标目录不在允许的 D:\\MovedFromC 范围内。"
}
$targetParent = Split-Path $target -Parent
New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
$beforeSize = Get-PathSize $source
robocopy $source $target /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NP | Out-Null
$code = $LASTEXITCODE
if ($code -gt 7) {
  throw "robocopy 失败，退出码 $code"
}
$backup = "$source.backup-$(Get-Date -Format yyyyMMddHHmmss)"
Rename-Item -LiteralPath $source -NewName (Split-Path $backup -Leaf) -ErrorAction Stop
cmd.exe /c mklink /J "$source" "$target" | Out-Null
$newItem = Get-Item -LiteralPath $source -Force
if (($newItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
  throw "Junction 创建后校验失败，备份保留在 $backup"
}
$targetSize = Get-PathSize $target
if ($targetSize -lt 0) {
  throw "目标目录校验异常，备份保留在 $backup"
}
if ($backup.StartsWith((Split-Path $source -Parent), [StringComparison]::OrdinalIgnoreCase) -and $backup -like "*.backup-*") {
  Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction Stop
}
[pscustomobject]@{
  ok = $true
  id = ${psLiteral(item.id)}
  message = "迁移完成并已创建 Junction"
  path = $source
  target = $target
  sourceSizeBytes = $beforeSize
  targetSizeBytes = $targetSize
} | ConvertTo-Json -Depth 4 -Compress
`
}

function isAllowedDiskPath(value) {
  const normalized = normalizePathText(path.win32.normalize(String(value || '')))
  if (!normalized) return false
  const allowedRoots = [userProfile, movedRoot, 'C:\\$RECYCLE.BIN', 'C:\\', 'D:\\'].map((item) => normalizePathText(path.win32.normalize(item)))
  return allowedRoots.some((root) => normalized === root || normalized.startsWith(`${root}\\`))
}

function processKey(process) {
  return normalizeText(`${process.name} ${process.path || ''} ${process.commandLine || ''}`)
}

function normalizePathText(value) {
  return String(value || '').replace(/\//g, '\\').toLowerCase()
}

function normalizeDetectedPath(value) {
  if (!value) return ''
  return path.normalize(String(value).replace(/^["']|["']$/g, ''))
}

function projectPathFromArgument(value) {
  const cleaned = normalizeDetectedPath(value)
  if (!cleaned) return ''
  if (/\.(?:csproj|sln|fsproj|vbproj)$/i.test(cleaned)) return path.dirname(cleaned)
  return cleaned
}

function inferProjectPathDirect(processInfo) {
  const text = `${processInfo.commandLine || ''}`
  const executablePath = `${processInfo.executablePath || ''}`
  const dotnetExecutableMatch = executablePath.match(/([A-Z]:\\[^"]+?)\\bin\\(?:Debug|Release)\\[^\\"]+\\[^\\"]+\.exe/i)
  if (dotnetExecutableMatch) return normalizeDetectedPath(dotnetExecutableMatch[1])

  const userExecutableMatch = executablePath.match(/([A-Z]:\\(?:Users|HuaweiMoveData)\\[^"]+?)\\[^\\"]+\.exe$/i)
  if (userExecutableMatch && !normalizePathText(userExecutableMatch[1]).includes('\\appdata\\')) {
    return normalizeDetectedPath(userExecutableMatch[1])
  }

  const nodeMatch = text.match(/([A-Z]:\\[^"]*?)\\node_modules\\/i)
  if (nodeMatch) return nodeMatch[1]

  const nextMatch = text.match(/([A-Z]:\\[^"]*?)\\\.next\\/i)
  if (nextMatch) return normalizeDetectedPath(nextMatch[1])

  const outputLogMatch = text.match(/([A-Z]:\\[^"]*?)\\output\\(?:server|logs?)\\[^"]+?\.log/i)
  if (outputLogMatch) return normalizeDetectedPath(outputLogMatch[1])

  const dotnetBuildOutputMatch = text.match(/([A-Z]:\\[^"]+?)\\(?:bin|obj)\\(?:Debug|Release)\\[^"]+?\\[^\\"]+\.dll/i)
  if (dotnetBuildOutputMatch) return normalizeDetectedPath(dotnetBuildOutputMatch[1])

  const launchSettingsMatch = text.match(/([A-Z]:\\[^"]+?)\\Properties\\launchSettings\.json/i)
  if (launchSettingsMatch) return normalizeDetectedPath(launchSettingsMatch[1])

  const quotedProjectArg = text.match(/(?:--project|-p)\s+(?:"([^"]+)"|'([^']+)')/i)
  if (quotedProjectArg) return projectPathFromArgument(quotedProjectArg[1] || quotedProjectArg[2])

  const bareProjectArg = text.match(/(?:--project|-p)\s+([A-Z]:\\[^\s"]+)/i)
  if (bareProjectArg) return projectPathFromArgument(bareProjectArg[1])

  const projectFileMatch = text.match(/([A-Z]:\\[^"]+?\.(?:csproj|sln|fsproj|vbproj))/i)
  if (projectFileMatch) return path.dirname(projectFileMatch[1])

  const scriptMatch = text.match(/([A-Z]:\\[^"]+?\\(?:server|src|scripts|dist)\\[^"]+?\.(?:js|mjs|cjs|ts))/i)
  if (scriptMatch) return path.dirname(path.dirname(scriptMatch[1]))

  if (Number(processInfo.pid) === process.pid) return rootDir
  return ''
}

function inferProjectPath(processInfo, processesByPid, seen = new Set()) {
  const directPath = inferProjectPathDirect(processInfo)
  const parentPid = Number(processInfo.parentProcessId)
  if (parentPid && !seen.has(parentPid) && processesByPid?.has(parentPid)) {
    seen.add(parentPid)
    const parentPath = inferProjectPath(processesByPid.get(parentPid), processesByPid, seen)
    if (directPath && parentPath && normalizePathText(directPath).startsWith(`${normalizePathText(parentPath)}\\`)) {
      return parentPath
    }
    if (!directPath && parentPath) return parentPath
  }
  if (directPath) return directPath
  if (!parentPid || seen.has(parentPid) || !processesByPid?.has(parentPid)) return ''
  seen.add(parentPid)
  return inferProjectPath(processesByPid.get(parentPid), processesByPid, seen)
}

function inferProjectKind(processes) {
  const text = normalizeText(processes.map((item) => item.commandLine || item.name || '').join(' '))
  const hasNext = text.includes('next')
  const hasVite = text.includes('vite')
  const hasNuxt = text.includes('nuxt')
  const hasDotnetWatch = text.includes('dotnet watch') || text.includes('dotnet-watch') || text.includes('watch.dll')
  const hasDotnetWeb = text.includes('dotnet run') || text.includes('--urls') || text.includes('aspnetcore_urls')
  const hasDotnet = hasDotnetWatch || hasDotnetWeb || text.includes('dotnet')

  const webKind = hasNext ? 'Next' : hasVite ? 'Vite' : hasNuxt ? 'Nuxt' : ''
  const dotnetKind = hasDotnetWatch ? '.NET watch' : hasDotnetWeb ? '.NET Web API' : hasDotnet ? '.NET' : ''
  if (webKind && dotnetKind) return `${webKind} + ${dotnetKind}`
  if (webKind) return webKind
  if (dotnetKind) return dotnetKind
  if (text.includes('nodemon')) return 'Node/Nodemon'
  return 'Node'
}

function projectDisplayName(projectPath, fallback) {
  if (!projectPath) return fallback || '本地进程'
  return path.basename(projectPath) || projectPath
}

function isUserDevCommand(processInfo) {
  const name = normalizeText(processInfo.name || processInfo.Name).replace(/\.exe$/, '')
  const commandLine = normalizePathText(processInfo.commandLine || processInfo.CommandLine)
  const userRoot = normalizePathText(userProfile)
  const launcherNames = new Set(['powershell', 'pwsh', 'cmd', 'dotnet', 'node', 'npm', 'npx', 'pnpm', 'bun', 'deno', 'python'])
  const hasUserPath = commandLine.includes(userRoot) || commandLine.includes('\\huaweimovedata\\users\\huawei\\')
  const hasDevSignal = /vite|next|nuxt|webpack|nodemon|dotnet\s+(watch|run)|--urls|localhost:\d+|server\/index\.js/i.test(commandLine)
  return launcherNames.has(name) && hasUserPath && hasDevSignal
}

function localProjectProtectionReason(processInfo, projectPath = '') {
  const pid = Number(processInfo.pid || processInfo.ProcessId || processInfo.Id)
  const name = normalizeText(processInfo.name || processInfo.Name).replace(/\.exe$/, '')
  const commandLine = normalizePathText(processInfo.commandLine || processInfo.CommandLine)
  const pathText = normalizePathText(processInfo.executablePath || processInfo.path || processInfo.Path)
  const panelRoot = normalizePathText(rootDir)
  const projectRoot = normalizePathText(projectPath)
  const isSystemPath =
    pathText.startsWith('c:\\windows\\system32') ||
    pathText.startsWith('c:\\windows\\syswow64') ||
    pathText.startsWith('c:\\windows\\systemapps')
  const protectedSystem = PROTECTED_HINTS.some((hint) => `${name} ${pathText}`.includes(hint))

  if (pid === process.pid || commandLine.includes(panelRoot) || pathText.includes(panelRoot) || projectRoot === panelRoot) {
    return '面板保护'
  }
  if ((isSystemPath || SYSTEM_NAMES.has(name) || protectedSystem) && !isUserDevCommand(processInfo)) return '系统保护'
  return ''
}

function buildLocalProjects(processes) {
  const groups = new Map()
  const processesByPid = new Map(processes.map((item) => [Number(item.pid), item]))
  for (const processInfo of processes) {
    const projectPath = inferProjectPath(processInfo, processesByPid)
    const protectedReason = localProjectProtectionReason(processInfo, projectPath)
    const key = projectPath || `${processInfo.name}-${processInfo.parentProcessId || processInfo.pid}`
    const group =
      groups.get(key) || {
        id: Buffer.from(key).toString('base64url'),
        name: projectDisplayName(projectPath, processInfo.name),
        projectPath,
        kind: '',
        commandLine: processInfo.commandLine || '',
        pids: [],
        ports: new Set(),
        memoryBytes: 0,
        protected: false,
        protectedReason: '',
        processes: []
      }

    group.pids.push(Number(processInfo.pid))
    group.memoryBytes += Number(processInfo.workingSet || 0)
    group.protected = group.protected || Boolean(protectedReason)
    if (protectedReason === '面板保护' || (!group.protectedReason && protectedReason)) group.protectedReason = protectedReason
    for (const port of processInfo.ports || []) group.ports.add(Number(port))
    group.processes.push(processInfo)
    groups.set(key, group)
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      kind: inferProjectKind(group.processes),
      ports: [...group.ports].filter(Boolean).sort((a, b) => a - b),
      urls: [...group.ports].filter(Boolean).sort((a, b) => a - b).map((port) => `http://localhost:${port}`),
      processCount: group.pids.length,
      memoryGb: bytesToGb(group.memoryBytes),
      processes: group.processes
        .sort((a, b) => Number(b.workingSet || 0) - Number(a.workingSet || 0))
        .map((item) => ({
          pid: item.pid,
          name: item.name,
          memoryGb: bytesToGb(item.workingSet),
          ports: item.ports || [],
          commandLine: item.commandLine || ''
        }))
    }))
    .filter((group) => {
      const projectPath = normalizePathText(group.projectPath)
      if (projectPath.includes('\\appdata\\local\\npm-cache\\_npx\\')) return false
      if (projectPath === 'c:\\program files\\nodejs\\' || projectPath === 'c:\\program files\\nodejs') return false
      return Boolean(group.projectPath) || group.ports.length > 0
    })
    .sort((a, b) => Number(b.memoryGb || 0) - Number(a.memoryGb || 0) || a.name.localeCompare(b.name))
}

async function listLocalProjects() {
  const script = `
$ErrorActionPreference = "SilentlyContinue"
$devCommandPattern = "vite|next|nuxt|webpack|nodemon|ts-node|tsx|server/index.js|dotnet\\s+(watch|run)|dotnet-watch|watch\\.dll|--urls|ASPNETCORE_URLS|ASPNETCORE_ENVIRONMENT|localhost:\\d+|http://localhost"
$devProcessNames = @("node.exe", "dotnet.exe", "npm.cmd", "npx.cmd", "pnpm.exe", "pnpm.cmd", "bun.exe", "deno.exe", "python.exe", "pythonw.exe", "java.exe", "php.exe", "ruby.exe")
$userPathPattern = "\\Users\\HUAWEI\\|\\HuaweiMoveData\\Users\\HUAWEI\\|\\Desktop\\|\\Documents\\|\\source\\repos\\"
$runtime = @{}
Get-Process | ForEach-Object { $runtime["$($_.Id)"] = $_ }
$portMap = @{}
$devPortPids = @{}
netstat -ano -p tcp | Select-String "LISTENING" | ForEach-Object {
  $line = $_.Line
  if ($line -match "^\\s*TCP\\s+\\S+:(\\d+)\\s+\\S+\\s+LISTENING\\s+(\\d+)\\s*$") {
    $pidText = $matches[2]
    $port = [int]$matches[1]
    if (-not $portMap.ContainsKey($pidText)) { $portMap[$pidText] = @() }
    $portMap[$pidText] += $port
    if ($port -ge 3000 -and $port -le 9999) { $devPortPids[$pidText] = $true }
  }
}
$processes = Get-CimInstance Win32_Process | Where-Object {
  $pidText = "$($_.ProcessId)"
  $text = "$($_.CommandLine) $($_.ExecutablePath)"
  $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine -notmatch "Get-CimInstance Win32_Process" -and (
    $_.Name -in $devProcessNames -or
    $_.CommandLine -match $devCommandPattern -or
    ($devPortPids.ContainsKey($pidText) -and $text -match $userPathPattern)
  )
}
$items = foreach ($p in $processes) {
  $pidText = "$($p.ProcessId)"
  $r = $runtime[$pidText]
  [pscustomobject]@{
    pid = [int]$p.ProcessId
    name = ($p.Name -replace "\\.exe$", "")
    commandLine = $p.CommandLine
    executablePath = $p.ExecutablePath
    parentProcessId = [int]$p.ParentProcessId
    workingSet = [int64]($r.WorkingSet64)
    cpuSeconds = [double]($r.CPU)
    ports = @($portMap[$pidText])
  }
}
@($items) | ConvertTo-Json -Depth 6 -Compress
`
  return buildLocalProjects(toArray(await runPowerShellJson(script)))
}

const STARTUP_APP_HINTS = [
  {
    pattern: /acappdaemon|accessoryapp|accessories_center/i,
    displayName: '华为配件中心',
    description: '华为电脑管家配件与外设相关组件，用于配件连接、状态同步和辅助功能。'
  },
  {
    pattern: /baiduyundetect|baidunetdisk|百度网盘/i,
    displayName: '百度网盘',
    description: '百度网盘客户端启动检测与辅助唤起组件，用于网盘后台初始化。'
  },
  {
    pattern: /ctfmon/i,
    displayName: 'Windows 输入法',
    description: 'Windows 文本输入、输入法和语言栏相关组件，通常建议保持开启。'
  },
  {
    pattern: /microsoftedgeautolaunch|msedge/i,
    displayName: 'Microsoft Edge',
    description: 'Edge 浏览器开机预加载或会话恢复入口，可按使用习惯决定是否保留。'
  },
  {
    pattern: /onedrive/i,
    displayName: 'Microsoft OneDrive',
    description: '微软云盘同步客户端，用于登录后自动同步文件和云端状态。'
  },
  {
    pattern: /youdaodict|youdao/i,
    displayName: '有道词典',
    description: '有道词典后台启动项，用于开机后常驻和快捷取词。'
  },
  {
    pattern: /onenote/i,
    displayName: '发送至 OneNote',
    description: 'OneNote 快捷发送组件，用于把内容快速保存到 OneNote。'
  },
  {
    pattern: /adobe ccxprocess|ccxprocess|creative cloud/i,
    displayName: 'Adobe Creative Cloud',
    description: 'Adobe Creative Cloud 体验组件，用于 Adobe 应用登录、同步和面板服务。'
  },
  {
    pattern: /securityhealth/i,
    displayName: 'Windows 安全中心',
    description: 'Windows 安全中心托盘提醒和安全状态入口，系统级项目建议保持开启。'
  },
  {
    pattern: /sysdiag|hipstray|huorong|火绒/i,
    displayName: '火绒安全',
    description: '火绒安全软件托盘入口和防护状态组件，系统级安全项目建议保持开启。'
  }
]

function enrichStartupItem(item) {
  const text = `${item.name || ''} ${item.command || ''} ${item.location || ''}`
  const hint = STARTUP_APP_HINTS.find((entry) => entry.pattern.test(text))
  const displayName = hint?.displayName || item.name || '未知应用'
  const description =
    hint?.description ||
    (item.scope === '所有用户'
      ? '系统级开机启动项，影响所有用户；当前版本只读展示，避免误改全局配置。'
      : '当前用户开机启动项，可按使用频率决定是否随 Windows 自动启动。')
  return {
    ...item,
    displayName,
    description
  }
}

async function listStartupItems() {
  const script = `
$ErrorActionPreference = "SilentlyContinue"
$backupRoot = "HKCU:\\Software\\WinStatusInsight\\DisabledStartup"
$disabledFolder = Join-Path $env:APPDATA "WinStatusInsight\\DisabledStartup"
$items = @()
function Add-RunItems($Path, $Scope, $Manageable) {
  if (-not (Test-Path $Path)) { return }
  $props = Get-ItemProperty -Path $Path
  $props.PSObject.Properties | Where-Object { $_.Name -notmatch "^PS" } | ForEach-Object {
    $script:items += [pscustomobject]@{
      id = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$Path|$($_.Name)|enabled"))
      name = $_.Name
      command = "$($_.Value)"
      location = $Path
      scope = $Scope
      type = "registry-run"
      enabled = $true
      manageable = $Manageable
      disabledReason = $(if ($Manageable) { "" } else { "系统级启动项暂只读，避免误改全局配置。" })
    }
  }
}
Add-RunItems "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" "当前用户" $true
Add-RunItems "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" "所有用户" $false
Add-RunItems "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run" "所有用户" $false

$userStartup = [Environment]::GetFolderPath("Startup")
if (Test-Path $userStartup) {
  Get-ChildItem -LiteralPath $userStartup -File | ForEach-Object {
    $items += [pscustomobject]@{
      id = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("startup-folder|$($_.FullName)|enabled"))
      name = $_.BaseName
      command = $_.FullName
      location = $userStartup
      scope = "当前用户"
      type = "startup-folder"
      enabled = $true
      manageable = $true
      disabledReason = ""
    }
  }
}

$backupRun = Join-Path $backupRoot "Run"
if (Test-Path $backupRun) {
  $props = Get-ItemProperty -Path $backupRun
  $props.PSObject.Properties | Where-Object { $_.Name -notmatch "^PS" } | ForEach-Object {
    $items += [pscustomobject]@{
      id = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run|$($_.Name)|disabled"))
      name = $_.Name
      command = "$($_.Value)"
      location = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
      scope = "当前用户"
      type = "registry-run"
      enabled = $false
      manageable = $true
      disabledReason = ""
    }
  }
}

if (Test-Path $disabledFolder) {
  Get-ChildItem -LiteralPath $disabledFolder -File | ForEach-Object {
    $items += [pscustomobject]@{
      id = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("startup-folder|$($_.FullName)|disabled"))
      name = $_.BaseName
      command = $_.FullName
      location = $userStartup
      scope = "当前用户"
      type = "startup-folder"
      enabled = $false
      manageable = $true
      disabledReason = ""
    }
  }
}
@($items | Sort-Object @{Expression="enabled";Descending=$true}, name) | ConvertTo-Json -Depth 5 -Compress
`
  return toArray(await runPowerShellJson(script)).map(enrichStartupItem)
}

async function toggleStartupItem({ name, command, type, enabled }) {
  const safeName = String(name || '').replace(/'/g, "''")
  const safeCommand = String(command || '').replace(/'/g, "''")
  const action = enabled ? 'enable' : 'disable'
  const safeType = String(type || '').replace(/'/g, "''")
  const script = `
$ErrorActionPreference = "Stop"
$name = '${safeName}'
$command = '${safeCommand}'
$type = '${safeType}'
$action = '${action}'
$runPath = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
$backupRun = "HKCU:\\Software\\WinStatusInsight\\DisabledStartup\\Run"
$disabledFolder = Join-Path $env:APPDATA "WinStatusInsight\\DisabledStartup"
$startupFolder = [Environment]::GetFolderPath("Startup")
if ($type -eq "registry-run") {
  if ($action -eq "disable") {
    New-Item -Path $backupRun -Force | Out-Null
    $value = (Get-ItemProperty -Path $runPath -Name $name -ErrorAction Stop).$name
    New-ItemProperty -Path $backupRun -Name $name -Value $value -PropertyType String -Force | Out-Null
    Remove-ItemProperty -Path $runPath -Name $name -ErrorAction Stop
  } else {
    $value = (Get-ItemProperty -Path $backupRun -Name $name -ErrorAction Stop).$name
    New-ItemProperty -Path $runPath -Name $name -Value $value -PropertyType String -Force | Out-Null
    Remove-ItemProperty -Path $backupRun -Name $name -ErrorAction Stop
  }
} elseif ($type -eq "startup-folder") {
  New-Item -ItemType Directory -Path $disabledFolder -Force | Out-Null
  if ($action -eq "disable") {
    $source = $command
    if (-not (Test-Path -LiteralPath $source)) { throw "启动项文件不存在：$source" }
    Move-Item -LiteralPath $source -Destination (Join-Path $disabledFolder (Split-Path $source -Leaf)) -Force
  } else {
    $source = $command
    if (-not (Test-Path -LiteralPath $source)) {
      $source = Join-Path $disabledFolder (Split-Path $command -Leaf)
    }
    if (-not (Test-Path -LiteralPath $source)) { throw "已禁用启动项文件不存在：$source" }
    Move-Item -LiteralPath $source -Destination (Join-Path $startupFolder (Split-Path $source -Leaf)) -Force
  }
} else {
  throw "不支持的启动项类型：$type"
}
[pscustomobject]@{ ok = $true; action = $action; name = $name } | ConvertTo-Json -Compress
`
  return runPowerShellJson(script)
}

function groupNameForProcess(process) {
  const name = normalizeText(process.name).replace(/\.exe$/, '')
  const key = processKey(process)
  const pathText = normalizeText(process.path)

  if (key.includes('codex')) return 'Codex'
  if (/^(chrome|msedge|firefox)$/.test(name)) return name === 'msedge' ? 'Edge' : name[0].toUpperCase() + name.slice(1)
  if (name === 'msedgewebview2') return 'Edge WebView'
  if (/^(node|npm|pnpm|vite)$/.test(name)) return 'Node/Vite'
  if (/^(code|code - insiders)$/.test(name) || key.includes('microsoft vs code')) return 'VS Code'
  if (/^(devenv|dotnet|servicehub|vbcscompiler)$/.test(name)) return '.NET/Visual Studio'
  if (/^(postgres|pg_ctl)$/.test(name)) return 'PostgreSQL'
  if (name === 'explorer') return 'Windows 资源管理器'
  if (/^(dwm|system|svchost|runtimebroker|searchhost|searchindexer|msmpeng|securityhealth|services)$/.test(name)) return 'Windows/System'
  if (/^(acappdaemon|hiconnectivity|hwdistributed|appgallery|huawei|hw)/.test(name) || pathText.includes('\\program files\\huawei\\')) return 'Huawei services'
  if (name === 'wechat' || key.includes('tencent\\wechat')) return 'WeChat'

  return process.name || 'unknown'
}

function buildGroupSuggestion(group) {
  const key = normalizeText(group.name)
  if (key.includes('资源管理器')) return '资源管理器 CPU 偏高，优先关闭异常文件夹窗口，留意同步盘、压缩包目录或右键扩展。'
  if (key.includes('node') || key.includes('vite')) return '本地开发服务占用较高，确认不用的项目后再停止对应 dev server。'
  if (key.includes('codex')) return 'Codex 会话占用较高，可关闭不用的会话窗口或减少并行任务。'
  if (key.includes('chrome') || key.includes('edge')) return '浏览器多进程累计占用较高，可先关闭不用的标签页或扩展。'
  if (key.includes('huawei')) return '厂商后台服务数量较多，建议只处理确认不用的辅助功能服务。'
  if (group.system) return '系统进程只做观察，不建议在这里强制结束。'
  return '多进程应用累计占用较高，建议先确认用途，再决定是否关闭。'
}

function buildAppGroups(processes) {
  const groups = new Map()
  for (const process of processes) {
    const name = groupNameForProcess(process)
    const current =
      groups.get(name) || {
        name,
        count: 0,
        cpuPercent: 0,
        workingSet: 0,
        privateMemory: 0,
        risk: 'low',
        cleanable: false,
        system: true,
        tags: new Set(),
        processes: []
      }

    current.count += 1
    current.cpuPercent += Number(process.cpuPercent || 0)
    current.workingSet += Number(process.workingSet || 0)
    current.privateMemory += Number(process.privateMemory || 0)
    current.cleanable = current.cleanable || Boolean(process.cleanupAllowed)
    current.system = current.system && Boolean(process.isSystem || process.protectedSystem)
    if (process.risk === 'high' || (process.risk === 'medium' && current.risk !== 'high')) current.risk = process.risk
    for (const tag of process.tags || []) current.tags.add(tag)
    current.processes.push(process)
    groups.set(name, current)
  }

  return [...groups.values()]
    .map((group) => {
      const row = {
        name: group.name,
        count: group.count,
        cpuPercent: Number(group.cpuPercent.toFixed(2)),
        workingSetGb: bytesToGb(group.workingSet),
        privateMemoryGb: bytesToGb(group.privateMemory),
        risk: group.risk,
        cleanable: group.cleanable,
        system: group.system,
        tags: [...group.tags].slice(0, 5),
        topProcesses: group.processes
          .sort((a, b) => b.cpuPercent - a.cpuPercent || b.workingSet - a.workingSet)
          .slice(0, 4)
          .map((process) => ({
            name: process.name,
            pid: process.pid,
            cpuPercent: process.cpuPercent,
            workingSetGb: process.workingSetGb,
            cleanupAllowed: process.cleanupAllowed,
            path: process.path
          })),
        processes: group.processes
          .sort((a, b) => b.cpuPercent - a.cpuPercent || b.workingSet - a.workingSet)
          .map((process) => ({
            name: process.name,
            pid: process.pid,
            cpuPercent: process.cpuPercent,
            workingSetGb: process.workingSetGb,
            risk: process.risk,
            tags: process.tags,
            cleanupAllowed: process.cleanupAllowed,
            cleanupDisabledReason: process.cleanupDisabledReason,
            path: process.path,
            suggestion: process.suggestion,
            system: process.isSystem,
            protectedSystem: process.protectedSystem,
            appGroupName: group.name
          }))
      }
      row.suggestion = buildGroupSuggestion(row)
      row.impact = row.cpuPercent * 2 + row.workingSetGb * 10 + row.count * 0.15
      return row
    })
    .filter((group) => group.cpuPercent >= 0.5 || group.workingSetGb >= 0.25 || group.risk !== 'low')
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 12)
}

function markProcess(process, startupItems, services) {
  const key = processKey(process)
  const name = normalizeText(process.name)
  const exeName = name.endsWith('.exe') ? name : `${name}.exe`
  const pathText = normalizeText(process.path)
  const cmd = normalizeText(process.commandLine)

  const matchedStartup = startupItems.find((item) => {
    const text = normalizeText(`${item.name} ${item.command}`)
    return text.includes(name) || text.includes(exeName) || (pathText && text.includes(pathText))
  })

  const matchedService = services.find((item) => {
    const text = normalizeText(`${item.name} ${item.displayName} ${item.pathName}`)
    return text.includes(name) || text.includes(exeName) || (pathText && text.includes(pathText))
  })

  const isSystemPath =
    pathText.startsWith('c:\\windows\\system32') ||
    pathText.startsWith('c:\\windows\\syswow64') ||
    pathText.startsWith('c:\\windows\\systemapps')
  const isSystem = isSystemPath || SYSTEM_NAMES.has(name.replace(/\.exe$/, ''))
  const isUserApp = pathText.includes('\\users\\') || pathText.includes('\\program files') || pathText.includes('\\desktop')
  const hasWindow = Boolean(process.mainWindowTitle && String(process.mainWindowTitle).trim())
  const isHighCpu = Number(process.cpuPercent || 0) >= 8
  const isHighMemory = Number(process.workingSet || 0) >= 800 * 1024 * 1024
  const attention = !isSystem && (isHighCpu || isHighMemory || ((matchedStartup || matchedService) && !hasWindow))

  const tags = []
  if (matchedStartup) tags.push('后台自启')
  if (matchedService) tags.push('后台服务')
  if (isSystem) tags.push('系统进程')
  if (isUserApp && !isSystem) tags.push('用户应用')
  if (attention) tags.push('值得关注')

  let risk = 'low'
  if (attention && (Number(process.cpuPercent || 0) >= 15 || Number(process.workingSet || 0) >= 1024 * 1024 * 1024)) {
    risk = 'high'
  } else if (attention) {
    risk = 'medium'
  }

  const matchedHint = APP_HINTS.find((hint) => hint.pattern.test(key))
  const protectedSystem = PROTECTED_HINTS.some((hint) => key.includes(hint))

  return {
    ...process,
    cpuPercent: Number(process.cpuPercent || 0),
    cpuDeltaSeconds: Number(process.cpuDeltaSeconds || 0),
    workingSet: Number(process.workingSet || 0),
    privateMemory: Number(process.privateMemory || 0),
    workingSetGb: bytesToGb(process.workingSet),
    privateMemoryGb: bytesToGb(process.privateMemory),
    tags,
    risk,
    source: matchedStartup?.name || matchedService?.displayName || matchedService?.name || '',
    sourceType: matchedStartup ? 'startup' : matchedService ? 'service' : '',
    hasWindow,
    isSystem,
    protectedSystem,
    cleanupAllowed: !isSystem && !protectedSystem,
    cleanupDisabledReason: isSystem || protectedSystem ? '系统/安全/更新相关进程，为避免破坏系统已禁用清理。' : '',
    hintType: matchedHint?.type || '',
    suggestion: protectedSystem
      ? '系统或安全相关进程，只观察原因，不建议强制结束。'
      : matchedHint?.action || (attention ? '资源占用或后台来源值得确认，建议先核对路径和用途。' : '')
  }
}

function scoreSnapshot(snapshot) {
  const system = snapshot.system || {}
  const cpu = Number(system.cpuPercent || 0)
  const memory = Number(system.memoryPercent || 0)
  const highCpuCount = snapshot.processes.filter((p) => p.cpuPercent >= 15).length
  const highMemoryCount = snapshot.processes.filter((p) => p.workingSet >= 1024 * 1024 * 1024).length

  let penalty = 0
  if (cpu > 60) penalty += (cpu - 60) * 0.45
  if (cpu > 85) penalty += (cpu - 85) * 0.8
  if (memory > 75) penalty += (memory - 75) * 0.6
  if (memory > 90) penalty += (memory - 90) * 1.2
  penalty += highCpuCount * 5 + highMemoryCount * 4

  const score = Math.max(0, Math.round(100 - penalty))
  const label = score >= 85 ? '流畅' : score >= 70 ? '轻微压力' : score >= 50 ? '明显卡顿风险' : '严重卡顿'
  const bottlenecks = []
  if (cpu >= 60) bottlenecks.push({ type: 'CPU', text: `CPU 当前 ${cpu}%` })
  if (memory >= 75) bottlenecks.push({ type: '内存', text: `内存占用 ${memory}%` })
  if (!bottlenecks.length) bottlenecks.push({ type: '整体', text: '当前没有明显瓶颈' })

  return { score, label, bottlenecks }
}

function buildSuggestions(snapshot) {
  const ranked = snapshot.processes
    .filter((p) => p.cleanupAllowed && (p.risk !== 'low' || p.cpuPercent >= 8 || p.workingSet >= 800 * 1024 * 1024))
    .sort((a, b) => {
      const ar = a.risk === 'high' ? 3 : a.risk === 'medium' ? 2 : 1
      const br = b.risk === 'high' ? 3 : b.risk === 'medium' ? 2 : 1
      return br - ar || b.cpuPercent - a.cpuPercent || b.workingSet - a.workingSet
    })
    .slice(0, 8)

  if (!ranked.length) {
    return [{ level: 'info', title: '当前状态较轻', processName: '', text: '暂时没有需要优先清理的应用。' }]
  }

  return ranked.map((p) => ({
    level: p.protectedSystem ? 'info' : p.risk === 'high' ? 'danger' : 'warning',
    title: p.protectedSystem ? '观察系统任务' : p.risk === 'high' ? '优先处理' : '可以确认',
    processName: p.name,
    pid: p.pid,
    text: p.suggestion || '建议确认该进程是否需要继续运行。',
    cpuPercent: p.cpuPercent,
    memoryGb: p.workingSetGb,
    tags: p.tags,
    cleanable: p.cleanupAllowed,
    cleanupDisabledReason: p.cleanupDisabledReason,
    risk: p.risk
  }))
}

function canTerminateProcess(processInfo) {
  const name = normalizeText(processInfo.name || processInfo.ProcessName).replace(/\.exe$/, '')
  const pathText = normalizeText(processInfo.path || processInfo.Path)
  const key = normalizeText(`${name} ${pathText}`)
  const isSystemPath =
    pathText.startsWith('c:\\windows\\system32') ||
    pathText.startsWith('c:\\windows\\syswow64') ||
    pathText.startsWith('c:\\windows\\systemapps')
  const protectedSystem = PROTECTED_HINTS.some((hint) => key.includes(hint))
  const isSystem = isSystemPath || SYSTEM_NAMES.has(name)

  if (Number(processInfo.pid || processInfo.Id) === process.pid) {
    return { allowed: false, reason: '这是当前分析面板服务进程，结束后面板会失去响应。' }
  }
  if (isSystem || protectedSystem) {
    return { allowed: false, reason: '系统/安全/更新相关进程不能在这里清理。' }
  }
  return { allowed: true, reason: '' }
}

function canStopLocalProjectProcess(processInfo) {
  const protectedReason = localProjectProtectionReason(processInfo)
  if (protectedReason === '面板保护') {
    return { allowed: false, reason: '这是当前分析面板相关进程，停止后面板可能失去响应。' }
  }
  if (protectedReason === '系统保护') {
    return { allowed: false, reason: '该项目包含系统保护进程，不能在这里停止。' }
  }
  if (isUserDevCommand(processInfo)) return { allowed: true, reason: '' }

  const decision = canTerminateProcess(processInfo)
  if (!decision.allowed) return decision

  const commandLine = normalizePathText(processInfo.commandLine || processInfo.CommandLine)
  const pathText = normalizePathText(processInfo.path || processInfo.Path)
  const panelRoot = normalizePathText(rootDir)
  if (commandLine.includes(panelRoot) || pathText.includes(panelRoot)) {
    return { allowed: false, reason: '这是当前分析面板相关进程，停止后面板可能失去响应。' }
  }

  return { allowed: true, reason: '' }
}

function getProcessInfo(pid) {
  return new Promise((resolve, reject) => {
    execFile(
      powershellExe,
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop; [pscustomobject]@{pid=[int]$p.ProcessId; name=($p.Name -replace "\\.exe$",""); path=$p.ExecutablePath; commandLine=$p.CommandLine; parentProcessId=[int]$p.ParentProcessId} | ConvertTo-Json -Compress`
      ],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message))
          return
        }
        try {
          resolve(JSON.parse(stdout))
        } catch (parseError) {
          reject(new Error(`进程信息无法解析：${parseError.message}`))
        }
      }
    )
  })
}

function terminateProcess(pid) {
  return new Promise((resolve, reject) => {
    execFile(
      powershellExe,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Stop-Process -Id ${pid} -Force -ErrorAction Stop`],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message))
          return
        }
        resolve({ stdout })
      }
    )
  })
}

function friendlyProcessError(error) {
  const message = String(error?.message || error || '')
  if (/access is denied|拒绝|denied|CouldNotStopProcess/i.test(message)) return '权限不足，已跳过。'
  if (/not found|No Instance|Cannot find|找不到/i.test(message)) return '进程已退出，已跳过。'
  return '停止失败，已跳过。'
}

function enrich(raw) {
  const startupItems = toArray(raw.startupItems)
  const services = toArray(raw.services)
  const processes = toArray(raw.processes).map((p) => {
    const marked = markProcess(p, startupItems, services)
    return { ...marked, appGroupName: groupNameForProcess(marked) }
  })
  const enriched = {
    ...raw,
    id: raw.id || `snapshot-${new Date(raw.capturedAt || Date.now()).toISOString().replace(/[:.]/g, '-')}`,
    processes,
    appGroups: buildAppGroups(processes),
    topCpu: [...processes].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 20),
    topMemory: [...processes].sort((a, b) => b.workingSet - a.workingSet).slice(0, 20),
    background: processes
      .filter((p) => p.tags.includes('后台自启') || p.tags.includes('后台服务') || p.tags.includes('值得关注'))
      .sort((a, b) => b.cpuPercent - a.cpuPercent || b.workingSet - a.workingSet)
      .slice(0, 30)
  }
  enriched.analysis = scoreSnapshot(enriched)
  enriched.suggestions = buildSuggestions(enriched)
  return enriched
}

function runCollector() {
  return new Promise((resolve, reject) => {
    execFile(
      powershellExe,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-IntervalSeconds', '2', '-Top', '30'],
      { cwd: processCwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message))
          return
        }
        try {
          resolve(JSON.parse(stdout))
        } catch (parseError) {
          reject(new Error(`PowerShell 返回内容无法解析：${parseError.message}`))
        }
      }
    )
  })
}

async function saveSnapshot(snapshot) {
  await fs.mkdir(snapshotsDir, { recursive: true })
  const fileName = `${snapshot.id}.json`
  const filePath = path.join(snapshotsDir, fileName)
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8')
  return fileName
}

async function readSnapshots() {
  await fs.mkdir(snapshotsDir, { recursive: true })
  const files = (await fs.readdir(snapshotsDir)).filter((file) => file.endsWith('.json')).sort().reverse()
  const items = []
  for (const file of files) {
    try {
      const json = JSON.parse(await fs.readFile(path.join(snapshotsDir, file), 'utf8'))
      items.push({
        id: json.id || file.replace(/\.json$/, ''),
        file,
        capturedAt: json.capturedAt,
        score: json.analysis?.score,
        label: json.analysis?.label,
        cpuPercent: json.system?.cpuPercent,
        memoryPercent: json.system?.memoryPercent,
        diskBusyPercent: json.system?.diskBusyPercent
      })
    } catch {
      // Ignore broken snapshot files.
    }
  }
  return items
}

function parseMetric(content, pattern) {
  const match = content.match(pattern)
  return match ? Number(match[1]) : null
}

function parseText(content, pattern) {
  const match = content.match(pattern)
  return match ? match[1].trim() : ''
}

async function readOldLogs() {
  if (!existsSync(oldLogsDir)) return []
  const files = (await fs.readdir(oldLogsDir)).filter((file) => file.endsWith('.txt')).sort().reverse()
  const logs = []
  for (const file of files) {
    const fullPath = path.join(oldLogsDir, file)
    const content = await fs.readFile(fullPath, 'utf8')
    logs.push({
      id: file.replace(/\.txt$/, ''),
      file,
      path: fullPath,
      capturedAt: parseText(content, /Started:\s+([0-9-]+\s+[0-9:]+)/),
      cpuPercent: parseMetric(content, /System CPU load:\s+([0-9.]+)%/),
      memoryPercent: parseMetric(content, /Memory used:.*\(([0-9.]+)%\)/),
      diskBusyPercent: parseMetric(content, /Busy=\s*([0-9.]+)%/),
      source: 'old-log'
    })
  }
  return logs
}

app.get('/api/status', async (_req, res) => {
  try {
    const raw = await runCollector()
    const snapshot = enrich(raw)
    const fileName = await saveSnapshot(snapshot)
    res.json({ ...snapshot, fileName })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

app.get('/api/history', async (_req, res) => {
  try {
    res.json(await readSnapshots())
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

app.get('/api/history/:id', async (req, res) => {
  try {
    const items = await readSnapshots()
    const item = items.find((entry) => entry.id === req.params.id || entry.file === `${req.params.id}.json`)
    if (!item) {
      res.status(404).json({ message: '未找到历史快照' })
      return
    }
    const content = await fs.readFile(path.join(snapshotsDir, item.file), 'utf8')
    res.json(JSON.parse(content))
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

app.get('/api/old-logs', async (_req, res) => {
  try {
    res.json(await readOldLogs())
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

app.get('/api/local-projects', async (_req, res) => {
  try {
    res.json(await listLocalProjects())
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

app.get('/api/startup-items', async (_req, res) => {
  try {
    res.json(await listStartupItems())
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

app.post('/api/startup-items/toggle', async (req, res) => {
  const item = req.body?.item || {}
  const enabled = Boolean(req.body?.enabled)
  if (!item.manageable) {
    res.status(400).json({ message: item.disabledReason || '该启动项暂不支持在工具内开关。' })
    return
  }
  try {
    res.json(await toggleStartupItem({ ...item, enabled }))
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

app.post('/api/local-projects/stop', async (req, res) => {
  const pids = [...new Set(toArray(req.body?.pids).map(Number).filter((pid) => Number.isInteger(pid)))]
  if (!pids.length || pids.length > 40) {
    res.status(400).json({ message: '需要提供 1 到 40 个 PID。' })
    return
  }

  const stoppable = []
  const stopped = []
  const skipped = []
  const failed = []

  for (const pid of pids) {
    if (pid <= 4) {
      skipped.push({ pid, name: pid === 0 ? 'Idle' : 'System', reason: '系统保护进程，已跳过。' })
      continue
    }

    let processInfo
    try {
      processInfo = await getProcessInfo(pid)
    } catch (error) {
      skipped.push({ pid, name: '', reason: friendlyProcessError(error) })
      continue
    }

    const decision = canStopLocalProjectProcess(processInfo)
    if (!decision.allowed) {
      skipped.push({ pid, name: processInfo.name, reason: decision.reason })
      continue
    }
    stoppable.push(processInfo)
  }

  for (const processInfo of stoppable.sort((a, b) => Number(b.pid) - Number(a.pid))) {
    try {
      await terminateProcess(Number(processInfo.pid))
      stopped.push(processInfo)
    } catch (error) {
      failed.push({ pid: processInfo.pid, name: processInfo.name, reason: friendlyProcessError(error) })
    }
  }

  const details = []
  if (stopped.length) details.push(`已停止 ${stopped.length} 个进程`)
  if (skipped.length) details.push(`跳过 ${skipped.length} 个受保护/已退出进程`)
  if (failed.length) details.push(`${failed.length} 个进程停止失败`)

  res.json({
    ok: stopped.length > 0 && failed.length === 0,
    message: details.length ? `${details.join('，')}。` : '没有可停止的进程。',
    stopped,
    skipped,
    failed
  })
})

app.post('/api/processes/:pid/terminate', async (req, res) => {
  const pid = Number(req.params.pid)
  if (!Number.isInteger(pid) || pid <= 0) {
    res.status(400).json({ message: 'PID 不合法' })
    return
  }

  try {
    const processInfo = await getProcessInfo(pid)
    const decision = canTerminateProcess(processInfo)
    if (!decision.allowed) {
      res.status(403).json({ message: decision.reason, process: processInfo })
      return
    }
    await terminateProcess(pid)
    res.json({ ok: true, message: `已清理 ${processInfo.name} (${pid})`, process: processInfo })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

app.get('/api/open-report-dir', async (_req, res) => {
  try {
    await fs.mkdir(snapshotsDir, { recursive: true })
    await openWindowsPath(snapshotsDir)
    res.json({ ok: true, path: snapshotsDir })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

app.get('/api/disk-check', async (_req, res) => {
  try {
    res.json(await scanDiskCheck())
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

app.post('/api/disk-check/clean', async (req, res) => {
  const id = String(req.body?.id || '')
  const item = cleanItemById.get(id)
  if (!item) {
    res.status(400).json({ message: '不支持的清理项。' })
    return
  }

  try {
    res.json(await runPowerShellJson(cleanDiskItemScript(item), {}))
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

app.post('/api/disk-check/migrate', async (req, res) => {
  const id = String(req.body?.id || '')
  const item = migrationItemById.get(id)
  if (!item) {
    res.status(400).json({ message: '不支持的迁移项。' })
    return
  }

  try {
    res.json(await runPowerShellJson(migrateDiskItemScript(item), {}))
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

app.post('/api/disk-check/open-path', async (req, res) => {
  const targetPath = String(req.body?.path || '')
  if (isRecycleBinShellPath(targetPath)) {
    try {
      await openWindowsPath(targetPath)
      res.json({ ok: true, path: targetPath, displayPath: '回收站' })
    } catch (error) {
      res.status(500).json({ message: error.message })
    }
    return
  }

  if (!isAllowedDiskPath(targetPath)) {
    res.status(400).json({ message: '该路径不在磁盘检查允许打开的范围内。' })
    return
  }

  try {
    let openPath = targetPath
    if (!(await pathExists(openPath))) {
      const parentPath = path.win32.dirname(openPath)
      if (!(await pathExists(parentPath))) {
        res.status(404).json({ message: `目录不存在：${targetPath}` })
        return
      }
      openPath = parentPath
    }
    const stat = await fs.lstat(openPath)
    if (stat.isFile()) openPath = path.win32.dirname(openPath)
    await openWindowsPath(openPath)
    res.json({ ok: true, path: openPath })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

app.use(express.static(path.join(rootDir, 'dist')))

const server = app.listen(port, '127.0.0.1', () => {
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  console.log(`WinStatusInsight API listening on http://127.0.0.1:${actualPort}`)
})

export { app, server, port }
