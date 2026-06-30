import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { existsSync, createWriteStream } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const running = new Map()
const START_TIMEOUT_MS = 30 * 1000

function execFileText(command, args = []) {
  return new Promise((resolve) => {
    execFile(command, args, { maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? '' : String(stdout || ''))
    })
  })
}

function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function bytesSafePath(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64url')
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))]
}

function stripRuntimeModuleFields(module = {}) {
  const {
    status: _status,
    pid: _pid,
    urls: _urls,
    startedByTool: _startedByTool,
    lastError: _lastError,
    ...config
  } = module
  return {
    ...config,
    port: config.port || null,
    lastError: ''
  }
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8')
}

async function findFiles(root, predicate, depth = 2) {
  const results = []
  async function walk(dir, currentDepth) {
    if (currentDepth > depth) return
    let entries = []
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'bin' || entry.name === 'obj') continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isFile() && predicate(entry.name, fullPath)) results.push(fullPath)
      if (entry.isDirectory()) await walk(fullPath, currentDepth + 1)
    }
  }
  await walk(root, 0)
  return results
}

async function readPackageModule(filePath, rootPath) {
  const cwd = path.dirname(filePath)
  const pkg = await readJson(filePath, {})
  const scripts = pkg.scripts || {}
  const devScript = scripts.dev ? 'npm run dev' : scripts.start ? 'npm start' : ''
  if (!devScript) return null
  const rel = path.relative(rootPath, cwd)
  const name = rel && rel !== '.' ? rel.split(path.sep).slice(-1)[0] : (pkg.name || path.basename(rootPath))
  const lower = `${name} ${rel}`.toLowerCase()
  const type = lower.includes('admin') || lower.includes('后台') ? 'admin' : 'web'
  const configText = await readFirstExistingText([
    path.join(cwd, 'vite.config.js'),
    path.join(cwd, 'vite.config.ts'),
    path.join(cwd, 'vite.config.mjs')
  ])
  const port = inferPortFromText(`${scripts.dev || ''}\n${scripts.start || ''}\n${configText}`)
  return {
    id: uid('module'),
    name,
    type,
    cwd,
    command: devScript,
    port,
    enabled: true,
    lanSupported: true,
    status: 'stopped',
    pid: null,
    urls: [],
    lastError: ''
  }
}

function inferPortFromText(text) {
  const portFlag = String(text || '').match(/--port(?:=|\s+)(\d{2,5})/i)
  if (portFlag) return Number(portFlag[1])
  const vitePort = String(text || '').match(/\bport\s*:\s*(\d{2,5})/i)
  if (vitePort) return Number(vitePort[1])
  const urlPort = String(text || '').match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/i)
  if (urlPort) return Number(urlPort[1])
  return null
}

async function readFirstExistingText(files) {
  for (const file of files) {
    try {
      return await fs.readFile(file, 'utf8')
    } catch {
      // Try next candidate.
    }
  }
  return ''
}

async function readDotnetModule(filePath, rootPath) {
  const cwd = path.dirname(filePath)
  const rel = path.relative(rootPath, cwd)
  const name = rel && rel !== '.' ? rel.split(path.sep).slice(-1)[0] : path.basename(filePath, '.csproj')
  const launchSettings = await readJson(path.join(cwd, 'Properties', 'launchSettings.json'), null)
  const launchText = JSON.stringify(launchSettings || {})
  return {
    id: uid('module'),
    name,
    type: 'api',
    cwd,
    command: 'dotnet run',
    port: inferPortFromText(launchText),
    enabled: true,
    lanSupported: false,
    status: 'stopped',
    pid: null,
    urls: [],
    lastError: ''
  }
}

function buildUrls(module, lanEnabled, lanAddresses = []) {
  const port = Number(module.port || 0)
  if (!port) return []
  const local = `http://127.0.0.1:${port}`
  if (!lanEnabled || !module.lanSupported) return [local]
  return [local, ...lanAddresses.map((ip) => `http://${ip}:${port}`)]
}

function normalizePathText(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

async function readListeningPorts() {
  const map = new Map()
  const output = await execFileText('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'])
  for (const line of output.split('\n').slice(1)) {
    const match = line.trim().match(/^\S+\s+(\d+)\s+.*TCP\s+.*:(\d+)\s+\(LISTEN\)$/)
    if (!match) continue
    const pid = Number(match[1])
    const port = Number(match[2])
    if (!pid || !port) continue
    const pids = map.get(port) || []
    if (!pids.includes(pid)) pids.push(pid)
    map.set(port, pids)
  }
  return map
}

async function readListeningProcessDetails() {
  const portToPids = await readListeningPorts()
  const pidToPorts = new Map()
  for (const [port, pids] of portToPids.entries()) {
    for (const pid of pids) {
      const ports = pidToPorts.get(pid) || []
      ports.push(port)
      pidToPorts.set(pid, ports)
    }
  }

  const processOutput = await execFileText('ps', ['-axo', 'pid=,command=']).catch(() => '')
  const commands = new Map()
  for (const line of processOutput.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/)
    if (!match) continue
    commands.set(Number(match[1]), match[2])
  }

  return { portToPids, pidToPorts, commands }
}

function findPortsForModule(module, details) {
  const modulePath = normalizePathText(module.cwd)
  if (!modulePath) return []
  const matches = []
  for (const [pid, ports] of details.pidToPorts.entries()) {
    const command = normalizePathText(details.commands.get(pid) || '')
    if (!command.includes(modulePath)) continue
    for (const port of ports) matches.push({ pid, port })
  }
  return matches.sort((a, b) => a.port - b.port)
}

async function readPortFromLog(logPath) {
  if (!logPath) return null
  try {
    const text = latestLogSession(await fs.readFile(logPath, 'utf8'))
    const matches = [...text.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/gi)]
    const last = matches.at(-1)
    return last ? Number(last[1]) : null
  } catch {
    return null
  }
}

function latestLogSession(text) {
  const value = String(text || '')
  const markers = [...value.matchAll(/\n\n\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s+/g)]
  const marker = markers.at(-1)
  return marker ? value.slice(marker.index) : value
}

async function readLastErrorFromLog(logPath) {
  if (!logPath) return ''
  try {
    const text = latestLogSession(await fs.readFile(logPath, 'utf8'))
    const lines = text.split('\n')
    const errorIndex = lines.findLastIndex((line) =>
      /error when starting|error \[|failed to load|cannot find package|eaddrinuse|enoent/i.test(line)
    )
    if (errorIndex < 0) return ''
    return lines.slice(errorIndex, errorIndex + 4).join('\n').trim().slice(0, 800)
  } catch {
    return ''
  }
}

function splitCommand(command) {
  const parts = String(command || '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
  return parts.map((item) => item.replace(/^['"]|['"]$/g, ''))
}

function commandWithLan(module, lanEnabled) {
  const parts = splitCommand(module.command)
  if (!lanEnabled || !module.lanSupported || module.type === 'api') return parts
  if (parts.some((part) => part === '--host' || part.startsWith('--host='))) return parts
  return [...parts, '--', '--host', '0.0.0.0']
}

async function detectModules(rootPath) {
  const packageFiles = await findFiles(rootPath, (name) => name === 'package.json', 2)
  const csprojFiles = await findFiles(rootPath, (name) => name.endsWith('.csproj'), 3)
  const modules = []
  for (const file of packageFiles) {
    const mod = await readPackageModule(file, rootPath)
    if (mod) modules.push(mod)
  }
  for (const file of csprojFiles) {
    const mod = await readDotnetModule(file, rootPath)
    if (mod) modules.push(mod)
  }
  return modules.sort((a, b) => {
    const order = { web: 1, admin: 2, api: 3 }
    return (order[a.type] || 9) - (order[b.type] || 9) || a.name.localeCompare(b.name)
  })
}

export function createProjectBindingsService({ dataDir, lanAddresses = () => [] }) {
  const bindingFile = path.join(dataDir, 'project-bindings.json')
  const logsDir = path.join(dataDir, 'project-binding-logs')

  async function readBindings() {
    const items = await readJson(bindingFile, [])
    const listeningDetails = await readListeningProcessDetails()
    return Promise.all(items.map(async (binding) => ({
      ...binding,
      modules: await Promise.all((binding.modules || []).map(async (mod) => {
        const run = running.get(`${binding.id}:${mod.id}`)
        const logPath = run?.logPath || path.join(logsDir, `${bytesSafePath(`${binding.id}:${mod.id}`)}.log`)
        const logPort = await readPortFromLog(logPath)
        const logError = await readLastErrorFromLog(logPath)
        const moduleMatches = findPortsForModule(mod, listeningDetails)
        const configuredPort = Number(mod.port || 0) || null
        const configuredPortPids = configuredPort ? listeningDetails.portToPids.get(configuredPort) || [] : []
        const matchedPort = moduleMatches[0]?.port || null
        const loggedPortPids = logPort ? listeningDetails.portToPids.get(Number(logPort)) || [] : []
        const listenerPort = matchedPort || (configuredPortPids.length ? configuredPort : null) || (loggedPortPids.length ? logPort : null)
        const effectivePort = listenerPort || logPort || configuredPort || null
        const portPids = listenerPort ? listeningDetails.portToPids.get(Number(listenerPort)) || [] : []
        const modulePids = moduleMatches.map((item) => item.pid)
        const hasListener = portPids.length > 0 || moduleMatches.length > 0
        const runAgeMs = run?.startedAt ? Date.now() - new Date(run.startedAt).getTime() : 0
        const timedOut = Boolean(run && runAgeMs > START_TIMEOUT_MS)
        const timeoutError = timedOut ? `启动超时：${Math.round(runAgeMs / 1000)} 秒内未监听端口，请查看日志。` : ''
        const status = hasListener ? 'running' : (logError || timedOut) ? 'error' : run ? 'starting' : 'stopped'
        return {
          ...mod,
          port: effectivePort || mod.port,
          status,
          pid: run?.pid || portPids[0] || modulePids[0] || null,
          startedByTool: Boolean(run),
          urls: hasListener ? buildUrls({ ...mod, port: effectivePort }, binding.lanEnabled, lanAddresses()) : [],
          lastError: status === 'error' || status === 'stopped' ? (logError || timeoutError || mod.lastError || '') : ''
        }
      }))
    })))
  }

  async function saveBindings(items) {
    await writeJson(bindingFile, items)
  }

  async function detect(rootPath) {
    const fullPath = path.resolve(String(rootPath || ''))
    if (!existsSync(fullPath)) throw new Error(`项目路径不存在：${fullPath}`)
    const modules = await detectModules(fullPath)
    return {
      id: uid('binding'),
      name: path.basename(fullPath),
      rootPath: fullPath,
      lanEnabled: false,
      modules,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }

  async function create(input) {
    const draft = input.modules?.length ? input : await detect(input.rootPath)
    const items = await readJson(bindingFile, [])
    const binding = {
      id: input.id || draft.id || uid('binding'),
      name: input.name || draft.name || path.basename(draft.rootPath),
      rootPath: path.resolve(input.rootPath || draft.rootPath),
      lanEnabled: Boolean(input.lanEnabled ?? draft.lanEnabled),
      modules: (input.modules || draft.modules || []).map((mod) => ({ ...stripRuntimeModuleFields(mod), id: mod.id || uid('module') })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    items.push(binding)
    await saveBindings(items)
    return binding
  }

  async function update(id, patch) {
    const items = await readJson(bindingFile, [])
    const index = items.findIndex((item) => item.id === id)
    if (index < 0) throw new Error('未找到绑定项目')
    items[index] = {
      ...items[index],
      ...patch,
      id,
      modules: (patch.modules || items[index].modules || []).map(stripRuntimeModuleFields),
      updatedAt: new Date().toISOString()
    }
    await saveBindings(items)
    return items[index]
  }

  async function remove(id) {
    await stop(id)
    const items = await readJson(bindingFile, [])
    await saveBindings(items.filter((item) => item.id !== id))
    return { ok: true }
  }

  async function start(id) {
    const bindings = await readBindings()
    const binding = bindings.find((item) => item.id === id)
    if (!binding) throw new Error('未找到绑定项目')
    await fs.mkdir(logsDir, { recursive: true })
    const started = []
    const skipped = []
    for (const mod of binding.modules.filter((item) => item.enabled)) {
      const key = `${binding.id}:${mod.id}`
      if (mod.status === 'running' || mod.status === 'starting' || running.has(key)) {
        skipped.push({ moduleId: mod.id, status: mod.status || 'starting' })
        continue
      }
      const parts = commandWithLan(mod, binding.lanEnabled)
      if (!parts.length) continue
      const logPath = path.join(logsDir, `${bytesSafePath(key)}.log`)
      const log = createWriteStream(logPath, { flags: 'a' })
      log.write(`\n\n[${new Date().toISOString()}] ${parts.join(' ')}\n`)
      const child = spawn(parts[0], parts.slice(1), {
        cwd: mod.cwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0' }
      })
      child.stdout.pipe(log)
      child.stderr.pipe(log)
      child.unref()
      running.set(key, { pid: child.pid, child, logPath, startedAt: new Date().toISOString() })
      child.on('error', (error) => {
        log.write(`\n[${new Date().toISOString()}] spawn error ${error.message}\n`)
        running.delete(key)
        log.end()
      })
      child.on('exit', (code, signal) => {
        log.write(`\n[${new Date().toISOString()}] exited code=${code ?? ''} signal=${signal ?? ''}\n`)
        running.delete(key)
        log.end()
      })
      started.push({ moduleId: mod.id, pid: child.pid, logPath })
    }
    return { ok: true, started, skipped }
  }

  async function stop(id) {
    const stopped = []
    for (const [key, run] of [...running.entries()]) {
      if (!key.startsWith(`${id}:`)) continue
      try {
        process.kill(-run.pid, 'SIGTERM')
      } catch {
        try {
          process.kill(run.pid, 'SIGTERM')
        } catch {
          // Already gone.
        }
      }
      running.delete(key)
      stopped.push({ key, pid: run.pid })
    }
    return { ok: true, stopped }
  }

  async function logs(id) {
    const entries = []
    const bindings = await readBindings()
    const binding = bindings.find((item) => item.id === id)
    if (!binding) throw new Error('未找到绑定项目')
    for (const mod of binding.modules || []) {
      const key = `${binding.id}:${mod.id}`
      const run = running.get(key)
      const logPath = run?.logPath || path.join(logsDir, `${bytesSafePath(key)}.log`)
      let text = ''
      try {
        text = await fs.readFile(logPath, 'utf8')
      } catch {
        text = ''
      }
      entries.push({ moduleId: mod.id, moduleName: mod.name, log: text.slice(-12000) })
    }
    return { id, entries }
  }

  return { readBindings, detect, create, update, remove, start, stop, logs }
}

export function getLanAddresses() {
  return uniq(
    Object.values(os.networkInterfaces())
      .flat()
      .filter((item) => item && item.family === 'IPv4' && !item.internal)
      .filter((item) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(item.address))
      .map((item) => item.address)
  )
}
