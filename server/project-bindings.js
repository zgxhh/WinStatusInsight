import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { existsSync, createWriteStream, openSync, closeSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const running = new Map()
const START_TIMEOUT_MS = 30 * 1000
const REACHABILITY_TIMEOUT_MS = 1200
const AI_DEFAULT_SETTINGS = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  apiKey: ''
}
const AI_MODEL_OPTIONS = new Set(['deepseek-v4-flash', 'deepseek-v4-pro'])
const FIX_COMMAND_TIMEOUT_MS = 120 * 1000

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

function buildUrls(module, lanEnabled, lanAddresses = [], localUrl = '') {
  const port = Number(module.port || 0)
  if (!port) return []
  const local = localUrl || `http://127.0.0.1:${port}`
  if (!lanEnabled || !module.lanSupported) return [local]
  return [local, ...lanAddresses.map((ip) => `http://${ip}:${port}`)]
}

async function probeHttpUrl(url) {
  if (!url) return { reachable: false, error: '地址为空' }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal
    })
    await response.body?.cancel?.()
    return { reachable: true, url, status: response.status }
  } catch (error) {
    const message = error?.name === 'AbortError' ? '访问超时' : (error?.message || '访问失败')
    return { reachable: false, url, error: message }
  } finally {
    clearTimeout(timeout)
  }
}

async function probeLocalHttpPort(port) {
  const normalizedPort = Number(port || 0)
  if (!normalizedPort) return { reachable: false, urls: [], error: '未识别到端口' }
  const urls = [`http://127.0.0.1:${normalizedPort}`, `http://localhost:${normalizedPort}`]
  const failures = []
  for (const url of urls) {
    const result = await probeHttpUrl(url)
    if (result.reachable) return { reachable: true, url, urls, status: result.status }
    failures.push(`${url} ${result.error}`)
  }
  return {
    reachable: false,
    urls,
    error: `端口 ${normalizedPort} 有进程监听，但本机地址不可访问：${failures.join('；')}`
  }
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

  const processOutput = await execFileText('ps', ['-axo', 'pid=,pgid=,command=']).catch(() => '')
  const commands = new Map()
  const processGroups = new Map()
  for (const line of processOutput.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)
    if (!match) continue
    commands.set(Number(match[1]), match[3])
    processGroups.set(Number(match[1]), Number(match[2]))
  }

  const workingDirectories = new Map()
  await Promise.all([...pidToPorts.keys()].map(async (pid) => {
    const output = await execFileText('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
    const cwd = output.split('\n').find((line) => line.startsWith('n'))?.slice(1)
    if (cwd) workingDirectories.set(pid, cwd)
  }))

  return { portToPids, pidToPorts, commands, processGroups, workingDirectories }
}

function findPortsForModule(module, details) {
  const modulePath = normalizePathText(module.cwd)
  if (!modulePath) return []
  const matches = []
  for (const [pid, ports] of details.pidToPorts.entries()) {
    const command = normalizePathText(details.commands.get(pid) || '')
    const cwd = normalizePathText(details.workingDirectories.get(pid) || '')
    const belongsToModule =
      command.includes(modulePath) ||
      cwd === modulePath ||
      cwd.startsWith(`${modulePath}/`)
    if (!belongsToModule) continue
    for (const port of ports) matches.push({ pid, port })
  }
  return matches.sort((a, b) => a.port - b.port)
}

function killProcessTree(pid, details) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false
  const ownProcessGroup = details.processGroups.get(process.pid)
  const processGroup = details.processGroups.get(pid)
  if (processGroup && processGroup !== ownProcessGroup) {
    try {
      process.kill(-processGroup, 'SIGTERM')
      return true
    } catch {
      // Fall back to the listener process when the group is already gone.
    }
  }
  try {
    process.kill(pid, 'SIGTERM')
    return true
  } catch {
    return false
  }
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

function maskSecret(value = '') {
  const text = String(value || '')
  if (!text) return ''
  if (text.length <= 8) return '********'
  return `${text.slice(0, 4)}...${text.slice(-4)}`
}

function normalizeAiSettings(settings = {}) {
  const baseUrl = String(settings.baseUrl || AI_DEFAULT_SETTINGS.baseUrl).trim().replace(/\/+$/, '')
  const model = AI_MODEL_OPTIONS.has(String(settings.model || ''))
    ? settings.model
    : AI_DEFAULT_SETTINGS.model
  return {
    provider: 'deepseek',
    baseUrl: baseUrl || AI_DEFAULT_SETTINGS.baseUrl,
    model,
    apiKey: String(settings.apiKey || '').trim()
  }
}

function publicAiSettings(settings = {}) {
  const normalized = normalizeAiSettings(settings)
  return {
    provider: normalized.provider,
    baseUrl: normalized.baseUrl,
    model: normalized.model,
    enabled: Boolean(normalized.apiKey),
    maskedKey: maskSecret(normalized.apiKey)
  }
}

function redactSecrets(value = '') {
  return String(value || '')
    .replace(/(authorization\s*:\s*bearer\s+)[^\s"'`,]+/gi, '$1***')
    .replace(/(api[_-]?key|token|password|passwd|secret|access[_-]?key|authorization)\s*[:=]\s*["']?[^"'\s,;]+/gi, '$1=***')
    .replace(/\b(sk|dk)-[a-z0-9_-]{12,}\b/gi, '$1-***')
    .replace(/\b[A-Za-z0-9_/-]{20,}\.[A-Za-z0-9_/-]{20,}\.[A-Za-z0-9_/-]{20,}\b/g, '***.***.***')
}

function safeJson(value) {
  return redactSecrets(JSON.stringify(value || {}, null, 2)).slice(0, 12000)
}

async function readTextIfExists(filePath, maxLength = 12000) {
  try {
    const text = await fs.readFile(filePath, 'utf8')
    return redactSecrets(text).slice(0, maxLength)
  } catch {
    return ''
  }
}

function parseAiJson(content = '') {
  const raw = String(content || '').trim()
  const withoutFence = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    return JSON.parse(withoutFence)
  } catch {
    const start = withoutFence.indexOf('{')
    const end = withoutFence.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(withoutFence.slice(start, end + 1))
    throw new Error('AI 返回内容不是有效 JSON')
  }
}

function normalizeDiagnosis(value = {}) {
  const commands = Array.isArray(value.commands) ? value.commands : Array.isArray(value.fixCommands) ? value.fixCommands : []
  return {
    summary: String(value.summary || value.title || '已完成诊断').slice(0, 300),
    category: String(value.category || value.rootCauseCategory || 'unknown').slice(0, 80),
    rootCause: String(value.rootCause || value.cause || '').slice(0, 600),
    evidence: Array.isArray(value.evidence) ? value.evidence.map((item) => String(item).slice(0, 300)).slice(0, 8) : [],
    commands: commands.map((item, index) => {
      const command = typeof item === 'string' ? item : item.command
      return {
        id: String(item?.id || `cmd-${index + 1}`),
        title: String(item?.title || item?.label || command || '修复命令').slice(0, 80),
        command: String(command || '').trim(),
        cwd: item?.cwd === 'root' ? 'root' : 'module',
        risk: ['low', 'medium', 'high'].includes(item?.risk) ? item.risk : 'medium',
        reason: String(item?.reason || item?.description || '').slice(0, 300)
      }
    }).filter((item) => item.command).slice(0, 6),
    warnings: Array.isArray(value.warnings) ? value.warnings.map((item) => String(item).slice(0, 300)).slice(0, 6) : [],
    requiresConfirmation: true
  }
}

function localDiagnosisHints(context = {}) {
  const text = `${context.lastError || ''}\n${context.latestLog || ''}`.toLowerCase()
  const commands = []
  const evidence = []
  let category = 'unknown'
  let rootCause = ''
  if (/cannot find package ['"]?vite|cannot find module ['"]?vite|vite(\.cmd)?: command not found|sh: vite: command not found|enoent.*vite/.test(text)) {
    category = 'missing_dependency'
    rootCause = '启动日志显示缺少 vite，优先判断为依赖未安装或 node_modules 不完整。'
    evidence.push('日志中出现 vite 缺失相关错误。')
    commands.push({ title: '安装项目依赖', command: 'npm install', cwd: 'module', risk: 'medium', reason: '恢复 node_modules 后再按已有启动脚本启动。' })
  } else if (/cannot find module|module_not_found|cannot find package/.test(text)) {
    category = 'missing_dependency'
    rootCause = '启动日志显示模块缺失，优先检查依赖安装状态。'
    evidence.push('日志中出现 Cannot find module/package。')
    commands.push({ title: '安装项目依赖', command: 'npm install', cwd: 'module', risk: 'medium', reason: '按 lockfile/package.json 安装依赖。' })
  } else if (/eaddrinuse|address already in use/.test(text)) {
    category = 'port_conflict'
    rootCause = '启动日志显示端口被占用。'
    evidence.push('日志中出现 EADDRINUSE/address already in use。')
  } else if (/project\.assets\.json|restore|nuget/.test(text)) {
    category = 'dotnet_restore'
    rootCause = '.NET 项目可能尚未 restore 或 NuGet 包不完整。'
    evidence.push('日志中出现 restore/NuGet/project.assets.json 相关信息。')
    commands.push({ title: '还原 .NET 依赖', command: 'dotnet restore', cwd: 'module', risk: 'medium', reason: '恢复 obj/project.assets.json 和 NuGet 依赖。' })
  }
  if (!commands.length && context.kind === 'node' && !context.nodeModulesExists) {
    category = 'missing_dependency'
    rootCause = '模块目录未检测到 node_modules。'
    evidence.push('模块目录不存在 node_modules。')
    commands.push({ title: '安装项目依赖', command: 'npm install', cwd: 'module', risk: 'medium', reason: '本地依赖缺失时先执行安装。' })
  }
  return normalizeDiagnosis({
    summary: rootCause || '未发现明确根因，建议结合日志继续检查。',
    category,
    rootCause,
    evidence,
    commands,
    warnings: category === 'port_conflict' ? ['端口占用不自动杀进程，请先确认占用来源。'] : []
  })
}

function validateFixCommand(command = '') {
  const parts = splitCommand(command)
  if (!parts.length) throw new Error('命令为空')
  const [bin, sub, third, ...rest] = parts
  const lowerBin = String(bin).toLowerCase()
  const lowerSub = String(sub || '').toLowerCase()
  if (parts.some((part) => /[;&|<>`$]/.test(part))) throw new Error('命令包含不允许的 shell 控制字符')
  if (['sudo', 'rm', 'mv', 'cp', 'curl', 'wget', 'git', 'powershell', 'pwsh', 'bash', 'sh'].includes(lowerBin)) {
    throw new Error('命令不在允许范围')
  }
  if (lowerBin === 'npm') {
    if (lowerSub === 'install' && rest.length === 0 && !third) return parts
    if (lowerSub === 'run' && ['dev', 'start'].includes(String(third || '').toLowerCase()) && rest.length === 0) return parts
  }
  if (lowerBin === 'pnpm' || lowerBin === 'yarn') {
    if (lowerSub === 'install' && !third && rest.length === 0) return parts
  }
  if (lowerBin === 'dotnet' && ['restore', 'build', 'run'].includes(lowerSub) && !third && rest.length === 0) return parts
  throw new Error(`命令不在允许范围：${command}`)
}

function resolveFixCwd(binding, mod, cwdMode) {
  const selected = cwdMode === 'root' ? binding.rootPath : mod.cwd
  const resolved = path.resolve(selected || mod.cwd || binding.rootPath)
  const root = path.resolve(binding.rootPath)
  const moduleDir = path.resolve(mod.cwd || binding.rootPath)
  if (resolved !== root && resolved !== moduleDir) throw new Error('修复命令目录不在项目范围内')
  return resolved
}

async function callDeepSeek(settings, messages) {
  const normalized = normalizeAiSettings(settings)
  if (!normalized.apiKey) throw new Error('请先在设置中配置 DeepSeek API Key')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45 * 1000)
  try {
    const response = await fetch(`${normalized.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${normalized.apiKey}`
      },
      body: JSON.stringify({
        model: normalized.model,
        messages,
        temperature: 0.2,
        response_format: { type: 'json_object' }
      }),
      signal: controller.signal
    })
    const text = await response.text()
    let payload = {}
    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      payload = { raw: text }
    }
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || `DeepSeek 请求失败：HTTP ${response.status}`
      throw new Error(redactSecrets(message))
    }
    const content = payload?.choices?.[0]?.message?.content
    if (!content) throw new Error('DeepSeek 未返回诊断内容')
    return parseAiJson(content)
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('DeepSeek 请求超时，请稍后重试')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function runFixCommand({ command, cwd, logPath }) {
  const parts = validateFixCommand(command)
  await fs.mkdir(path.dirname(logPath), { recursive: true })
  const log = createWriteStream(logPath, { flags: 'a' })
  log.write(`\n\n[${new Date().toISOString()}] AI fix: ${parts.join(' ')}\n`)
  return new Promise((resolve) => {
    const child = spawn(parts[0], parts.slice(1), {
      cwd,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' }
    })
    let output = ''
    const append = (chunk) => {
      const text = String(chunk || '')
      output += text
      if (output.length > 16000) output = output.slice(-16000)
      log.write(text)
    }
    const timer = setTimeout(() => {
      append(`\n[${new Date().toISOString()}] AI fix timeout after ${Math.round(FIX_COMMAND_TIMEOUT_MS / 1000)}s\n`)
      try {
        child.kill('SIGTERM')
      } catch {
        // Process already ended.
      }
    }, FIX_COMMAND_TIMEOUT_MS)
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', (error) => {
      clearTimeout(timer)
      append(`\n[${new Date().toISOString()}] AI fix spawn error ${error.message}\n`)
      log.end()
      resolve({ command: parts.join(' '), cwd, ok: false, code: null, output: redactSecrets(output), error: error.message })
    })
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      const ok = code === 0
      log.write(`\n[${new Date().toISOString()}] AI fix exited code=${code ?? ''} signal=${signal ?? ''}\n`)
      log.end()
      resolve({ command: parts.join(' '), cwd, ok, code, signal, output: redactSecrets(output).slice(-12000) })
    })
  })
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
  const aiSettingsFile = path.join(dataDir, 'ai-settings.json')
  const diagnosisCache = new Map()

  const moduleLogPath = (bindingId, moduleId) => path.join(logsDir, `${bytesSafePath(`${bindingId}:${moduleId}`)}.log`)

  async function readAiSettingsPrivate() {
    return normalizeAiSettings(await readJson(aiSettingsFile, AI_DEFAULT_SETTINGS))
  }

  async function getAiSettings() {
    return publicAiSettings(await readAiSettingsPrivate())
  }

  async function saveAiSettings(input = {}) {
    const current = await readAiSettingsPrivate()
    const nextApiKey = input.clearApiKey ? '' : String(input.apiKey || '').trim() || current.apiKey
    const next = normalizeAiSettings({ ...current, ...input, apiKey: nextApiKey })
    await writeJson(aiSettingsFile, next)
    if (process.platform !== 'win32') await fs.chmod(aiSettingsFile, 0o600)
    return publicAiSettings(next)
  }

  async function testAiSettings(input = {}) {
    const current = await readAiSettingsPrivate()
    const nextApiKey = input.apiKey ? String(input.apiKey).trim() : current.apiKey
    const settings = normalizeAiSettings({ ...current, ...input, apiKey: nextApiKey })
    await callDeepSeek(settings, [
      { role: 'system', content: 'Return compact JSON only.' },
      { role: 'user', content: '{"ok":true,"message":"pong"}' }
    ])
    return { ok: true, message: 'DeepSeek 连接正常', settings: publicAiSettings(settings) }
  }

  async function findBindingAndModule(bindingId, moduleId) {
    const bindings = await readBindings()
    const binding = bindings.find((item) => item.id === bindingId)
    if (!binding) throw new Error('未找到绑定项目')
    const mod = (binding.modules || []).find((item) => item.id === moduleId)
    if (!mod) throw new Error('未找到绑定模块')
    return { binding, mod }
  }

  async function collectDiagnosisContext(binding, mod) {
    const packagePath = path.join(mod.cwd, 'package.json')
    const packageJson = await readJson(packagePath, null)
    const packageText = packageJson ? safeJson({
      name: packageJson.name,
      private: packageJson.private,
      scripts: packageJson.scripts || {},
      dependencies: packageJson.dependencies || {},
      devDependencies: packageJson.devDependencies || {}
    }) : ''
    const csprojFiles = await findFiles(mod.cwd, (name) => name.endsWith('.csproj'), 1)
    const csprojText = csprojFiles[0] ? await readTextIfExists(csprojFiles[0], 8000) : ''
    const lockFiles = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock']
      .filter((name) => existsSync(path.join(mod.cwd, name)))
    const latestLog = await readTextIfExists(moduleLogPath(binding.id, mod.id), 12000)
    const details = await readListeningProcessDetails()
    const configuredPort = Number(mod.port || 0) || null
    const portPids = configuredPort ? details.portToPids.get(configuredPort) || [] : []
    const portConflicts = portPids.map((pid) => ({
      pid,
      command: redactSecrets(details.commands.get(pid) || ''),
      cwd: details.workingDirectories.get(pid) || ''
    }))
    return {
      app: 'WinStatusInsight',
      platform: process.platform,
      bindingName: binding.name,
      rootPath: binding.rootPath,
      moduleId: mod.id,
      moduleName: mod.name,
      moduleType: mod.type,
      moduleCwd: mod.cwd,
      command: mod.command,
      configuredPort,
      status: mod.status,
      lastError: redactSecrets(mod.lastError || ''),
      kind: packageJson ? 'node' : csprojFiles.length ? 'dotnet' : 'unknown',
      nodeModulesExists: existsSync(path.join(mod.cwd, 'node_modules')),
      lockFiles,
      packageJson: packageText,
      csproj: redactSecrets(csprojText),
      configFiles: ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'next.config.js', 'nuxt.config.ts']
        .filter((name) => existsSync(path.join(mod.cwd, name))),
      portConflicts,
      latestLog: redactSecrets(latestLog)
    }
  }

  function buildDiagnosisMessages(context, hints) {
    return [
      {
        role: 'system',
        content: [
          '你是本地开发项目启动失败诊断助手，只输出 JSON。',
          '目标：根据日志和项目元数据判断无法启动的根因，并给出用户确认后可执行的环境/依赖/启动修复命令。',
          '边界：不要修改业务代码、不要写 package.json/配置文件/源码、不要生成补丁、不要建议删除文件、全局安装、sudo、git reset、curl pipe shell 或修改系统环境变量。',
          '允许进入 commands 的命令只能是：npm install、pnpm install、yarn install、npm run dev、npm run start、dotnet restore、dotnet build、dotnet run。',
          '如果根因确实需要改代码，只能写在 warnings 或 rootCause 里作为人工建议，不要放入 commands。',
          '如果日志显示缺 vite/Cannot find module/Cannot find package，优先建议安装本模块依赖，不要先判断业务代码错误。',
          '返回 JSON schema: {"summary":"","category":"","rootCause":"","evidence":[],"commands":[{"title":"","command":"","cwd":"module|root","risk":"low|medium|high","reason":""}],"warnings":[],"requiresConfirmation":true}'
        ].join('\n')
      },
      {
        role: 'user',
        content: safeJson({
          deterministicHints: hints,
          context
        })
      }
    ]
  }

  async function diagnoseModule(bindingId, moduleId) {
    const settings = await readAiSettingsPrivate()
    if (!settings.apiKey) throw new Error('请先在设置中配置 DeepSeek API Key')
    const { binding, mod } = await findBindingAndModule(bindingId, moduleId)
    const context = await collectDiagnosisContext(binding, mod)
    const hints = localDiagnosisHints(context)
    const aiDiagnosis = normalizeDiagnosis(await callDeepSeek(settings, buildDiagnosisMessages(context, hints)))
    const commandKeys = new Set(aiDiagnosis.commands.map((item) => item.command))
    for (const command of hints.commands || []) {
      if (!commandKeys.has(command.command)) aiDiagnosis.commands.unshift(command)
    }
    const executableCommands = []
    const rejectedCommands = []
    for (const command of aiDiagnosis.commands || []) {
      try {
        validateFixCommand(command.command)
        executableCommands.push(command)
      } catch (error) {
        rejectedCommands.push(`${command.command}：${error.message}`)
      }
    }
    aiDiagnosis.commands = executableCommands
    aiDiagnosis.evidence = uniq([...(hints.evidence || []), ...(aiDiagnosis.evidence || [])]).slice(0, 8)
    aiDiagnosis.warnings = uniq([
      ...(hints.warnings || []),
      ...(aiDiagnosis.warnings || []),
      ...rejectedCommands.map((item) => `已拦截超出边界的命令：${item}`)
    ]).slice(0, 8)
    diagnosisCache.set(`${bindingId}:${moduleId}`, {
      expiresAt: Date.now() + 30 * 60 * 1000,
      commands: aiDiagnosis.commands.map((item) => ({
        command: item.command,
        cwd: item.cwd
      }))
    })
    return {
      bindingId,
      moduleId,
      moduleName: mod.name,
      generatedAt: new Date().toISOString(),
      model: settings.model,
      diagnosis: aiDiagnosis,
      contextSummary: {
        status: context.status,
        command: context.command,
        cwd: context.moduleCwd,
        port: context.configuredPort,
        lockFiles: context.lockFiles,
        nodeModulesExists: context.nodeModulesExists
      }
    }
  }

  async function fixModule(bindingId, moduleId, input = {}) {
    const commands = Array.isArray(input.commands) ? input.commands : []
    if (!commands.length) throw new Error('请选择要执行的修复命令')
    const diagnosis = diagnosisCache.get(`${bindingId}:${moduleId}`)
    if (!diagnosis || diagnosis.expiresAt < Date.now()) {
      diagnosisCache.delete(`${bindingId}:${moduleId}`)
      throw new Error('诊断结果已失效，请重新执行 AI 诊断')
    }
    const diagnosedCommands = new Set(
      diagnosis.commands.map((item) => `${item.command}\n${item.cwd}`)
    )
    const { binding, mod } = await findBindingAndModule(bindingId, moduleId)
    const results = []
    for (const item of commands.slice(0, 4)) {
      const command = typeof item === 'string' ? item : item.command
      const cwdMode = typeof item === 'string' ? 'module' : item?.cwd === 'root' ? 'root' : 'module'
      if (!diagnosedCommands.has(`${command}\n${cwdMode}`)) {
        throw new Error('只能执行本次 AI 诊断返回的修复命令')
      }
      const cwd = resolveFixCwd(binding, mod, cwdMode)
      const result = await runFixCommand({ command, cwd, logPath: moduleLogPath(binding.id, mod.id) })
      results.push(result)
      if (!result.ok) break
    }
    diagnosisCache.delete(`${bindingId}:${moduleId}`)
    return {
      ok: results.every((item) => item.ok),
      bindingId,
      moduleId,
      results
    }
  }

  async function readBindings() {
    const items = await readJson(bindingFile, [])
    const listeningDetails = await readListeningProcessDetails()
    return Promise.all(items.map(async (binding) => ({
      ...binding,
      modules: await Promise.all((binding.modules || []).map(async (mod) => {
        const run = running.get(`${binding.id}:${mod.id}`)
        const logPath = run?.logPath || moduleLogPath(binding.id, mod.id)
        const logPort = await readPortFromLog(logPath)
        const logError = await readLastErrorFromLog(logPath)
        const moduleMatches = findPortsForModule(mod, listeningDetails)
        const configuredPort = Number(mod.port || 0) || null
        const configuredPortPids = configuredPort ? listeningDetails.portToPids.get(configuredPort) || [] : []
        const matchedPort = moduleMatches[0]?.port || null
        const loggedPortPids = logPort ? listeningDetails.portToPids.get(Number(logPort)) || [] : []
        const listenerPort =
          matchedPort ||
          (run && configuredPortPids.length ? configuredPort : null) ||
          (run && loggedPortPids.length ? logPort : null)
        const effectivePort = listenerPort || logPort || configuredPort || null
        const portPids = listenerPort ? listeningDetails.portToPids.get(Number(listenerPort)) || [] : []
        const modulePids = moduleMatches.map((item) => item.pid)
        const hasListener = portPids.length > 0 || moduleMatches.length > 0
        const reachability = hasListener && effectivePort
          ? await probeLocalHttpPort(effectivePort)
          : { reachable: false, urls: [], error: '' }
        const runAgeMs = run?.startedAt ? Date.now() - new Date(run.startedAt).getTime() : 0
        const timedOut = Boolean(run && runAgeMs > START_TIMEOUT_MS)
        const timeoutError = timedOut ? `启动超时：${Math.round(runAgeMs / 1000)} 秒内未监听端口，请查看日志。` : ''
        const inaccessibleError = hasListener && !reachability.reachable ? reachability.error : ''
        const status = hasListener && reachability.reachable
          ? 'running'
          : inaccessibleError && (!run || timedOut)
            ? 'error'
            : (logError || timedOut) ? 'error' : run ? 'starting' : hasListener ? 'error' : 'stopped'
        return {
          ...mod,
          port: effectivePort || mod.port,
          status,
          pid: run?.pid || portPids[0] || modulePids[0] || null,
          startedByTool: Boolean(run),
          urls: status === 'running' ? buildUrls({ ...mod, port: effectivePort }, binding.lanEnabled, lanAddresses(), reachability.url) : [],
          lastError: status === 'error' || status === 'stopped' ? (logError || inaccessibleError || timeoutError || mod.lastError || '') : ''
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
      const logPath = moduleLogPath(binding.id, mod.id)
      await fs.appendFile(logPath, `\n\n[${new Date().toISOString()}] ${parts.join(' ')}\n`, 'utf8')
      const outFd = openSync(logPath, 'a')
      const errFd = openSync(logPath, 'a')
      const child = spawn(parts[0], parts.slice(1), {
        cwd: mod.cwd,
        detached: true,
        stdio: ['ignore', outFd, errFd],
        env: { ...process.env, FORCE_COLOR: '0' }
      })
      closeSync(outFd)
      closeSync(errFd)
      child.unref()
      running.set(key, { pid: child.pid, child, logPath, startedAt: new Date().toISOString() })
      child.on('error', (error) => {
        fs.appendFile(logPath, `\n[${new Date().toISOString()}] spawn error ${error.message}\n`, 'utf8').catch(() => {})
        running.delete(key)
      })
      child.on('exit', (code, signal) => {
        fs.appendFile(logPath, `\n[${new Date().toISOString()}] exited code=${code ?? ''} signal=${signal ?? ''}\n`, 'utf8').catch(() => {})
        running.delete(key)
      })
      started.push({ moduleId: mod.id, pid: child.pid, logPath })
    }
    return { ok: true, started, skipped }
  }

  async function stop(id) {
    const bindings = await readJson(bindingFile, [])
    const binding = bindings.find((item) => item.id === id)
    if (!binding) throw new Error('未找到绑定项目')

    const details = await readListeningProcessDetails()
    const stopped = []
    const stoppedProcesses = []

    for (const mod of binding.modules || []) {
      const key = `${id}:${mod.id}`
      const run = running.get(key)
      const moduleMatches = findPortsForModule(mod, details)
      const targetPids = new Set(moduleMatches.map((item) => item.pid))

      if (run?.pid) {
        targetPids.add(run.pid)
        const configuredPort = Number(mod.port || 0)
        if (configuredPort) {
          for (const pid of details.portToPids.get(configuredPort) || []) targetPids.add(pid)
        }
        const logPort = await readPortFromLog(run.logPath)
        if (logPort) {
          for (const pid of details.portToPids.get(logPort) || []) targetPids.add(pid)
        }
      }

      let moduleStopped = false
      for (const pid of targetPids) {
        if (!killProcessTree(pid, details)) continue
        moduleStopped = true
        stoppedProcesses.push({ moduleId: mod.id, pid })
      }

      running.delete(key)
      if (moduleStopped) stopped.push({ key, moduleId: mod.id, pid: run?.pid || [...targetPids][0] || null })
    }
    return { ok: true, stopped, stoppedProcesses }
  }

  async function logs(id) {
    const entries = []
    const bindings = await readBindings()
    const binding = bindings.find((item) => item.id === id)
    if (!binding) throw new Error('未找到绑定项目')
    for (const mod of binding.modules || []) {
      const key = `${binding.id}:${mod.id}`
      const run = running.get(key)
      const logPath = run?.logPath || moduleLogPath(binding.id, mod.id)
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

  return {
    readBindings,
    detect,
    create,
    update,
    remove,
    start,
    stop,
    logs,
    getAiSettings,
    saveAiSettings,
    testAiSettings,
    diagnoseModule,
    fixModule
  }
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
