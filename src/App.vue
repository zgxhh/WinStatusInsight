<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, GaugeChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import {
  Activity,
  Bot,
  Database,
  FolderOpen,
  Gauge,
  RefreshCcw,
  Settings,
  ShieldAlert,
  Trash2,
  Wrench
} from 'lucide-vue-next'

use([CanvasRenderer, BarChart, GaugeChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent])

const loading = ref(false)
const snapshot = ref(null)
const history = ref([])
const oldLogs = ref([])
const localProjects = ref([])
const projectBindings = ref([])
const projectBindingLanAddresses = ref([])
const bindingPath = ref('')
const bindingDetecting = ref(false)
const bindingSaving = ref(false)
const bindingLoading = ref(false)
const bindingActionId = ref('')
const bindingLogsVisible = ref(false)
const bindingLogsTitle = ref('')
const bindingLogs = ref([])
const compareIds = ref([])
const compareSnapshots = ref([])
const errorMessage = ref('')
const trend = ref([])
const cleaningPid = ref(null)
const localProjectsLoading = ref(false)
const stoppingProjectId = ref('')
const stoppingAllProjects = ref(false)
const stoppingAllTasks = ref(false)
const diskCheck = ref(null)
const diskLoading = ref(false)
const diskActionLoading = ref('')
const diskPathOpening = ref(false)
const reportDirOpening = ref(false)
const diskLogs = ref([])
const activeTab = ref('resources')
const showSystemItems = ref(true)
const loadingGaugeValue = ref(10)
const scoreAnimating = ref(false)
const settingsVisible = ref(false)
const desktopSettings = ref({ closeToTray: false, localProjectAlertsEnabled: true })
const desktopSettingsLoading = ref(false)
const aiSettings = ref({
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  enabled: false,
  maskedKey: ''
})
const aiApiKeyInput = ref('')
const aiSettingsLoading = ref(false)
const aiSettingsSaving = ref(false)
const aiSettingsTesting = ref(false)
const diagnosisVisible = ref(false)
const diagnosisLoading = ref(false)
const diagnosisFixing = ref(false)
const diagnosisResult = ref(null)
const diagnosisSelectedCommands = ref([])
const diagnosisCurrentBinding = ref(null)
const diagnosisCurrentModule = ref(null)
const diagnosingModuleId = ref('')
const updateChecking = ref(false)
const updateInstalling = ref(false)
const updateInfo = ref(null)
const updateStatus = ref('')
const updateProgress = ref(null)
const resourceSort = ref('impact')
const startupItems = ref([])
const startupLoading = ref(false)
const togglingStartupId = ref('')
const loadedTabs = ref({ background: false, projects: false, tasks: false, disk: false })
let loadingGaugeFrame = null
let settleGaugeFrame = null
let removeUpdateStatusListener = null

const formatBytes = (bytes) => {
  const value = Number(bytes || 0)
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

const formatTime = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

const riskType = (risk) => {
  if (risk === 'high') return 'danger'
  if (risk === 'medium') return 'warning'
  return 'info'
}

const riskLabel = (risk) => {
  if (risk === 'high') return '高占用'
  if (risk === 'medium') return '关注'
  return '正常'
}

const moduleStatusType = (status) => {
  if (status === 'running') return 'success'
  if (status === 'starting') return 'warning'
  if (status === 'error') return 'danger'
  return 'info'
}

const moduleStatusLabel = (status) => {
  if (status === 'running') return '运行中'
  if (status === 'starting') return '启动中'
  if (status === 'error') return '异常'
  return '已停止'
}

const moduleNeedsDiagnosis = (module = {}) =>
  module.status === 'error' ||
  Boolean(module.lastError) ||
  (module.enabled && !Number(module.port || 0) && (!module.urls || module.urls.length === 0))

const diagnosisRiskType = (risk) => {
  if (risk === 'high') return 'danger'
  if (risk === 'low') return 'success'
  return 'warning'
}

const diagnosisRiskLabel = (risk) => {
  if (risk === 'high') return '高风险'
  if (risk === 'low') return '低风险'
  return '需确认'
}

const deltaType = (value, reverse = false) => {
  if (Math.abs(Number(value || 0)) < 0.01) return 'info'
  const worse = reverse ? value < 0 : value > 0
  return worse ? 'warning' : 'success'
}

const cleanableSuggestions = computed(() => (snapshot.value?.suggestions || []).filter((item) => item.cleanable))
const topImpactGroups = computed(() => (snapshot.value?.appGroups || []).slice(0, 4))
const cleanupChartItems = computed(() =>
  [...cleanableSuggestions.value]
    .sort((a, b) => Number(b.memoryGb || 0) - Number(a.memoryGb || 0))
    .slice(0, 3)
)
const reclaimableMemoryGb = computed(() =>
  cleanableSuggestions.value.reduce((total, item) => total + Number(item.memoryGb || 0), 0)
)
const latestSampleClock = computed(() => {
  if (!snapshot.value?.capturedAt) return '--:--:--'
  const date = new Date(snapshot.value.capturedAt)
  return Number.isNaN(date.getTime()) ? '--:--:--' : date.toLocaleTimeString('zh-CN', { hour12: false })
})
const compareA = computed(() => compareSnapshots.value[0] || null)
const compareB = computed(() => compareSnapshots.value[1] || null)
const diskDrives = computed(() => diskCheck.value?.drives || [])
const diskLargeItems = computed(() => diskCheck.value?.largeItems || [])
const diskMigrationItems = computed(() => (diskCheck.value?.items || []).filter((item) => item.type === 'dev-cache'))
const diskCleanItems = computed(() => (diskCheck.value?.items || []).filter((item) => item.type === 'clean'))
const diskAppItems = computed(() => (diskCheck.value?.items || []).filter((item) => item.type === 'app-cache'))
const desktopApi = computed(() => window.winStatusInsight || null)
const updateProgressPercent = computed(() => Math.max(0, Math.min(100, Number(updateProgress.value?.percent || 0))))
const updateProgressText = computed(() => {
  if (!updateProgress.value) return ''
  const percent = Math.round(updateProgressPercent.value)
  const total = updateProgress.value.total ? formatBytes(updateProgress.value.total) : ''
  const speed = updateProgress.value.bytesPerSecond ? `${formatBytes(updateProgress.value.bytesPerSecond)}/s` : ''
  return [percent ? `${percent}%` : '', total, speed].filter(Boolean).join(' · ')
})

const isProtectedRow = (row = {}) =>
  row.cleanupAllowed === false || row.system === true || row.protected === true || row.protectedSystem === true

const sortedRows = (rows = []) => {
  const visibleRows = showSystemItems.value ? [...rows] : rows.filter((row) => !isProtectedRow(row))
  return visibleRows.sort((a, b) => Number(isProtectedRow(a)) - Number(isProtectedRow(b)))
}

const resourceScore = (row) => Number(row.cpuPercent || 0) * 2 + Number(row.workingSetGb || 0) * 10 + Number(row.count || 0) * 0.15
const sortResourceRows = (rows = []) =>
  sortedRows(rows).sort((a, b) => {
    const protectedDelta = Number(isProtectedRow(a)) - Number(isProtectedRow(b))
    if (protectedDelta) return protectedDelta
    if (resourceSort.value === 'cpu') return Number(b.cpuPercent || 0) - Number(a.cpuPercent || 0)
    if (resourceSort.value === 'memory') return Number(b.workingSetGb || 0) - Number(a.workingSetGb || 0)
    return resourceScore(b) - resourceScore(a)
  })

const topCpuRows = computed(() => sortedRows(snapshot.value?.topCpu || []))
const topMemoryRows = computed(() => sortedRows(snapshot.value?.topMemory || []))
const backgroundRows = computed(() => sortedRows(snapshot.value?.background || []))
const appGroupRows = computed(() => sortResourceRows(snapshot.value?.appGroups || []))
const localProjectRows = computed(() => sortedRows(localProjects.value))
const projectBindingRows = computed(() => projectBindings.value || [])
const normalizeLocalPath = (value = '') =>
  String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()

const extractPortFromUrl = (url = '') => {
  const match = String(url || '').match(/:(\d+)(?:\/|$)/)
  return match ? Number(match[1]) : null
}

const boundProjectRoots = computed(() => {
  const roots = []
  for (const binding of projectBindingRows.value) {
    if (binding.rootPath) roots.push(normalizeLocalPath(binding.rootPath))
    for (const module of binding.modules || []) {
      if (module.cwd) roots.push(normalizeLocalPath(module.cwd))
    }
  }
  return roots.filter(Boolean)
})

const boundProjectPorts = computed(() => new Set(
  projectBindingRows.value.flatMap((binding) =>
    (binding.modules || [])
      .map((module) => Number(module.port || 0))
      .filter(Boolean)
  )
))

const projectPorts = (project = {}) => [
  ...(project.ports || []).map((port) => Number(port)),
  ...(project.urls || []).map(extractPortFromUrl)
].filter(Boolean)

const isBoundLocalProject = (project = {}) => {
  const projectPath = normalizeLocalPath(project.projectPath)
  if (projectPath && boundProjectRoots.value.some((root) => projectPath === root || projectPath.startsWith(`${root}/`))) {
    return true
  }
  return projectPorts(project).some((port) => boundProjectPorts.value.has(port))
}

const isOpenableLocalProject = (project = {}) => Boolean(project.projectPath && project.urls?.length)
const unboundLocalProjectRows = computed(() =>
  localProjectRows.value.filter((project) => isOpenableLocalProject(project) && !isBoundLocalProject(project))
)
const runningTaskRows = computed(() =>
  localProjectRows.value.filter((project) => !isBoundLocalProject(project) && !isOpenableLocalProject(project))
)
const stoppableUnboundProjects = computed(() => unboundLocalProjectRows.value.filter((project) => !project.protected))
const stoppableRunningTasks = computed(() => runningTaskRows.value.filter((project) => !project.protected))
const startupRows = computed(() => sortedRows(startupItems.value.map((item) => ({ ...item, protected: !item.manageable }))))
const groupProcessRows = (group) => sortResourceRows(group?.processes || group?.topProcesses || [])
const scoreDisplayValue = computed(() => {
  const value = Number(loadingGaugeValue.value || 0)
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
})
const scoreDisplayLabel = computed(() => (loading.value ? '读取中' : snapshot.value?.analysis?.label || '等待读取'))

const gaugeValue = computed(() => Math.max(0, Math.min(100, Number(loadingGaugeValue.value || 0))))
const gaugeStatusLabel = computed(() => {
  const score = gaugeValue.value
  if (loading.value || scoreAnimating.value) return '读取中'
  if (score >= 85) return '流畅'
  if (score >= 70) return '良好'
  if (score >= 50) return '关注'
  return '卡顿'
})
const gaugeColor = computed(() => {
  const score = gaugeValue.value
  if (loading.value || scoreAnimating.value) return '#24d6a5'
  if (score >= 85) return '#24d6a5'
  if (score >= 70) return '#48d6c4'
  if (score >= 50) return '#f2b84b'
  return '#ff6275'
})
const gaugeStatusColor = computed(() => {
  const score = gaugeValue.value
  if (loading.value || scoreAnimating.value) return '#35f0ca'
  if (score >= 85) return '#35f0ca'
  if (score >= 70) return '#58d7ff'
  if (score >= 50) return '#f2b84b'
  return '#ff6275'
})
const gaugePointer = computed(() => {
  const angle = Math.PI + (gaugeValue.value / 100) * Math.PI
  const centerX = 130
  const centerY = 118
  const length = 62
  return {
    x1: centerX,
    y1: centerY,
    x2: Number((centerX + Math.cos(angle) * length).toFixed(2)),
    y2: Number((centerY + Math.sin(angle) * length).toFixed(2))
  }
})
const gaugeNeedle = computed(() => {
  const angle = Math.PI + (gaugeValue.value / 100) * Math.PI
  const centerX = 130
  const centerY = 118
  const tipLength = 66
  const tailLength = 10
  const halfWidth = 4.8
  const tipX = centerX + Math.cos(angle) * tipLength
  const tipY = centerY + Math.sin(angle) * tipLength
  const tailX = centerX - Math.cos(angle) * tailLength
  const tailY = centerY - Math.sin(angle) * tailLength
  const perpX = Math.cos(angle + Math.PI / 2) * halfWidth
  const perpY = Math.sin(angle + Math.PI / 2) * halfWidth

  return [
    `${tipX.toFixed(2)},${tipY.toFixed(2)}`,
    `${(tailX + perpX).toFixed(2)},${(tailY + perpY).toFixed(2)}`,
    `${(centerX - perpX * 0.5).toFixed(2)},${(centerY - perpY * 0.5).toFixed(2)}`,
    `${(tailX - perpX).toFixed(2)},${(tailY - perpY).toFixed(2)}`
  ].join(' ')
})
const gaugeMinorTicks = computed(() => {
  const centerX = 130
  const centerY = 124
  return Array.from({ length: 41 }, (_, index) => index * 2.5)
    .filter((value) => value % 20 !== 0)
    .map((value) => {
      const angle = Math.PI + (value / 100) * Math.PI
      const tickOuter = value % 10 === 0 ? 94 : 91
      const tickInner = value % 10 === 0 ? 85 : 87
      return {
        value,
        x1: Number((centerX + Math.cos(angle) * tickOuter).toFixed(2)),
        y1: Number((centerY + Math.sin(angle) * tickOuter).toFixed(2)),
        x2: Number((centerX + Math.cos(angle) * tickInner).toFixed(2)),
        y2: Number((centerY + Math.sin(angle) * tickInner).toFixed(2))
      }
    })
})
const gaugeTicks = computed(() => {
  const centerX = 130
  const centerY = 124
  return [0, 20, 40, 60, 80, 100].map((value) => {
    const angle = Math.PI + (value / 100) * Math.PI
    const tickOuter = 97
    const tickInner = 82
    const labelRadius = 66
    return {
      value,
      x1: Number((centerX + Math.cos(angle) * tickOuter).toFixed(2)),
      y1: Number((centerY + Math.sin(angle) * tickOuter).toFixed(2)),
      x2: Number((centerX + Math.cos(angle) * tickInner).toFixed(2)),
      y2: Number((centerY + Math.sin(angle) * tickInner).toFixed(2)),
      labelX: Number((centerX + Math.cos(angle) * labelRadius).toFixed(2)),
      labelY: Number((centerY + Math.sin(angle) * labelRadius).toFixed(2))
    }
  })
})

const ensureTwoCompareIds = async () => {
  if (compareIds.value.length < 2 && history.value.length >= 2) {
    compareIds.value = history.value.slice(0, 2).map((item) => item.id)
  }
  await loadCompareSnapshots()
}

const loadHistory = async () => {
  const [historyResponse, oldLogsResponse] = await Promise.all([fetch('/api/history'), fetch('/api/old-logs')])
  history.value = await historyResponse.json()
  oldLogs.value = await oldLogsResponse.json()
}

const loadCompareSnapshots = async () => {
  const ids = compareIds.value.slice(0, 2)
  compareIds.value = ids
  compareSnapshots.value = []
  if (ids.length < 2) return

  const responses = await Promise.all(ids.map((id) => fetch(`/api/history/${encodeURIComponent(id)}`)))
  const payloads = []
  for (const response of responses) {
    if (response.ok) payloads.push(await response.json())
  }
  compareSnapshots.value = payloads
}

const applySnapshot = (data) => {
  snapshot.value = data
  if (data?.analysis?.score !== undefined) loadingGaugeValue.value = Number(data.analysis.score || 0)
  if (!data?.capturedAt || !data?.system || !data?.analysis) return
  trend.value = [
    {
      time: new Date(data.capturedAt).toLocaleTimeString('zh-CN', { hour12: false }),
      cpu: data.system.cpuPercent,
      memory: data.system.memoryPercent,
      score: data.analysis.score
    }
  ]
}

const restoreLatestSnapshot = async () => {
  if (snapshot.value || !history.value.length) return
  try {
    const latest = history.value[0]
    const response = await fetch(`/api/history/${encodeURIComponent(latest.id)}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || '恢复最近状态失败')
    applySnapshot(data)
  } catch (error) {
    ElMessage.warning(error.message)
  }
}

const loadDesktopSettings = async () => {
  if (!desktopApi.value) return
  try {
    desktopSettings.value = { closeToTray: false, localProjectAlertsEnabled: true, ...(await desktopApi.value.getSettings()) }
  } catch (error) {
    ElMessage.error(error.message)
  }
}

const loadStartupItems = async () => {
  startupLoading.value = true
  try {
    const response = await fetch('/api/startup-items')
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '读取自启动项失败')
    startupItems.value = result
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    startupLoading.value = false
  }
}

const toggleStartupItem = async (row, enabled) => {
  if (!row.manageable) {
    row.enabled = !enabled
    ElMessage.warning(row.disabledReason || '该启动项暂不支持在工具内开关')
    return
  }
  togglingStartupId.value = row.id
  try {
    const response = await fetch('/api/startup-items/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: row, enabled })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '切换自启动失败')
    ElMessage.success(`${row.displayName || row.name} 已${enabled ? '开启' : '关闭'}开机自启动`)
    await loadStartupItems()
  } catch (error) {
    row.enabled = !enabled
    ElMessage.error(error.message)
  } finally {
    togglingStartupId.value = ''
  }
}

const updateCloseToTray = async (value) => {
  if (!desktopApi.value) {
    desktopSettings.value.closeToTray = false
    ElMessage.info('这个设置只在桌面应用中生效')
    return
  }
  desktopSettingsLoading.value = true
  try {
    desktopSettings.value = await desktopApi.value.updateSettings({ closeToTray: value })
    ElMessage.success(value ? '已开启：关闭窗口时最小化到托盘' : '已关闭：关闭窗口时直接退出')
  } catch (error) {
    desktopSettings.value.closeToTray = !value
    ElMessage.error(error.message)
  } finally {
    desktopSettingsLoading.value = false
  }
}

const updateLocalProjectAlerts = async (value) => {
  if (!desktopApi.value) {
    desktopSettings.value.localProjectAlertsEnabled = false
    ElMessage.info('这个设置只在桌面应用中生效')
    return
  }
  desktopSettingsLoading.value = true
  try {
    desktopSettings.value = await desktopApi.value.updateSettings({ localProjectAlertsEnabled: value })
    ElMessage.success(value ? '已开启：本地项目占用时托盘提醒' : '已关闭：本地项目托盘提醒')
  } catch (error) {
    desktopSettings.value.localProjectAlertsEnabled = !value
    ElMessage.error(error.message)
  } finally {
    desktopSettingsLoading.value = false
  }
}

const loadAiSettings = async () => {
  aiSettingsLoading.value = true
  try {
    const response = await fetch('/api/ai-settings')
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '读取 AI 设置失败')
    aiSettings.value = { ...aiSettings.value, ...result }
    aiApiKeyInput.value = ''
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    aiSettingsLoading.value = false
  }
}

const saveAiSettings = async () => {
  aiSettingsSaving.value = true
  try {
    const response = await fetch('/api/ai-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: aiSettings.value.baseUrl,
        model: aiSettings.value.model,
        apiKey: aiApiKeyInput.value.trim()
      })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '保存 AI 设置失败')
    aiSettings.value = { ...aiSettings.value, ...result }
    aiApiKeyInput.value = ''
    ElMessage.success('AI 诊断配置已保存')
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    aiSettingsSaving.value = false
  }
}

const testAiSettings = async () => {
  aiSettingsTesting.value = true
  try {
    const response = await fetch('/api/ai-settings/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: aiSettings.value.baseUrl,
        model: aiSettings.value.model,
        apiKey: aiApiKeyInput.value.trim()
      })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || 'DeepSeek 连接测试失败')
    ElMessage.success(result.message || 'DeepSeek 连接正常')
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    aiSettingsTesting.value = false
  }
}

const ensureTabData = (tabName) => {
  if (tabName === 'background' && !loadedTabs.value.background) {
    loadedTabs.value.background = true
    loadStartupItems()
  }
  if ((tabName === 'projects' || tabName === 'tasks') && !loadedTabs.value[tabName]) {
    loadedTabs.value.projects = true
    loadedTabs.value.tasks = true
    loadProjectBindings()
    loadLocalProjects()
  }
  if (tabName === 'disk' && !loadedTabs.value.disk) {
    loadedTabs.value.disk = true
    loadDiskCheck()
  }
}

const checkForUpdates = async () => {
  if (!desktopApi.value?.checkForUpdates) {
    ElMessage.info('版本更新只在桌面应用中可用')
    return
  }
  updateChecking.value = true
  updateStatus.value = '正在检查新版本...'
  updateProgress.value = null
  try {
    updateInfo.value = await desktopApi.value.checkForUpdates()
    updateStatus.value = updateInfo.value.message || (updateInfo.value.hasUpdate ? `发现新版本 ${updateInfo.value.latestVersion}` : '已是最新版本')
    ElMessage.success(updateStatus.value)
  } catch (error) {
    updateStatus.value = error.message
    ElMessage.error(error.message)
  } finally {
    updateChecking.value = false
  }
}

const downloadAndInstallUpdate = async () => {
  if (!desktopApi.value?.downloadAndInstallUpdate) return
  updateInstalling.value = true
  updateStatus.value = '正在准备下载更新，下载完成后会自动重启安装。'
  updateProgress.value = null
  try {
    const result = await desktopApi.value.downloadAndInstallUpdate()
    updateStatus.value = result.message || '更新正在下载，完成后将自动重启安装。'
    ElMessage.success(updateStatus.value)
  } catch (error) {
    updateStatus.value = error.message
    ElMessage.error(error.message)
  }
}

const handleUpdateStatus = (payload = {}) => {
  if (payload.info) {
    const hasUpdate = payload.type === 'available'
      ? true
      : payload.type === 'not-available'
        ? false
        : Boolean(updateInfo.value?.hasUpdate)
    updateInfo.value = { ...updateInfo.value, ...payload.info, hasUpdate }
  }
  if (payload.message) updateStatus.value = payload.message
  if (payload.progress) updateProgress.value = payload.progress
  if (payload.type === 'available') {
    updateInstalling.value = false
    updateChecking.value = false
  }
  if (payload.type === 'not-available') {
    updateInstalling.value = false
    updateChecking.value = false
    updateProgress.value = null
  }
  if (payload.type === 'download-started' || payload.type === 'progress') {
    updateInstalling.value = true
  }
  if (payload.type === 'downloaded') {
    updateInstalling.value = true
    updateProgress.value = { ...(updateProgress.value || {}), percent: 100 }
  }
  if (payload.type === 'error') {
    updateInstalling.value = false
    updateChecking.value = false
    ElMessage.error(payload.message || '更新失败')
  }
}

const startLoadingGauge = () => {
  stopLoadingGauge()
  if (settleGaugeFrame) {
    window.cancelAnimationFrame(settleGaugeFrame)
    settleGaugeFrame = null
  }
  scoreAnimating.value = true
  const startValue = Math.max(22, Math.min(92, Number(loadingGaugeValue.value || snapshot.value?.analysis?.score || 52)))
  const startedAt = performance.now()
  let displayed = startValue
  const easeOutCubic = (value) => 1 - Math.pow(1 - value, 3)
  const easeInOut = (value) => (value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2)
  const throttleSweep = (phase) => {
    if (phase < 0.34) return 38 + easeOutCubic(phase / 0.34) * 56
    if (phase < 0.56) return 94 - easeInOut((phase - 0.34) / 0.22) * 28
    if (phase < 0.84) return 66 + easeOutCubic((phase - 0.56) / 0.28) * 30
    return 96 - easeInOut((phase - 0.84) / 0.16) * 14
  }
  const tick = (now) => {
    const elapsed = now - startedAt
    const phase = (elapsed % 1350) / 1350
    const target = throttleSweep(phase) + Math.sin(elapsed / 180) * 1.6
    displayed += (target - displayed) * 0.22
    loadingGaugeValue.value = Math.max(24, Math.min(98, Number(displayed.toFixed(1))))
    loadingGaugeFrame = window.requestAnimationFrame(tick)
  }
  loadingGaugeFrame = window.requestAnimationFrame(tick)
}

const stopLoadingGauge = () => {
  if (!loadingGaugeFrame) return
  window.cancelAnimationFrame(loadingGaugeFrame)
  loadingGaugeFrame = null
}

const settleGaugeToScore = (finalScore) =>
  new Promise((resolve) => {
    stopLoadingGauge()
    const target = Number(finalScore || 0)
    const start = Number(loadingGaugeValue.value || 0)
    const duration = 720
    const startedAt = performance.now()
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration)
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2
      loadingGaugeValue.value = Math.max(0, Math.min(100, Number((start + (target - start) * eased).toFixed(1))))
      if (progress < 1) {
        settleGaugeFrame = window.requestAnimationFrame(tick)
        return
      }
      loadingGaugeValue.value = target
      scoreAnimating.value = false
      settleGaugeFrame = null
      resolve()
    }
    settleGaugeFrame = window.requestAnimationFrame(tick)
  })

const readStatus = async () => {
  loading.value = true
  startLoadingGauge()
  errorMessage.value = ''
  try {
    const response = await fetch('/api/status')
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || '读取状态失败')
    snapshot.value = data
    trend.value = [
      ...trend.value,
      {
        time: new Date(data.capturedAt).toLocaleTimeString('zh-CN', { hour12: false }),
        cpu: data.system.cpuPercent,
        memory: data.system.memoryPercent,
        score: data.analysis.score
      }
    ].slice(-12)
    await settleGaugeToScore(data.analysis.score)
    loadHistory().then(async () => {
      compareIds.value = history.value.slice(0, 2).map((item) => item.id)
      await loadCompareSnapshots()
    })
  } catch (error) {
    errorMessage.value = error.message
    if (snapshot.value?.analysis?.score !== undefined) loadingGaugeValue.value = Number(snapshot.value.analysis.score || 0)
    scoreAnimating.value = false
  } finally {
    stopLoadingGauge()
    loading.value = false
  }
}

const openReportDir = async () => {
  if (reportDirOpening.value) return
  reportDirOpening.value = true
  try {
    const response = await fetch('/api/open-report-dir')
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '打开报告目录失败')
    ElMessage.success(`已打开报告目录：${result.path}`)
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    window.setTimeout(() => {
      reportDirOpening.value = false
    }, 900)
  }
}

const loadLocalProjects = async () => {
  localProjectsLoading.value = true
  try {
    const response = await fetch('/api/local-projects')
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '读取本地项目失败')
    localProjects.value = result
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    localProjectsLoading.value = false
  }
}

const addDiskLog = (level, text) => {
  diskLogs.value = [{ time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), level, text }, ...diskLogs.value].slice(0, 12)
}

const loadDiskCheck = async () => {
  diskLoading.value = true
  try {
    const response = await fetch('/api/disk-check')
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '磁盘检查失败')
    diskCheck.value = result
    addDiskLog('info', '磁盘占用扫描完成')
  } catch (error) {
    addDiskLog('danger', error.message)
    ElMessage.error(error.message)
  } finally {
    diskLoading.value = false
  }
}

const openDiskPath = async (targetPath) => {
  if (diskPathOpening.value) return
  diskPathOpening.value = true
  try {
    const response = await fetch('/api/disk-check/open-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetPath })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '打开目录失败')
    ElMessage.success(`已打开：${result.displayPath || result.path}`)
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    window.setTimeout(() => {
      diskPathOpening.value = false
    }, 900)
  }
}

const loadProjectBindings = async () => {
  bindingLoading.value = true
  try {
    const response = await fetch('/api/project-bindings')
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '读取绑定项目失败')
    projectBindings.value = result.items || []
    projectBindingLanAddresses.value = result.lanAddresses || []
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    bindingLoading.value = false
  }
}

const selectProjectFolder = async () => {
  try {
    let selectedPath = ''
    if (desktopApi.value?.selectProjectFolder) {
      selectedPath = await desktopApi.value.selectProjectFolder()
    } else {
      const response = await fetch('/api/project-bindings/select-folder', { method: 'POST' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || '选择文件夹失败')
      selectedPath = result.path || ''
    }
    if (selectedPath) bindingPath.value = selectedPath
  } catch (error) {
    ElMessage.error(error.message || '选择文件夹失败')
  }
}

const addProjectBinding = async () => {
  if (!bindingPath.value.trim()) {
    ElMessage.warning('请先选择项目根目录')
    return
  }
  bindingDetecting.value = true
  bindingSaving.value = true
  try {
    const detectResponse = await fetch('/api/project-bindings/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootPath: bindingPath.value.trim() })
    })
    const detected = await detectResponse.json()
    if (!detectResponse.ok) throw new Error(detected.message || '自动识别失败')
    const saveResponse = await fetch('/api/project-bindings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(detected)
    })
    const saved = await saveResponse.json()
    if (!saveResponse.ok) throw new Error(saved.message || '保存绑定失败')
    bindingPath.value = ''
    ElMessage.success(`已绑定项目：${saved.name}`)
    await loadProjectBindings()
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    bindingDetecting.value = false
    bindingSaving.value = false
  }
}

const updateProjectBinding = async (binding) => {
  bindingActionId.value = binding.id
  try {
    const response = await fetch(`/api/project-bindings/${binding.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(binding)
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '保存配置失败')
    await loadProjectBindings()
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    bindingActionId.value = ''
  }
}

const startProjectBinding = async (binding) => {
  bindingActionId.value = binding.id
  try {
    await updateProjectBinding(binding)
    const response = await fetch(`/api/project-bindings/${binding.id}/start`, { method: 'POST' })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '启动失败')
    ElMessage.success(result.started?.length ? `已启动 ${result.started.length} 个模块` : '模块已经在运行')
    await loadProjectBindings()
    await waitForProjectBindingSettled(binding.id)
    await loadLocalProjects()
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    bindingActionId.value = ''
  }
}

const waitForProjectBindingSettled = async (bindingId) => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const binding = projectBindingRows.value.find((item) => item.id === bindingId)
    const modules = binding?.modules || []
    if (modules.length && modules.every((module) => module.status !== 'starting')) return
    await delay(900)
    await loadProjectBindings()
  }
}

const stopProjectBinding = async (binding) => {
  bindingActionId.value = binding.id
  try {
    const response = await fetch(`/api/project-bindings/${binding.id}/stop`, { method: 'POST' })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '停止失败')
    ElMessage.success(result.stopped?.length ? `已停止 ${result.stopped.length} 个模块` : '没有运行中的模块')
    await loadProjectBindings()
    await loadLocalProjects()
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    bindingActionId.value = ''
  }
}

const deleteProjectBinding = async (binding) => {
  bindingActionId.value = binding.id
  try {
    const response = await fetch(`/api/project-bindings/${binding.id}`, { method: 'DELETE' })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '删除失败')
    ElMessage.success('已删除绑定')
    await loadProjectBindings()
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    bindingActionId.value = ''
  }
}

const showProjectBindingLogs = async (binding) => {
  bindingActionId.value = binding.id
  try {
    const response = await fetch(`/api/project-bindings/${binding.id}/logs`)
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '读取日志失败')
    bindingLogsTitle.value = `${binding.name} 日志`
    bindingLogs.value = result.entries || []
    bindingLogsVisible.value = true
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    bindingActionId.value = ''
  }
}

const diagnoseProjectModule = async (binding, module) => {
  diagnosisVisible.value = true
  diagnosisLoading.value = true
  diagnosisResult.value = null
  diagnosisSelectedCommands.value = []
  diagnosisCurrentBinding.value = binding
  diagnosisCurrentModule.value = module
  diagnosingModuleId.value = module.id
  try {
    const response = await fetch(`/api/project-bindings/${binding.id}/modules/${module.id}/diagnose`, {
      method: 'POST'
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || 'AI 诊断失败')
    diagnosisResult.value = result
    diagnosisSelectedCommands.value = (result.diagnosis?.commands || []).map((item) => item.command)
  } catch (error) {
    ElMessage.error(error.message)
    if (/api key/i.test(error.message) || error.message.includes('API Key')) settingsVisible.value = true
  } finally {
    diagnosisLoading.value = false
    diagnosingModuleId.value = ''
  }
}

const executeDiagnosisFix = async () => {
  const binding = diagnosisCurrentBinding.value
  const module = diagnosisCurrentModule.value
  const commands = (diagnosisResult.value?.diagnosis?.commands || [])
    .filter((item) => diagnosisSelectedCommands.value.includes(item.command))
  if (!binding || !module || !commands.length) {
    ElMessage.warning('请先选择要执行的修复命令')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将按顺序执行 ${commands.length} 条修复命令，执行目录固定在项目范围内。执行完成后会重新启动该绑定项目。`,
      '确认执行 AI 修复',
      { confirmButtonText: '执行', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  diagnosisFixing.value = true
  try {
    const response = await fetch(`/api/project-bindings/${binding.id}/modules/${module.id}/fix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '执行修复失败')
    diagnosisResult.value = { ...diagnosisResult.value, fixResult: result }
    if (!result.ok) throw new Error('部分修复命令执行失败，请查看执行输出或日志。')
    ElMessage.success('修复命令执行完成，正在重新启动项目')
    await startProjectBinding(binding)
    await showProjectBindingLogs(binding)
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    diagnosisFixing.value = false
  }
}

const cleanDiskItem = async (item) => {
  if (item.operation !== 'clean') return
  diskActionLoading.value = item.id
  try {
    const response = await fetch('/api/disk-check/clean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '清理失败')
    addDiskLog('success', `${item.label}：${result.message || '已完成'}，释放约 ${formatBytes(result.freedBytes || 0)}`)
    ElMessage.success(result.message || '清理完成')
    await loadDiskCheck()
  } catch (error) {
    addDiskLog('danger', `${item.label}：${error.message}`)
    ElMessage.error(error.message)
  } finally {
    diskActionLoading.value = ''
  }
}

const migrateDiskItem = async (item) => {
  if (item.operation !== 'migrate') return
  diskActionLoading.value = item.id
  try {
    const response = await fetch('/api/disk-check/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '迁移失败')
    addDiskLog('success', `${item.label}：${result.message || '已完成'}，目标 ${result.target || item.target}`)
    ElMessage.success(result.message || '迁移完成')
    await loadDiskCheck()
  } catch (error) {
    addDiskLog('danger', `${item.label}：${error.message}`)
    ElMessage.error(error.message)
  } finally {
    diskActionLoading.value = ''
  }
}

const rowClassName = ({ row }) => (isProtectedRow(row) ? 'protected-row' : '')

const cleanupItemFromRow = (row) => ({
  pid: row.pid,
  processName: row.name || row.processName,
  cleanable: row.cleanupAllowed ?? row.cleanable,
  cleanupDisabledReason: row.cleanupDisabledReason,
  path: row.path
})

const showStopResult = (result) => {
  const skipped = result.skipped?.length || 0
  const failed = result.failed?.length || 0
  if (skipped || failed) ElMessage.warning(result.message || `已处理，跳过 ${skipped + failed} 个进程`)
  else ElMessage.success(result.message || '已停止项目')
}

const cleanupProcess = async (item) => {
  if (!item.cleanable) return
  cleaningPid.value = item.pid
  try {
    const response = await fetch(`/api/processes/${item.pid}/terminate`, { method: 'POST' })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '清理失败')
    ElMessage.success(result.message || '已清理')
    await readStatus()
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    cleaningPid.value = null
  }
}

const stopLocalProject = async (project) => {
  if (project.protected) return
  stoppingProjectId.value = project.id
  try {
    const response = await fetch('/api/local-projects/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pids: project.pids })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '停止项目失败')
    showStopResult(result)
    await loadLocalProjects()
    await readStatus()
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    stoppingProjectId.value = ''
  }
}

const stopAllLocalProjects = async (projects = stoppableUnboundProjects.value) => {
  if (!projects.length) return
  const pids = projects.flatMap((project) => project.pids)
  stoppingAllProjects.value = true
  try {
    const response = await fetch('/api/local-projects/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pids })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '全部停止失败')
    showStopResult(result)
    await loadLocalProjects()
    await readStatus()
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    stoppingAllProjects.value = false
  }
}

const stopAllRunningTasks = async () => {
  const projects = stoppableRunningTasks.value
  if (!projects.length) return
  const pids = projects.flatMap((project) => project.pids)
  stoppingAllTasks.value = true
  try {
    const response = await fetch('/api/local-projects/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pids })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '停止运行任务失败')
    showStopResult(result)
    await loadLocalProjects()
    await readStatus()
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    stoppingAllTasks.value = false
  }
}

const scoreOption = computed(() => {
  const score = loadingGaugeValue.value
  const label = loading.value ? '读取中' : snapshot.value?.analysis?.label || '等待读取'
  const energyColor = score >= 85 ? '#24d6a5' : score >= 70 ? '#48d6c4' : score >= 50 ? '#f2b84b' : '#ff6275'
  return {
    series: [
      {
        type: 'gauge',
        min: 0,
        max: 100,
        radius: '74%',
        center: ['50%', '54%'],
        animation: false,
        animationDurationUpdate: 0,
        animationEasingUpdate: 'linear',
        progress: {
          show: true,
          width: 13,
          roundCap: true,
          itemStyle: {
            color: loading.value || scoreAnimating.value
              ? '#24d6a5'
              : energyColor,
            shadowBlur: loading.value ? 14 : 6,
            shadowColor: loading.value ? 'rgba(36, 214, 165, 0.5)' : 'rgba(36, 214, 165, 0.24)'
          }
        },
        axisLine: { lineStyle: { width: 13, color: [[1, '#263647']] } },
        axisTick: { show: false },
        splitLine: { distance: -13, length: 6, lineStyle: { color: '#607080' } },
        axisLabel: { show: false },
        pointer: {
          width: loading.value ? 6 : 5,
          itemStyle: { color: loading.value ? '#6da4ff' : '#5c7df0' }
        },
        detail: { show: false },
        title: { show: false },
        data: [{ value: score }]
      }
    ]
  }
})

const trendOption = computed(() => ({
  tooltip: {
    trigger: 'axis',
    backgroundColor: 'rgba(5, 17, 27, 0.96)',
    borderColor: '#1f6076',
    textStyle: { color: '#d9e9f3' }
  },
  legend: {
    textStyle: { color: '#9bb0c0', fontSize: 11 },
    itemWidth: 20,
    itemHeight: 8,
    top: 0
  },
  grid: { left: 40, right: 18, top: 38, bottom: 26 },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: trend.value.map((item) => item.time),
    axisLine: { lineStyle: { color: '#385064' } },
    axisTick: { show: false },
    axisLabel: { color: '#8298aa', fontSize: 10, hideOverlap: true }
  },
  yAxis: {
    type: 'value',
    min: 0,
    max: 100,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: '#8298aa', fontSize: 10 },
    splitLine: { lineStyle: { color: 'rgba(76, 116, 143, 0.28)', type: 'dashed' } }
  },
  series: [
    {
      name: 'CPU',
      type: 'line',
      smooth: 0.35,
      symbol: 'circle',
      symbolSize: 5,
      showSymbol: trend.value.length <= 1,
      data: trend.value.map((item) => item.cpu),
      lineStyle: { width: 2, color: '#45aaff' },
      itemStyle: { color: '#45aaff', borderColor: '#d7efff', borderWidth: 1 }
    },
    {
      name: '内存',
      type: 'line',
      smooth: 0.35,
      symbol: 'circle',
      symbolSize: 5,
      showSymbol: trend.value.length <= 1,
      data: trend.value.map((item) => item.memory),
      lineStyle: { width: 2, color: '#58d3ae' },
      itemStyle: { color: '#58d3ae', borderColor: '#d9fff2', borderWidth: 1 }
    },
    {
      name: '评分',
      type: 'line',
      smooth: 0.35,
      symbol: 'circle',
      symbolSize: 5,
      showSymbol: trend.value.length <= 1,
      data: trend.value.map((item) => item.score),
      lineStyle: { width: 2, color: '#ff626c' },
      itemStyle: { color: '#ff626c', borderColor: '#fff1f2', borderWidth: 1 }
    }
  ]
}))

const pressureRows = computed(() => {
  const system = snapshot.value?.system || {}
  const topProcess = topImpactGroups.value[0]
  const totalMemoryGb = Number(system.memoryTotal || 0) / 1024 ** 3
  const processPressure = topProcess
    ? Math.min(100, Math.max(
      Number(topProcess.cpuPercent || 0),
      totalMemoryGb ? (Number(topProcess.workingSetGb || 0) / totalMemoryGb) * 100 : 0
    ))
    : 0
  return [
    { name: 'CPU', value: Number(system.cpuPercent || 0), display: `${Number(system.cpuPercent || 0).toFixed(2)}%`, color: '#45aaff' },
    { name: '内存', value: Number(system.memoryPercent || 0), display: `${Number(system.memoryPercent || 0).toFixed(2)}%`, color: '#ff626c' },
    {
      name: '进程压力',
      value: processPressure,
      display: topProcess ? `${topProcess.name} (${Number(topProcess.workingSetGb || 0).toFixed(2)}GB)` : '暂无',
      color: '#f3a62f'
    }
  ]
})

const pressureOption = computed(() => ({
  animationDuration: 480,
  grid: { left: 70, right: 112, top: 8, bottom: 24 },
  xAxis: {
    type: 'value',
    min: 0,
    max: 100,
    interval: 50,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: '#70889a', fontSize: 9, formatter: '{value}%' },
    splitLine: { lineStyle: { color: 'rgba(93, 128, 151, 0.22)', type: 'dashed' } }
  },
  yAxis: {
    type: 'category',
    inverse: true,
    data: pressureRows.value.map((item) => item.name),
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: '#d8e5ee', fontSize: 12, fontWeight: 700 }
  },
  tooltip: {
    trigger: 'item',
    backgroundColor: 'rgba(5, 17, 27, 0.96)',
    borderColor: '#1f6076',
    textStyle: { color: '#d9e9f3' },
    formatter: (params) => `${params.name}<br>${params.data.display}`
  },
  series: [
    {
      type: 'bar',
      barWidth: 12,
      showBackground: true,
      backgroundStyle: {
        color: '#142536',
        borderColor: '#31485a',
        borderWidth: 1,
        borderRadius: 6
      },
      itemStyle: { borderRadius: 6 },
      label: {
        show: true,
        position: 'right',
        distance: 12,
        color: '#dce9f2',
        fontSize: 11,
        fontWeight: 700,
        formatter: (params) => params.data.display
      },
      data: pressureRows.value.map((item) => ({
        value: item.value,
        display: item.display,
        itemStyle: {
          color: item.color,
          shadowBlur: item.name === '内存' && item.value >= 90 ? 10 : 0,
          shadowColor: item.color
        }
      }))
    }
  ]
}))

const cleanupCapacityOption = computed(() => {
  const system = snapshot.value?.system || {}
  const totalMemoryGb = Number(system.memoryTotal || 0) / 1024 ** 3
  const reclaimable = reclaimableMemoryGb.value
  const ratio = totalMemoryGb ? Math.min(100, (reclaimable / totalMemoryGb) * 100) : 0
  return {
    animationDuration: 520,
    tooltip: { show: false },
    series: [
      {
        type: 'pie',
        radius: ['69%', '82%'],
        center: ['50%', '52%'],
        silent: true,
        label: { show: false },
        data: [
          { value: ratio, itemStyle: { color: '#48c9df', shadowBlur: 10, shadowColor: 'rgba(72, 201, 223, 0.4)' } },
          { value: 100 - ratio, itemStyle: { color: '#1a3140' } }
        ]
      }
    ]
  }
})

const cleanupOption = computed(() => {
  const colors = ['#ff626c', '#f3a62f', '#58c7a5']
  const items = cleanupChartItems.value
  return {
    animationDuration: 520,
    grid: { left: 86, right: 58, top: 6, bottom: 12 },
    xAxis: {
      type: 'value',
      min: 0,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false }
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: items.map((item) => item.processName || '未命名'),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#dce8f1', fontSize: 11, width: 76, overflow: 'truncate' }
    },
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(5, 17, 27, 0.96)',
      borderColor: '#1f6076',
      textStyle: { color: '#d9e9f3' },
      formatter: (params) => `${params.name}<br>可释放 ${Number(params.value).toFixed(2)} GB<br>点击清理该进程`
    },
    series: [
      {
        type: 'bar',
        barWidth: 16,
        showBackground: true,
        backgroundStyle: { color: '#142536', borderRadius: 2 },
        itemStyle: { borderRadius: 2 },
        label: {
          show: true,
          position: 'right',
          color: '#f2f7fa',
          fontSize: 11,
          fontWeight: 700,
          formatter: ({ value }) => `${Number(value).toFixed(2)}GB`
        },
        data: items.map((item, index) => ({
          value: Number(item.memoryGb || 0),
          itemStyle: { color: colors[index] || '#58c7a5' }
        }))
      }
    ]
  }
})

const resourceOption = computed(() => {
  const system = snapshot.value?.system || {}
  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(5, 17, 27, 0.96)',
      borderColor: '#1f6076',
      textStyle: { color: '#d9e9f3' }
    },
    legend: {
      orient: 'vertical',
      left: 8,
      top: 'middle',
      icon: 'circle',
      itemWidth: 9,
      itemHeight: 9,
      itemGap: 18,
      textStyle: { color: '#9db1c0', fontSize: 11 }
    },
    series: [
      {
        type: 'pie',
        center: ['67%', '49%'],
        radius: ['49%', '70%'],
        startAngle: 90,
        label: { color: '#c9d6e2', fontSize: 10, formatter: '{b}\n{d}%' },
        labelLine: { length: 10, length2: 20, lineStyle: { color: '#4c7187' } },
        data: [
          { name: '内存已用', value: system.memoryUsed || 0, itemStyle: { color: '#65d4ae' } },
          { name: '内存空闲', value: system.memoryFree || 0, itemStyle: { color: '#395164' } }
        ]
      }
    ]
  }
})

const handleCleanupChartClick = (params) => {
  const item = cleanupChartItems.value[params.dataIndex]
  if (item) cleanupProcess(item)
}

const cleanupTopSuggestion = () => {
  const item = cleanupChartItems.value[0]
  if (item) cleanupProcess(item)
}

const compareRows = computed(() => {
  if (!compareA.value || !compareB.value) return []
  const first = compareA.value
  const second = compareB.value
  return [
    { name: '流畅评分', current: first.analysis?.score, previous: second.analysis?.score, delta: (first.analysis?.score || 0) - (second.analysis?.score || 0), unit: '分', reverse: true },
    { name: 'CPU', current: first.system?.cpuPercent, previous: second.system?.cpuPercent, delta: (first.system?.cpuPercent || 0) - (second.system?.cpuPercent || 0), unit: '%' },
    { name: '内存', current: first.system?.memoryPercent, previous: second.system?.memoryPercent, delta: (first.system?.memoryPercent || 0) - (second.system?.memoryPercent || 0), unit: '%' }
  ]
})

const aggregateProcesses = (processes = []) => {
  const map = new Map()
  for (const process of processes) {
    const name = process.name || 'unknown'
    const key = name.toLowerCase()
    const current = map.get(key) || { name, cpu: 0, memory: 0, count: 0, risk: process.risk || 'low', tags: new Set(), cleanable: false }
    current.cpu += Number(process.cpuPercent || 0)
    current.memory += Number(process.workingSet || 0)
    current.count += 1
    current.cleanable = current.cleanable || Boolean(process.cleanupAllowed)
    if (process.risk === 'high' || (process.risk === 'medium' && current.risk !== 'high')) current.risk = process.risk
    for (const tag of process.tags || []) current.tags.add(tag)
    map.set(key, current)
  }
  return map
}

const compareImpactRows = computed(() => {
  if (!compareA.value || !compareB.value) return []
  const firstMap = aggregateProcesses(compareA.value.processes)
  const secondMap = aggregateProcesses(compareB.value.processes)
  const keys = new Set([...firstMap.keys(), ...secondMap.keys()])
  return [...keys]
    .map((key) => {
      const first = firstMap.get(key) || { name: key, cpu: 0, memory: 0, count: 0, risk: 'low', tags: new Set(), cleanable: false }
      const second = secondMap.get(key) || { name: first.name, cpu: 0, memory: 0, count: 0, risk: 'low', tags: new Set(), cleanable: false }
      const cpuDelta = first.cpu - second.cpu
      const memoryDelta = first.memory - second.memory
      const impact = Math.max(first.cpu, 0) * 2 + Math.max(memoryDelta / 1024 / 1024 / 1024, 0) * 12 + Math.max(first.memory / 1024 / 1024 / 1024, 0)
      return {
        name: first.name || second.name,
        currentCpu: Number(first.cpu.toFixed(2)),
        previousCpu: Number(second.cpu.toFixed(2)),
        cpuDelta: Number(cpuDelta.toFixed(2)),
        currentMemoryGb: Number((first.memory / 1024 / 1024 / 1024).toFixed(2)),
        previousMemoryGb: Number((second.memory / 1024 / 1024 / 1024).toFixed(2)),
        memoryDeltaGb: Number((memoryDelta / 1024 / 1024 / 1024).toFixed(2)),
        currentCount: first.count,
        previousCount: second.count,
        countDelta: first.count - second.count,
        risk: first.risk,
        tags: [...first.tags].slice(0, 4),
        cleanable: first.cleanable,
        impact
      }
    })
    .filter((row) => !row.tags.includes('系统进程'))
    .filter((row) => row.currentCpu >= 0.5 || row.currentMemoryGb >= 0.25 || row.cpuDelta >= 0.3 || row.memoryDeltaGb >= 0.08)
    .sort((a, b) => b.impact - a.impact)
})

const mainImpactRows = computed(() => compareImpactRows.value.slice(0, 6))

const compareAnalysis = computed(() => {
  if (!compareA.value || !compareB.value) return null
  const scoreDelta = (compareA.value.analysis?.score || 0) - (compareB.value.analysis?.score || 0)
  const cpuDelta = (compareA.value.system?.cpuPercent || 0) - (compareB.value.system?.cpuPercent || 0)
  const memoryDelta = (compareA.value.system?.memoryPercent || 0) - (compareB.value.system?.memoryPercent || 0)
  const heavier = compareImpactRows.value
    .filter((row) => row.cpuDelta > 0.3 || row.memoryDeltaGb > 0.08)
    .sort((a, b) => b.cpuDelta * 2 + b.memoryDeltaGb * 12 - (a.cpuDelta * 2 + a.memoryDeltaGb * 12))
    .slice(0, 6)
  const lighter = compareImpactRows.value
    .filter((row) => row.cpuDelta < -0.3 || row.memoryDeltaGb < -0.08)
    .sort((a, b) => a.cpuDelta * 2 + a.memoryDeltaGb * 12 - (b.cpuDelta * 2 + b.memoryDeltaGb * 12))
    .slice(0, 4)
  const resource = Math.abs(cpuDelta) >= Math.abs(memoryDelta) ? 'CPU' : '内存'
  const direction = scoreDelta < -3 || cpuDelta > 5 || memoryDelta > 5 ? '变重' : scoreDelta > 3 || cpuDelta < -5 || memoryDelta < -5 ? '变轻' : '接近'
  const leader = heavier[0]
  const summary =
    direction === '变重'
      ? `读取 A 比读取 B 压力更高，主要变化在 ${resource}${leader ? `，最明显的是 ${leader.name}` : ''}。`
      : direction === '变轻'
        ? `读取 A 比读取 B 更轻，系统压力有下降。`
        : `两次读取整体接近，没有明显变重的应用。`

  return {
    summary,
    scoreDelta: Number(scoreDelta.toFixed(1)),
    cpuDelta: Number(cpuDelta.toFixed(1)),
    memoryDelta: Number(memoryDelta.toFixed(1)),
    heavier,
    lighter
  }
})

onMounted(async () => {
  await Promise.all([loadHistory(), loadDesktopSettings(), loadAiSettings()])
  removeUpdateStatusListener = desktopApi.value?.onUpdateStatus?.(handleUpdateStatus) || null
  desktopApi.value?.onNavigateTab?.((tabName) => {
    activeTab.value = tabName
  })
  await restoreLatestSnapshot()
  await ensureTwoCompareIds()
  ensureTabData(activeTab.value)
})

watch(activeTab, (tabName) => {
  ensureTabData(tabName)
})

onBeforeUnmount(() => {
  stopLoadingGauge()
  if (settleGaugeFrame) window.cancelAnimationFrame(settleGaugeFrame)
  if (removeUpdateStatusListener) removeUpdateStatusListener()
})
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="topbar-ornament" aria-hidden="true">
        <span class="ornament-corner ornament-corner-left"></span>
        <span class="ornament-corner ornament-corner-right"></span>
        <span class="ornament-segment ornament-left"></span>
        <span class="ornament-node ornament-node-left"></span>
        <span class="ornament-bridge ornament-bridge-left"></span>
        <span class="ornament-spine"></span>
        <span class="ornament-bridge ornament-bridge-right"></span>
        <span class="ornament-segment ornament-center"></span>
        <span class="ornament-node ornament-node-right"></span>
        <span class="ornament-segment ornament-right"></span>
      </div>
      <section>
        <div class="eyebrow">LOCAL SYSTEM OBSERVER</div>
        <h1>WinStatusInsight</h1>
      </section>
      <div class="system-status" aria-label="系统采样状态">
        <span><i></i>系统运行</span>
        <b>{{ latestSampleClock }}</b>
        <span class="status-divider"></span>
        <span>采样间隔</span>
        <b>2s</b>
      </div>
      <nav class="actions command-bar">
        <el-button class="command-button command-primary" :loading="loading" @click="readStatus">
          <Activity class="command-primary-icon" :size="18" />
          <span class="command-primary-label">读取状态</span>
          <span class="command-flow-dots" aria-hidden="true"></span>
        </el-button>
        <el-button class="command-button" :loading="reportDirOpening" :disabled="reportDirOpening" @click="openReportDir">
          <FolderOpen :size="17" />
          打开报告目录
        </el-button>
        <el-button class="command-button command-icon" circle title="设置" @click="settingsVisible = true">
          <Settings :size="17" />
        </el-button>
      </nav>
    </header>

    <el-dialog v-model="settingsVisible" title="设置" width="560px" align-center>
      <div class="settings-list">
        <div class="settings-row">
          <div>
            <strong>关闭时最小化到托盘</strong>
            <span>开启后点击窗口 X 不会退出，可从系统托盘恢复或退出。</span>
          </div>
          <el-switch
            v-model="desktopSettings.closeToTray"
            :loading="desktopSettingsLoading"
            @change="updateCloseToTray"
          />
        </div>
        <div class="settings-row">
          <div>
            <strong>本地项目占用提醒</strong>
            <span>检测到本地开发项目长时间占用资源时，通过托盘提醒打开项目页或一键停止。</span>
          </div>
          <el-switch
            v-model="desktopSettings.localProjectAlertsEnabled"
            :loading="desktopSettingsLoading"
            @change="updateLocalProjectAlerts"
          />
        </div>
        <div class="settings-row ai-settings-row">
          <div class="ai-settings-copy">
            <strong>AI 本地项目诊断</strong>
            <span>
              使用 DeepSeek 分析启动日志和项目依赖，只执行环境安装、restore/build/run 和已有启动脚本，不自动修改代码。Key 只保存在本机，当前状态：
              {{ aiSettings.enabled ? `已配置 ${aiSettings.maskedKey}` : '未配置' }}
            </span>
            <div class="ai-settings-form">
              <el-input v-model="aiApiKeyInput" type="password" show-password placeholder="DeepSeek API Key，留空则保留已保存密钥" />
              <el-input v-model="aiSettings.baseUrl" placeholder="https://api.deepseek.com" />
              <el-select v-model="aiSettings.model" placeholder="选择模型">
                <el-option label="deepseek-v4-flash" value="deepseek-v4-flash" />
                <el-option label="deepseek-v4-pro" value="deepseek-v4-pro" />
              </el-select>
            </div>
          </div>
          <div class="settings-actions">
            <el-button class="settings-button" size="small" :loading="aiSettingsLoading" @click="loadAiSettings">刷新</el-button>
            <el-button class="settings-button" size="small" :loading="aiSettingsTesting" @click="testAiSettings">测试</el-button>
            <el-button class="settings-button primary" size="small" :loading="aiSettingsSaving" @click="saveAiSettings">保存</el-button>
          </div>
        </div>
        <div class="settings-row update-row">
          <div>
            <strong>检查版本更新</strong>
            <span v-if="updateInfo">
              当前 {{ updateInfo.currentVersion }}，最新 {{ updateInfo.latestVersion }}。
              {{ updateInfo.hasUpdate ? '点击“下载并自动安装”后，完成下载会自动重启应用安装。' : '已是最新版本。' }}
            </span>
            <span v-else>手动联网检查 GitHub Release；发现新版后使用差量更新，下载完成自动重启安装。</span>
            <span v-if="updateStatus" class="update-status-text">{{ updateStatus }}</span>
            <el-progress
              v-if="updateProgress"
              class="update-progress"
              :percentage="updateProgressPercent"
              :show-text="false"
              :stroke-width="8"
            />
            <span v-if="updateProgressText" class="update-status-text">{{ updateProgressText }}</span>
          </div>
          <div class="settings-actions">
            <el-button class="settings-button" size="small" :loading="updateChecking" @click="checkForUpdates">检查</el-button>
            <el-button
              v-if="updateInfo?.hasUpdate"
              class="settings-button primary"
              size="small"
              :loading="updateInstalling"
              @click="downloadAndInstallUpdate"
            >
              下载并自动安装
            </el-button>
          </div>
        </div>
      </div>
    </el-dialog>

    <el-dialog v-model="bindingLogsVisible" :title="bindingLogsTitle" width="760px" align-center>
      <div class="binding-log-list">
        <section v-for="entry in bindingLogs" :key="entry.moduleId" class="binding-log-entry">
          <strong>{{ entry.moduleName }}</strong>
          <pre>{{ entry.log || '暂无日志' }}</pre>
        </section>
      </div>
    </el-dialog>

    <el-dialog
      v-model="diagnosisVisible"
      :title="diagnosisCurrentModule ? `${diagnosisCurrentModule.name} AI 诊断` : 'AI 诊断'"
      width="760px"
      align-center
    >
      <div v-loading="diagnosisLoading" class="diagnosis-panel">
        <template v-if="diagnosisResult?.diagnosis">
          <section class="diagnosis-summary">
            <el-tag :type="diagnosisRiskType(diagnosisResult.diagnosis.commands?.[0]?.risk)">
              {{ diagnosisResult.diagnosis.category || 'unknown' }}
            </el-tag>
            <strong>{{ diagnosisResult.diagnosis.summary }}</strong>
            <p>{{ diagnosisResult.diagnosis.rootCause || 'AI 未给出明确根因，请结合日志继续检查。' }}</p>
          </section>

          <section v-if="diagnosisResult.diagnosis.evidence?.length" class="diagnosis-section">
            <h3>判断依据</h3>
            <ul>
              <li v-for="item in diagnosisResult.diagnosis.evidence" :key="item">{{ item }}</li>
            </ul>
          </section>

          <section v-if="diagnosisResult.diagnosis.commands?.length" class="diagnosis-section">
            <h3>可确认执行的环境修复命令</h3>
            <el-checkbox-group v-model="diagnosisSelectedCommands" class="diagnosis-command-list">
              <label v-for="command in diagnosisResult.diagnosis.commands" :key="command.id" class="diagnosis-command">
                <el-checkbox :label="command.command" />
                <div>
                  <strong>{{ command.title }}</strong>
                  <code>{{ command.command }}</code>
                  <span>{{ command.cwd === 'root' ? '项目根目录' : '模块目录' }} · {{ diagnosisRiskLabel(command.risk) }} · {{ command.reason }}</span>
                </div>
              </label>
            </el-checkbox-group>
          </section>

          <section v-if="diagnosisResult.diagnosis.warnings?.length" class="diagnosis-section">
            <h3>注意事项</h3>
            <ul>
              <li v-for="item in diagnosisResult.diagnosis.warnings" :key="item">{{ item }}</li>
            </ul>
          </section>

          <section v-if="diagnosisResult.fixResult" class="diagnosis-section">
            <h3>执行结果</h3>
            <div v-for="item in diagnosisResult.fixResult.results" :key="`${item.command}-${item.code}`" class="diagnosis-output">
              <strong>{{ item.ok ? '完成' : '失败' }}：{{ item.command }}</strong>
              <pre>{{ item.output || item.error || '无输出' }}</pre>
            </div>
          </section>
        </template>
        <el-empty v-else-if="!diagnosisLoading" description="暂无诊断结果" :image-size="72" />
      </div>
      <template #footer>
        <el-button @click="diagnosisVisible = false">关闭</el-button>
        <el-button
          type="primary"
          :disabled="!diagnosisResult?.diagnosis?.commands?.length || !diagnosisSelectedCommands.length"
          :loading="diagnosisFixing"
          @click="executeDiagnosisFix"
        >
          <Wrench :size="14" />
          执行选中修复
        </el-button>
      </template>
    </el-dialog>

    <el-alert v-if="errorMessage" class="alert" type="error" :title="errorMessage" show-icon />

    <section class="hero-grid">
      <article class="panel score-panel">
        <div class="panel-title">
          <Gauge :size="18" />
          当前流畅评分
        </div>
        <div class="score-visual">
          <svg class="score-gauge" viewBox="0 0 260 174" role="img" aria-label="当前流畅评分仪表盘">
            <defs>
              <linearGradient id="gaugeEnergyGradient" x1="27" y1="128" x2="233" y2="128" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#24d6a5" />
                <stop offset="52%" stop-color="#2fe4bc" />
                <stop offset="100%" stop-color="#35f0ca" />
              </linearGradient>
              <linearGradient id="gaugeNeedleGradient" x1="114" y1="118" x2="198" y2="118" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#315bd9" stop-opacity="0.72" />
                <stop offset="64%" stop-color="#5f80ff" stop-opacity="0.96" />
                <stop offset="100%" stop-color="#88a8ff" stop-opacity="0.92" />
              </linearGradient>
              <filter id="gaugeGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="gaugeSoftGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="2.2" result="softBlur" />
                <feMerge>
                  <feMergeNode in="softBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <radialGradient id="gaugeCoreGradient" cx="50%" cy="62%" r="58%">
                <stop offset="0%" stop-color="#07131d" stop-opacity="0.96" />
                <stop offset="62%" stop-color="#07131d" stop-opacity="0.74" />
                <stop offset="100%" stop-color="#0c2637" stop-opacity="0.34" />
              </radialGradient>
            </defs>
            <circle class="gauge-scan-ring" cx="130" cy="124" r="119" />
            <circle class="gauge-orbit" cx="130" cy="124" r="112" />
            <path class="gauge-scan-arc" d="M 14 128 A 116 116 0 0 1 246 128" pathLength="100" />
            <circle class="gauge-face" cx="130" cy="124" r="78" />
            <path class="gauge-outer-track" d="M 18 128 A 112 112 0 0 1 242 128" pathLength="100" />
            <path class="gauge-zone gauge-zone-low" d="M 27 128 A 103 103 0 0 1 233 128" pathLength="100" />
            <path class="gauge-zone gauge-zone-mid" d="M 27 128 A 103 103 0 0 1 233 128" pathLength="100" />
            <path class="gauge-zone gauge-zone-high" d="M 27 128 A 103 103 0 0 1 233 128" pathLength="100" />
            <path class="gauge-track" d="M 27 128 A 103 103 0 0 1 233 128" pathLength="100" />
            <path class="gauge-inner-track" d="M 40 128 A 90 90 0 0 1 220 128" pathLength="100" />
            <path
              class="gauge-energy"
              d="M 27 128 A 103 103 0 0 1 233 128"
              pathLength="100"
              :stroke="loading || scoreAnimating || gaugeValue >= 70 ? 'url(#gaugeEnergyGradient)' : gaugeColor"
              :stroke-dasharray="`${gaugeValue} 100`"
            />
            <g class="gauge-terminals">
              <circle cx="27" cy="128" r="3.2" />
              <circle cx="233" cy="128" r="3.2" />
            </g>
            <g class="gauge-minor-ticks">
              <line
                v-for="tick in gaugeMinorTicks"
                :key="tick.value"
                :x1="tick.x1"
                :y1="tick.y1"
                :x2="tick.x2"
                :y2="tick.y2"
              />
            </g>
            <g class="gauge-ticks">
              <g v-for="tick in gaugeTicks" :key="tick.value">
                <line :x1="tick.x1" :y1="tick.y1" :x2="tick.x2" :y2="tick.y2" />
                <text :x="tick.labelX" :y="tick.labelY">{{ tick.value }}</text>
              </g>
            </g>
            <polygon class="gauge-needle" :points="gaugeNeedle" />
            <circle class="gauge-hub-outer" cx="130" cy="118" r="8.5" />
            <circle class="gauge-hub" cx="130" cy="118" r="5" />
            <circle class="gauge-hub-core" cx="130" cy="118" r="2.2" />
            <line
              class="gauge-pointer"
              :class="{ active: loading || scoreAnimating }"
              :x1="gaugePointer.x1"
              :y1="gaugePointer.y1"
              :x2="gaugePointer.x2"
              :y2="gaugePointer.y2"
            />
            <rect class="gauge-score-badge" x="104" y="128" width="52" height="22" rx="5" />
            <g class="gauge-score-text">
              <text class="gauge-score-value" x="130" y="105">{{ scoreDisplayValue }}</text>
              <text class="gauge-score-label" x="130" y="142" :fill="gaugeStatusColor">{{ gaugeStatusLabel }}</text>
            </g>
          </svg>
        </div>
        <div class="timestamp">最近采样：{{ formatTime(snapshot?.capturedAt) }}</div>
      </article>

      <article class="panel trend-panel">
        <div class="panel-title">
          <RefreshCcw :size="18" />
          资源趋势
        </div>
        <VChart class="trend-chart" :option="trendOption" autoresize />
      </article>

      <article class="panel side-panel">
        <div class="panel-title">
          <ShieldAlert :size="18" />
          当前瓶颈
        </div>
        <VChart v-if="snapshot" class="pressure-chart" :option="pressureOption" autoresize />
        <el-empty v-else description="点击读取状态开始分析" :image-size="84" />
        <div v-if="snapshot" class="pressure-legend">
          <span><i class="normal"></i>正常</span>
          <span><i class="warning"></i>注意</span>
          <span><i class="danger"></i>严重</span>
        </div>
      </article>
    </section>

    <section class="content-grid">
      <article class="panel suggestions">
        <div class="panel-title">
          <Database :size="18" />
          建议清理
        </div>
        <div v-if="snapshot && cleanupChartItems.length" class="cleanup-dashboard">
          <div class="cleanup-capacity">
            <VChart class="cleanup-capacity-chart" :option="cleanupCapacityOption" autoresize />
            <div class="cleanup-capacity-value">
              <small>可释放</small>
              <strong>{{ reclaimableMemoryGb.toFixed(2) }} GB</strong>
            </div>
            <span>占用总量 {{ ((reclaimableMemoryGb / (snapshot.system.memoryTotal / 1024 ** 3)) * 100).toFixed(2) }}%</span>
          </div>
          <div class="cleanup-ranking">
            <div class="cleanup-heading">
              <span>清理机会</span>
              <small>按可释放容量排序</small>
            </div>
            <VChart class="cleanup-chart" :option="cleanupOption" autoresize @click="handleCleanupChartClick" />
            <div class="cleanup-footer">
              <div>
                <span><i class="high"></i>高优先级</span>
                <span><i class="medium"></i>中优先级</span>
                <span><i class="low"></i>低优先级</span>
              </div>
              <el-button
                size="small"
                :loading="cleaningPid === cleanupChartItems[0]?.pid"
                @click="cleanupTopSuggestion"
              >
                <Trash2 :size="14" />
                清理首项
              </el-button>
            </div>
          </div>
        </div>
        <el-empty v-else :description="snapshot ? '暂无推荐清理项' : '暂无建议'" :image-size="76" />
      </article>

      <article class="panel memory-panel">
        <div class="panel-title">
          <Database :size="18" />
          内存结构
        </div>
        <VChart class="memory-chart" :option="resourceOption" autoresize />
        <div v-if="snapshot" class="memory-caption">
          已用 {{ formatBytes(snapshot.system.memoryUsed) }} / 总计 {{ formatBytes(snapshot.system.memoryTotal) }}
        </div>
      </article>
    </section>

    <section class="panel table-panel">
      <div class="table-toolbar">
        <el-switch v-model="showSystemItems" size="small" />
        <span>显示系统项</span>
      </div>
      <el-tabs v-model="activeTab">
        <el-tab-pane label="资源占用" name="resources">
          <div class="resource-toolbar">
            <div class="resource-toolbar-copy">
              <strong>应用整体与进程明细</strong>
              <span>先看哪个应用整体占用高，展开后再处理具体 PID。</span>
            </div>
            <el-select
              v-model="resourceSort"
              class="resource-sort-select"
              popper-class="resource-sort-popper"
              size="small"
              aria-label="资源排序"
            >
              <el-option label="综合影响" value="impact" />
              <el-option label="CPU 优先" value="cpu" />
              <el-option label="内存优先" value="memory" />
            </el-select>
          </div>
          <el-table :data="appGroupRows" height="390" stripe row-key="name" :row-class-name="rowClassName">
            <el-table-column type="expand" width="44">
              <template #default="{ row }">
                <div class="process-detail">
                  <div class="process-detail-title">{{ row.name }} 的进程明细</div>
                  <el-table :data="groupProcessRows(row)" size="small" stripe>
                    <el-table-column prop="name" label="进程" min-width="140" />
                    <el-table-column prop="pid" label="PID" width="90" />
                    <el-table-column prop="cpuPercent" label="CPU %" width="95" />
                    <el-table-column label="内存" width="110">
                      <template #default="{ row: processRow }">{{ processRow.workingSetGb }} GB</template>
                    </el-table-column>
                    <el-table-column label="风险" width="100">
                      <template #default="{ row: processRow }">
                        <el-tag :type="riskType(processRow.risk)">{{ riskLabel(processRow.risk) }}</el-tag>
                      </template>
                    </el-table-column>
                    <el-table-column prop="path" label="路径" min-width="260" show-overflow-tooltip />
                    <el-table-column label="控制" width="100" fixed="right">
                      <template #default="{ row: processRow }">
                        <el-button
                          v-if="processRow.cleanupAllowed"
                          size="small"
                          type="danger"
                          :loading="cleaningPid === processRow.pid"
                          @click="cleanupProcess(cleanupItemFromRow(processRow))"
                        >
                          清理
                        </el-button>
                      </template>
                    </el-table-column>
                  </el-table>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="name" label="应用/组件" min-width="150" sortable />
            <el-table-column prop="count" label="进程数" width="95" sortable />
            <el-table-column prop="cpuPercent" label="CPU %" width="105" sortable />
            <el-table-column label="内存" width="115" sortable>
              <template #default="{ row }">{{ row.workingSetGb }} GB</template>
            </el-table-column>
            <el-table-column label="风险" width="110">
              <template #default="{ row }"><el-tag :type="riskType(row.risk)">{{ riskLabel(row.risk) }}</el-tag></template>
            </el-table-column>
            <el-table-column label="主要进程" min-width="260" show-overflow-tooltip>
              <template #default="{ row }">
                {{ (row.topProcesses || []).map((item) => `${item.name}(${item.pid})`).join('、') }}
              </template>
            </el-table-column>
            <el-table-column prop="suggestion" label="建议" min-width="300" show-overflow-tooltip />
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="自启动管理" name="background">
          <div class="projects-toolbar">
            <span>开机自启动应用 {{ startupRows.length }} 个</span>
            <el-button size="small" :loading="startupLoading" @click="loadStartupItems">
              <RefreshCcw :size="14" />
              刷新
            </el-button>
          </div>
          <el-table :data="startupRows" height="390" stripe :row-class-name="rowClassName">
            <el-table-column prop="displayName" label="应用名称（中文名）" min-width="220" sortable>
              <template #default="{ row }">
                <div class="startup-name">
                  <strong>{{ row.displayName || row.name }}</strong>
                  <small v-if="row.name && row.name !== row.displayName">{{ row.name }}</small>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="开机自启动" width="140">
              <template #default="{ row }">
                <el-switch
                  v-model="row.enabled"
                  :disabled="!row.manageable"
                  :loading="togglingStartupId === row.id"
                  @change="(value) => toggleStartupItem(row, value)"
                />
              </template>
            </el-table-column>
            <el-table-column prop="description" label="应用作用简介" min-width="360" show-overflow-tooltip />
            <el-table-column prop="scope" label="来源" width="105" />
            <el-table-column label="状态" width="125">
              <template #default="{ row }">
                <el-tooltip :disabled="!row.disabledReason" :content="row.disabledReason" placement="top">
                  <el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '已开启' : '已关闭' }}</el-tag>
                </el-tooltip>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="本地项目" name="projects">
          <section class="binding-section">
            <div class="projects-toolbar">
              <span>已绑定项目 {{ projectBindingRows.length }} 个</span>
              <div class="binding-add">
                <div class="folder-picker">
                  <span class="selected-folder" :title="bindingPath">{{ bindingPath || '未选择项目文件夹' }}</span>
                  <el-button size="small" @click="selectProjectFolder">
                    <FolderOpen :size="14" />
                    选择文件夹
                  </el-button>
                </div>
                <el-button size="small" type="primary" :loading="bindingDetecting || bindingSaving" @click="addProjectBinding">
                  识别并绑定
                </el-button>
                <el-button size="small" :loading="bindingLoading" @click="loadProjectBindings">
                  <RefreshCcw :size="14" />
                  刷新
                </el-button>
              </div>
            </div>

            <div v-if="projectBindingRows.length" class="binding-list">
              <article v-for="binding in projectBindingRows" :key="binding.id" class="binding-card">
                <header class="binding-card-head">
                  <div>
                    <strong>{{ binding.name }}</strong>
                    <small>{{ binding.rootPath }}</small>
                  </div>
                  <div class="binding-actions">
                    <span v-if="projectBindingLanAddresses.length" class="binding-lan-text">
                      局域网 {{ projectBindingLanAddresses[0] }}
                    </span>
                    <el-switch
                      v-model="binding.lanEnabled"
                      size="small"
                      active-text="局域网"
                      @change="() => updateProjectBinding(binding)"
                    />
                    <el-button size="small" type="primary" :loading="bindingActionId === binding.id" @click="startProjectBinding(binding)">启动</el-button>
                    <el-button size="small" :loading="bindingActionId === binding.id" @click="stopProjectBinding(binding)">停止</el-button>
                    <el-button size="small" @click="showProjectBindingLogs(binding)">日志</el-button>
                    <el-button size="small" type="danger" plain :loading="bindingActionId === binding.id" @click="deleteProjectBinding(binding)">删除</el-button>
                  </div>
                </header>
                <el-table
                  class="binding-modules-table"
                  :data="binding.modules"
                  :style="{ minHeight: `${38 + Math.max(binding.modules?.length || 1, 1) * 44}px` }"
                  size="small"
                  stripe
                >
                  <el-table-column label="启用" width="72">
                    <template #default="{ row }">
                      <el-checkbox v-model="row.enabled" @change="() => updateProjectBinding(binding)" />
                    </template>
                  </el-table-column>
                  <el-table-column prop="name" label="模块" min-width="120" />
                  <el-table-column prop="type" label="类型" width="90" />
                  <el-table-column prop="command" label="启动命令" min-width="150" show-overflow-tooltip />
                  <el-table-column prop="cwd" label="目录" min-width="220" show-overflow-tooltip />
                  <el-table-column label="端口" width="90">
                    <template #default="{ row }">{{ row.port || '-' }}</template>
                  </el-table-column>
                  <el-table-column label="状态" width="95">
                    <template #default="{ row }">
                      <el-tooltip :disabled="!row.lastError" :content="row.lastError" placement="top">
                        <el-tag :type="moduleStatusType(row.status)">{{ moduleStatusLabel(row.status) }}</el-tag>
                      </el-tooltip>
                    </template>
                  </el-table-column>
                  <el-table-column label="地址" min-width="180">
                    <template #default="{ row }">
                      <div v-if="row.urls?.length" class="project-urls">
                        <el-link v-for="url in row.urls" :key="url" :href="url" target="_blank" type="primary">
                          {{ url.replace('http://', '') }}
                        </el-link>
                      </div>
                      <span v-else>-</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" width="116">
                    <template #default="{ row }">
                      <el-button
                        v-if="moduleNeedsDiagnosis(row)"
                        size="small"
                        class="diagnose-button"
                        :loading="diagnosingModuleId === row.id"
                        @click="diagnoseProjectModule(binding, row)"
                      >
                        <Bot :size="14" />
                        AI 诊断
                      </el-button>
                    </template>
                  </el-table-column>
                </el-table>
              </article>
            </div>
            <el-empty v-else description="还没有绑定项目，选择项目根目录后自动识别模块" :image-size="76" />
          </section>

          <div class="projects-toolbar running-toolbar">
            <span>未绑定本地项目 {{ unboundLocalProjectRows.length }} 个</span>
            <div class="projects-actions">
              <el-button size="small" :loading="localProjectsLoading" @click="loadLocalProjects">
                <RefreshCcw :size="14" />
                刷新
              </el-button>
              <el-button
                size="small"
                type="danger"
                :disabled="!stoppableUnboundProjects.length"
                :loading="stoppingAllProjects"
                @click="stopAllLocalProjects()"
              >
                <Trash2 :size="14" />
                全部停止
              </el-button>
            </div>
          </div>
          <el-table :data="unboundLocalProjectRows" height="240" stripe :row-class-name="rowClassName">
            <el-table-column prop="name" label="项目" min-width="150" sortable />
            <el-table-column prop="kind" label="类型" width="110" />
            <el-table-column label="访问地址" min-width="180">
              <template #default="{ row }">
                <div v-if="row.urls?.length" class="project-urls">
                  <el-link v-for="url in row.urls" :key="url" :href="url" target="_blank" type="primary">
                    {{ url.replace('http://', '') }}
                  </el-link>
                </div>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column prop="processCount" label="进程数" width="95" sortable />
            <el-table-column label="内存" width="115" sortable>
              <template #default="{ row }">{{ row.memoryGb }} GB</template>
            </el-table-column>
            <el-table-column label="状态" width="125">
              <template #default="{ row }">
                <el-tag :type="row.protected ? 'info' : 'warning'">{{ row.protectedReason || (row.protected ? '受保护' : '可停止') }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="projectPath" label="路径" min-width="280" show-overflow-tooltip />
            <el-table-column label="主要进程" min-width="260" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.processes.map((item) => `${item.name}(${item.pid})`).join('、') }}
              </template>
            </el-table-column>
            <el-table-column label="控制" width="110" fixed="right">
              <template #default="{ row }">
                <el-button
                  v-if="!row.protected"
                  size="small"
                  type="danger"
                  :loading="stoppingProjectId === row.id"
                  @click="stopLocalProject(row)"
                >
                  停止
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="运行任务" name="tasks">
          <div class="projects-toolbar">
            <span>运行任务 {{ runningTaskRows.length }} 个</span>
            <div class="projects-actions">
              <el-button size="small" :loading="localProjectsLoading" @click="loadLocalProjects">
                <RefreshCcw :size="14" />
                刷新
              </el-button>
              <el-button
                size="small"
                type="danger"
                :disabled="!stoppableRunningTasks.length"
                :loading="stoppingAllTasks"
                @click="stopAllRunningTasks"
              >
                <Trash2 :size="14" />
                全部停止
              </el-button>
            </div>
          </div>
          <el-table :data="runningTaskRows" height="390" stripe :row-class-name="rowClassName">
            <el-table-column prop="name" label="任务" min-width="150" sortable />
            <el-table-column prop="kind" label="类型" width="110" />
            <el-table-column label="监听端口" min-width="180">
              <template #default="{ row }">
                <span>{{ projectPorts(row).join('、') || '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="processCount" label="进程数" width="95" sortable />
            <el-table-column label="内存" width="115" sortable>
              <template #default="{ row }">{{ row.memoryGb }} GB</template>
            </el-table-column>
            <el-table-column label="状态" width="125">
              <template #default="{ row }">
                <el-tag :type="row.protected ? 'info' : 'warning'">{{ row.protectedReason || (row.protected ? '受保护' : '可停止') }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="projectPath" label="路径" min-width="280" show-overflow-tooltip />
            <el-table-column label="主要进程" min-width="260" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.processes.map((item) => `${item.name}(${item.pid})`).join('、') }}
              </template>
            </el-table-column>
            <el-table-column label="控制" width="110" fixed="right">
              <template #default="{ row }">
                <el-button
                  v-if="!row.protected"
                  size="small"
                  type="danger"
                  :loading="stoppingProjectId === row.id"
                  @click="stopLocalProject(row)"
                >
                  停止
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="磁盘检查" name="disk">
          <div class="disk-toolbar">
            <div>
              <strong>低风险清理与开发缓存迁移</strong>
              <span>{{ diskCheck?.summary || '扫描 C/D 盘容量、缓存项与 Junction 状态' }}</span>
            </div>
            <el-button class="disk-ghost-button" size="small" :loading="diskLoading" @click="loadDiskCheck">
              <RefreshCcw :size="14" />
              刷新
            </el-button>
          </div>

          <div class="disk-overview">
            <article v-for="drive in diskDrives" :key="drive.drive" class="disk-card">
              <div>
                <span>{{ drive.drive }}</span>
                <strong>{{ formatBytes(drive.freeBytes) }}</strong>
                <small>可用 / 总计 {{ formatBytes(drive.totalBytes) }}</small>
              </div>
              <el-progress
                type="dashboard"
                :percentage="Number((100 - drive.freePercent).toFixed(1))"
                :width="96"
                :stroke-width="9"
                color="#24d6a5"
              />
            </article>
            <article class="disk-card">
              <div>
                <span>迁移根目录</span>
                <strong>{{ formatBytes(diskCheck?.movedRoot?.sizeBytes) }}</strong>
                <small>{{ diskCheck?.movedRoot?.path || 'D:\\MovedFromC' }}</small>
              </div>
              <el-button
                class="disk-ghost-button"
                size="small"
                :loading="diskPathOpening"
                :disabled="diskPathOpening"
                @click="openDiskPath(diskCheck?.movedRoot?.path || 'D:\\MovedFromC')"
              >
                <FolderOpen :size="14" />
                打开
              </el-button>
            </article>
          </div>

          <div class="disk-grid">
            <section class="disk-section">
              <div class="subsection-title">开发缓存迁移</div>
              <el-table :data="diskMigrationItems" height="275" stripe>
                <el-table-column prop="label" label="项目" width="150" />
                <el-table-column label="大小" width="105">
                  <template #default="{ row }">{{ formatBytes(row.sizeBytes || row.targetSizeBytes) }}</template>
                </el-table-column>
                <el-table-column prop="status" label="状态" width="115">
                  <template #default="{ row }">
                    <el-tag :type="row.status === '可迁移' ? 'warning' : row.status === '已迁移' ? 'success' : 'info'">
                      {{ row.status }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="path" label="源路径" min-width="260" show-overflow-tooltip />
                <el-table-column prop="target" label="目标" min-width="260" show-overflow-tooltip />
                <el-table-column label="操作" width="160" fixed="right">
                  <template #default="{ row }">
                    <el-button
                      class="disk-icon-button"
                      size="small"
                      :loading="diskPathOpening"
                      :disabled="diskPathOpening"
                      @click="openDiskPath(row.isJunction ? row.target : row.path)"
                    >
                      <FolderOpen :size="14" />
                    </el-button>
                    <el-button
                      v-if="row.operation === 'migrate'"
                      size="small"
                      type="primary"
                      :loading="diskActionLoading === row.id"
                      @click="migrateDiskItem(row)"
                    >
                      迁移
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </section>

            <section class="disk-section">
              <div class="subsection-title">安全清理</div>
              <el-table :data="diskCleanItems" height="275" stripe>
                <el-table-column prop="label" label="项目" width="170" />
                <el-table-column label="可释放" width="115">
                  <template #default="{ row }">{{ formatBytes(row.sizeBytes) }}</template>
                </el-table-column>
                <el-table-column prop="status" label="状态" width="115">
                  <template #default="{ row }">
                    <el-tag :type="row.operation === 'clean' ? 'warning' : 'info'">{{ row.status }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="risk" label="风险说明" min-width="300" show-overflow-tooltip />
                <el-table-column label="操作" width="160" fixed="right">
                  <template #default="{ row }">
                    <el-button
                      class="disk-icon-button"
                      size="small"
                      :loading="diskPathOpening"
                      :disabled="diskPathOpening"
                      @click="openDiskPath(row.openPath || row.path)"
                    >
                      <FolderOpen :size="14" />
                    </el-button>
                    <el-button
                      v-if="row.operation === 'clean'"
                      size="small"
                      type="danger"
                      :loading="diskActionLoading === row.id"
                      @click="cleanDiskItem(row)"
                    >
                      清理
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </section>
          </div>

          <div class="disk-grid">
            <section class="disk-section">
              <div class="subsection-title">应用缓存建议</div>
              <el-table :data="diskAppItems" height="245" stripe>
                <el-table-column prop="label" label="项目" width="160" />
                <el-table-column label="大小" width="115">
                  <template #default="{ row }">{{ formatBytes(row.sizeBytes) }}</template>
                </el-table-column>
                <el-table-column prop="risk" label="风险" width="95">
                  <template #default="{ row }">
                    <el-tag :type="row.risk === '高风险' ? 'danger' : 'warning'">{{ row.risk }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="action" label="建议" min-width="320" show-overflow-tooltip />
                <el-table-column label="操作" width="90" fixed="right">
                  <template #default="{ row }">
                    <el-button
                      class="disk-icon-button"
                      size="small"
                      :loading="diskPathOpening"
                      :disabled="diskPathOpening"
                      @click="openDiskPath(row.path)"
                    >
                      <FolderOpen :size="14" />
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </section>

            <section class="disk-section">
              <div class="subsection-title">C 盘大项与执行日志</div>
              <div class="disk-large-list">
                <div v-for="item in diskLargeItems" :key="`large-${item.id}`" class="disk-large-row">
                  <span>{{ item.label }}</span>
                  <strong>{{ formatBytes(item.sizeBytes || item.targetSizeBytes) }}</strong>
                  <small>{{ item.status }}</small>
                </div>
              </div>
              <div class="disk-log-list">
                <div v-for="log in diskLogs" :key="`${log.time}-${log.text}`" class="disk-log" :class="log.level">
                  <span>{{ log.time }}</span>
                  <p>{{ log.text }}</p>
                </div>
                <el-empty v-if="!diskLogs.length" description="暂无执行日志" :image-size="54" />
              </div>
            </section>
          </div>
        </el-tab-pane>

        <el-tab-pane label="历史对比" name="history">
          <div class="history-toolbar">
            <el-select
              v-model="compareIds"
              placeholder="勾选两次读取结果"
              multiple
              collapse-tags
              collapse-tags-tooltip
              :multiple-limit="2"
              filterable
              @change="loadCompareSnapshots"
            >
              <el-option
                v-for="item in history"
                :key="item.id"
                :label="`${formatTime(item.capturedAt)} · ${item.score ?? '-'}分`"
                :value="item.id"
              />
            </el-select>
            <span>勾选 2 条快照进行对比，已有快照 {{ history.length }} 条，旧文本日志 {{ oldLogs.length }} 条</span>
          </div>
          <el-table :data="compareRows" height="180" stripe>
            <el-table-column prop="name" label="指标" />
            <el-table-column :label="compareA ? formatTime(compareA.capturedAt) : '读取 A'">
              <template #default="{ row }">{{ row.current }}{{ row.unit }}</template>
            </el-table-column>
            <el-table-column :label="compareB ? formatTime(compareB.capturedAt) : '读取 B'">
              <template #default="{ row }">{{ row.previous ?? '-' }}{{ row.previous !== undefined ? row.unit : '' }}</template>
            </el-table-column>
            <el-table-column label="变化">
              <template #default="{ row }">
                <el-tag :type="deltaType(row.delta, row.reverse)">
                  {{ row.delta > 0 ? '+' : '' }}{{ row.delta.toFixed ? row.delta.toFixed(1) : row.delta }}{{ row.unit }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
          <div v-if="compareAnalysis" class="compare-analysis">
            <div class="analysis-summary">
              <strong>{{ compareAnalysis.summary }}</strong>
              <div>
                <el-tag :type="deltaType(compareAnalysis.scoreDelta, true)">评分 {{ compareAnalysis.scoreDelta > 0 ? '+' : '' }}{{ compareAnalysis.scoreDelta }}分</el-tag>
                <el-tag :type="deltaType(compareAnalysis.cpuDelta)">CPU {{ compareAnalysis.cpuDelta > 0 ? '+' : '' }}{{ compareAnalysis.cpuDelta }}%</el-tag>
                <el-tag :type="deltaType(compareAnalysis.memoryDelta)">内存 {{ compareAnalysis.memoryDelta > 0 ? '+' : '' }}{{ compareAnalysis.memoryDelta }}%</el-tag>
              </div>
            </div>
            <div class="analysis-grid">
              <section>
                <div class="analysis-title">变重应用</div>
                <div v-if="compareAnalysis.heavier.length" class="analysis-list">
                  <div v-for="row in compareAnalysis.heavier" :key="`heavy-${row.name}`" class="analysis-item">
                    <span>{{ row.name }}</span>
                    <strong>{{ row.cpuDelta > 0 ? '+' : '' }}{{ row.cpuDelta }}% / {{ row.memoryDeltaGb > 0 ? '+' : '' }}{{ row.memoryDeltaGb }}GB</strong>
                  </div>
                </div>
                <el-empty v-else description="暂无明显变重项" :image-size="54" />
              </section>
              <section>
                <div class="analysis-title">变轻应用</div>
                <div v-if="compareAnalysis.lighter.length" class="analysis-list">
                  <div v-for="row in compareAnalysis.lighter" :key="`light-${row.name}`" class="analysis-item">
                    <span>{{ row.name }}</span>
                    <strong>{{ row.cpuDelta }}% / {{ row.memoryDeltaGb }}GB</strong>
                  </div>
                </div>
                <el-empty v-else description="暂无明显变轻项" :image-size="54" />
              </section>
            </div>
          </div>
          <div class="subsection-title">主要影响流畅的应用进程</div>
          <el-table :data="mainImpactRows" height="330" stripe>
            <el-table-column prop="name" label="应用/进程" min-width="150" sortable />
            <el-table-column label="CPU 变化" width="130" sortable>
              <template #default="{ row }">
                <el-tag :type="deltaType(row.cpuDelta)">
                  {{ row.cpuDelta > 0 ? '+' : '' }}{{ row.cpuDelta }}%
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="内存变化" width="130" sortable>
              <template #default="{ row }">
                <el-tag :type="deltaType(row.memoryDeltaGb)">
                  {{ row.memoryDeltaGb > 0 ? '+' : '' }}{{ row.memoryDeltaGb }}GB
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="读取 A" min-width="150">
              <template #default="{ row }">{{ row.currentCpu }}% / {{ row.currentMemoryGb }}GB / {{ row.currentCount }} 个</template>
            </el-table-column>
            <el-table-column label="读取 B" min-width="150">
              <template #default="{ row }">{{ row.previousCpu }}% / {{ row.previousMemoryGb }}GB / {{ row.previousCount }} 个</template>
            </el-table-column>
            <el-table-column label="标签" min-width="180">
              <template #default="{ row }">
                <el-tag v-for="tag in row.tags" :key="tag" class="tag" effect="plain">{{ tag }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </section>
  </main>
</template>
