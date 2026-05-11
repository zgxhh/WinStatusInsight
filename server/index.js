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

function runPowerShellJson(script, fallback = []) {
  return new Promise((resolve, reject) => {
    execFile(
      powershellExe,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
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
  const nodeMatch = text.match(/([A-Z]:\\[^"]*?)\\node_modules\\/i)
  if (nodeMatch) return nodeMatch[1]

  const nextMatch = text.match(/([A-Z]:\\[^"]*?)\\\.next\\/i)
  if (nextMatch) return normalizeDetectedPath(nextMatch[1])

  const outputLogMatch = text.match(/([A-Z]:\\[^"]*?)\\output\\(?:server|logs?)\\[^"]+?\.log/i)
  if (outputLogMatch) return normalizeDetectedPath(outputLogMatch[1])

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
  if (directPath) return directPath

  const parentPid = Number(processInfo.parentProcessId)
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

function buildLocalProjects(processes) {
  const groups = new Map()
  const processesByPid = new Map(processes.map((item) => [Number(item.pid), item]))
  for (const processInfo of processes) {
    const projectPath = inferProjectPath(processInfo, processesByPid)
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
        processes: []
      }

    group.pids.push(Number(processInfo.pid))
    group.memoryBytes += Number(processInfo.workingSet || 0)
    group.protected =
      group.protected ||
      Number(processInfo.pid) === process.pid ||
      normalizePathText(projectPath) === normalizePathText(rootDir) ||
      normalizePathText(processInfo.commandLine).includes(normalizePathText(rootDir))
    for (const port of processInfo.ports || []) group.ports.add(Number(port))
    group.processes.push(processInfo)
    groups.set(key, group)
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      kind: inferProjectKind(group.processes),
      ports: [...group.ports].filter(Boolean).sort((a, b) => a - b),
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
$devCommandPattern = "vite|next|nuxt|webpack|nodemon|ts-node|tsx|server/index.js|dotnet\\s+(watch|run)|dotnet-watch|watch\\.dll|--urls|ASPNETCORE_URLS|ASPNETCORE_ENVIRONMENT"
$processes = Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine -notmatch "Get-CimInstance Win32_Process" -and (
    $_.Name -in @("node.exe", "dotnet.exe", "npm.cmd", "npx.cmd", "pnpm.exe", "pnpm.cmd", "bun.exe") -or
    $_.CommandLine -match $devCommandPattern
  )
}
$runtime = @{}
Get-Process | ForEach-Object { $runtime["$($_.Id)"] = $_ }
$portMap = @{}
netstat -ano -p tcp | Select-String "LISTENING" | ForEach-Object {
  $line = $_.Line
  if ($line -match "^\\s*TCP\\s+\\S+:(\\d+)\\s+\\S+\\s+LISTENING\\s+(\\d+)\\s*$") {
    $pidText = $matches[2]
    if (-not $portMap.ContainsKey($pidText)) { $portMap[$pidText] = @() }
    $portMap[$pidText] += [int]$matches[1]
  }
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

function enrich(raw) {
  const startupItems = toArray(raw.startupItems)
  const services = toArray(raw.services)
  const processes = toArray(raw.processes).map((p) => markProcess(p, startupItems, services))
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

app.post('/api/local-projects/stop', async (req, res) => {
  const pids = [...new Set(toArray(req.body?.pids).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0))]
  if (!pids.length || pids.length > 40) {
    res.status(400).json({ message: '需要提供 1 到 40 个有效 PID。' })
    return
  }

  try {
    const processes = []
    for (const pid of pids) {
      const processInfo = await getProcessInfo(pid)
      const decision = canStopLocalProjectProcess(processInfo)
      if (!decision.allowed) {
        res.status(403).json({ message: decision.reason, process: processInfo })
        return
      }
      processes.push(processInfo)
    }

    for (const processInfo of processes.sort((a, b) => Number(b.pid) - Number(a.pid))) {
      await terminateProcess(Number(processInfo.pid))
    }

    res.json({
      ok: true,
      message: `已停止 ${processes.length} 个本地项目进程。`,
      processes
    })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
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
    execFile('explorer.exe', [snapshotsDir], { windowsHide: true })
    res.json({ ok: true, path: snapshotsDir })
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
