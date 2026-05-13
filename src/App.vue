<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { GaugeChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import {
  Activity,
  Database,
  FolderOpen,
  Gauge,
  RefreshCcw,
  Settings,
  ShieldAlert,
  Trash2
} from 'lucide-vue-next'

use([CanvasRenderer, GaugeChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent])

const loading = ref(false)
const snapshot = ref(null)
const history = ref([])
const oldLogs = ref([])
const localProjects = ref([])
const compareIds = ref([])
const compareSnapshots = ref([])
const errorMessage = ref('')
const trend = ref([])
const cleaningPid = ref(null)
const localProjectsLoading = ref(false)
const stoppingProjectId = ref('')
const stoppingAllProjects = ref(false)
const diskCheck = ref(null)
const diskLoading = ref(false)
const diskActionLoading = ref('')
const diskPathOpening = ref(false)
const diskLogs = ref([])
const activeTab = ref('resources')
const showSystemItems = ref(true)
const loadingGaugeValue = ref(10)
const scoreAnimating = ref(false)
const settingsVisible = ref(false)
const desktopSettings = ref({ closeToTray: false, localProjectAlertsEnabled: true })
const desktopSettingsLoading = ref(false)
const updateChecking = ref(false)
const updateInstalling = ref(false)
const updateInfo = ref(null)
const resourceSort = ref('impact')
const startupItems = ref([])
const startupLoading = ref(false)
const togglingStartupId = ref('')
let loadingGaugeFrame = null

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

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

const deltaType = (value, reverse = false) => {
  if (Math.abs(Number(value || 0)) < 0.01) return 'info'
  const worse = reverse ? value < 0 : value > 0
  return worse ? 'warning' : 'success'
}

const cleanableSuggestions = computed(() => (snapshot.value?.suggestions || []).filter((item) => item.cleanable))
const topImpactGroups = computed(() => (snapshot.value?.appGroups || []).slice(0, 4))
const compareA = computed(() => compareSnapshots.value[0] || null)
const compareB = computed(() => compareSnapshots.value[1] || null)
const diskDrives = computed(() => diskCheck.value?.drives || [])
const diskLargeItems = computed(() => diskCheck.value?.largeItems || [])
const diskMigrationItems = computed(() => (diskCheck.value?.items || []).filter((item) => item.type === 'dev-cache'))
const diskCleanItems = computed(() => (diskCheck.value?.items || []).filter((item) => item.type === 'clean'))
const diskAppItems = computed(() => (diskCheck.value?.items || []).filter((item) => item.type === 'app-cache'))
const desktopApi = computed(() => window.winStatusInsight || null)

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
const stoppableProjects = computed(() => localProjectRows.value.filter((project) => !project.protected))
const startupRows = computed(() => sortedRows(startupItems.value.map((item) => ({ ...item, protected: !item.manageable }))))
const groupProcessRows = (group) => sortResourceRows(group?.processes || group?.topProcesses || [])

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

const checkForUpdates = async () => {
  if (!desktopApi.value?.checkForUpdates) {
    ElMessage.info('版本更新只在桌面应用中可用')
    return
  }
  updateChecking.value = true
  try {
    updateInfo.value = await desktopApi.value.checkForUpdates()
    ElMessage.success(updateInfo.value.hasUpdate ? `发现新版本 ${updateInfo.value.latestVersion}` : '已是最新版本')
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    updateChecking.value = false
  }
}

const downloadAndInstallUpdate = async () => {
  if (!desktopApi.value?.downloadAndInstallUpdate) return
  updateInstalling.value = true
  try {
    const result = await desktopApi.value.downloadAndInstallUpdate()
    ElMessage.success(result.message || '安装程序已启动')
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    updateInstalling.value = false
  }
}

const startLoadingGauge = () => {
  stopLoadingGauge()
  scoreAnimating.value = true
  const startValue = Math.max(18, Math.min(82, Number(snapshot.value?.analysis?.score ?? loadingGaugeValue.value ?? 52)))
  const startedAt = performance.now()
  let displayed = startValue
  const easeOutCubic = (value) => 1 - Math.pow(1 - value, 3)
  const easeInOut = (value) => (value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2)
  const throttleSweep = (phase) => {
    if (phase < 0.46) return 34 + easeOutCubic(phase / 0.46) * 58
    if (phase < 0.74) return 92 - easeInOut((phase - 0.46) / 0.28) * 36
    return 56 + easeOutCubic((phase - 0.74) / 0.26) * 30
  }
  const tick = (now) => {
    const elapsed = now - startedAt
    const phase = (elapsed % 1550) / 1550
    const target = throttleSweep(phase) + Math.sin(elapsed / 260) * 2.4
    displayed += (target - displayed) * 0.18
    loadingGaugeValue.value = Math.max(20, Math.min(96, Number(displayed.toFixed(1))))
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
    const duration = 980
    const startedAt = performance.now()
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration)
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2
      loadingGaugeValue.value = Math.max(0, Math.min(100, Number((start + (target - start) * eased).toFixed(1))))
      if (progress < 1) {
        window.requestAnimationFrame(tick)
        return
      }
      loadingGaugeValue.value = target
      scoreAnimating.value = false
      resolve()
    }
    window.requestAnimationFrame(tick)
  })

const readStatus = async () => {
  const startedAt = performance.now()
  loading.value = true
  startLoadingGauge()
  errorMessage.value = ''
  try {
    const response = await fetch('/api/status')
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || '读取状态失败')
    await wait(Math.max(0, 900 - (performance.now() - startedAt)))
    await settleGaugeToScore(data.analysis.score)
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
  try {
    const response = await fetch('/api/open-report-dir')
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || '打开报告目录失败')
    ElMessage.success(`已打开报告目录：${result.path}`)
  } catch (error) {
    ElMessage.error(error.message)
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

const stopAllLocalProjects = async () => {
  const projects = stoppableProjects.value
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
        radius: '92%',
        animation: false,
        animationDurationUpdate: 0,
        animationEasingUpdate: 'linear',
        progress: {
          show: true,
          width: 16,
          roundCap: true,
          itemStyle: {
            color: loading.value || scoreAnimating.value
              ? '#24d6a5'
              : energyColor,
            shadowBlur: loading.value ? 14 : 6,
            shadowColor: loading.value ? 'rgba(36, 214, 165, 0.5)' : 'rgba(36, 214, 165, 0.24)'
          }
        },
        axisLine: { lineStyle: { width: 16, color: [[1, '#263647']] } },
        axisTick: { show: false },
        splitLine: { distance: -22, length: 8, lineStyle: { color: '#607080' } },
        axisLabel: { color: '#9eb1c6', distance: 24 },
        pointer: {
          width: loading.value ? 6 : 5,
          itemStyle: { color: loading.value ? '#6da4ff' : '#5c7df0' }
        },
        detail: { valueAnimation: false, formatter: '{value}', color: '#f6fbff', fontSize: 42, offsetCenter: [0, '32%'] },
        title: { color: '#9eb1c6', fontSize: 14, offsetCenter: [0, '58%'] },
        data: [{ value: score, name: label }]
      }
    ]
  }
})

const trendOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  legend: { textStyle: { color: '#a8b9ca' }, top: 0 },
  grid: { left: 36, right: 18, top: 44, bottom: 28 },
  xAxis: { type: 'category', data: trend.value.map((item) => item.time), axisLabel: { color: '#8ca1b5' } },
  yAxis: { type: 'value', min: 0, max: 100, axisLabel: { color: '#8ca1b5' }, splitLine: { lineStyle: { color: '#243648' } } },
  series: [
    { name: 'CPU', type: 'line', smooth: true, data: trend.value.map((item) => item.cpu), color: '#48a9f8' },
    { name: '内存', type: 'line', smooth: true, data: trend.value.map((item) => item.memory), color: '#24d6a5' },
    { name: '评分', type: 'line', smooth: true, data: trend.value.map((item) => item.score), color: '#ff6275' }
  ]
}))

const resourceOption = computed(() => {
  const system = snapshot.value?.system || {}
  return {
    tooltip: { trigger: 'item' },
    series: [
      {
        type: 'pie',
        radius: ['48%', '72%'],
        label: { color: '#c9d6e2', formatter: '{b}\n{d}%' },
        data: [
          { name: '内存已用', value: system.memoryUsed || 0, itemStyle: { color: '#24d6a5' } },
          { name: '内存空闲', value: system.memoryFree || 0, itemStyle: { color: '#34475c' } }
        ]
      }
    ]
  }
})

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
  await Promise.all([loadHistory(), loadDesktopSettings()])
  desktopApi.value?.onNavigateTab?.((tabName) => {
    activeTab.value = tabName
    if (tabName === 'projects') loadLocalProjects()
  })
  await restoreLatestSnapshot()
  await ensureTwoCompareIds()
  loadStartupItems()
  loadLocalProjects()
  loadDiskCheck()
})

onBeforeUnmount(() => {
  stopLoadingGauge()
})
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <section>
        <div class="eyebrow">LOCAL SYSTEM OBSERVER</div>
        <h1>WinStatusInsight</h1>
      </section>
      <nav class="actions command-bar">
        <el-button class="command-button command-primary" :loading="loading" @click="readStatus">
          <Activity :size="17" />
          读取状态
        </el-button>
        <el-button class="command-button" @click="openReportDir">
          <FolderOpen :size="17" />
          打开报告目录
        </el-button>
        <el-button class="command-button command-icon" circle title="设置" @click="settingsVisible = true">
          <Settings :size="17" />
        </el-button>
      </nav>
    </header>

    <el-dialog v-model="settingsVisible" title="设置" width="420px" align-center>
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
        <div class="settings-row update-row">
          <div>
            <strong>检查版本更新</strong>
            <span v-if="updateInfo">
              当前 {{ updateInfo.currentVersion }}，最新 {{ updateInfo.latestVersion }}。
              {{ updateInfo.hasUpdate ? '可下载安装新版。' : '已是最新版本。' }}
            </span>
            <span v-else>手动联网检查 GitHub Release，发现新版后可静默下载安装。</span>
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
              下载安装
            </el-button>
          </div>
        </div>
      </div>
    </el-dialog>

    <el-alert v-if="errorMessage" class="alert" type="error" :title="errorMessage" show-icon />

    <section class="hero-grid">
      <article class="panel score-panel">
        <div class="panel-title">
          <Gauge :size="18" />
          当前流畅评分
        </div>
        <VChart class="score-chart" :option="scoreOption" autoresize />
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
        <div v-if="snapshot" class="metric-list compact">
          <div class="metric">
            <span>CPU</span>
            <strong>{{ snapshot.system.cpuPercent }}%</strong>
          </div>
          <div class="metric">
            <span>内存</span>
            <strong>{{ snapshot.system.memoryPercent }}%</strong>
          </div>
        </div>
        <el-empty v-else description="点击读取状态开始分析" :image-size="84" />
        <div v-if="snapshot" class="bottlenecks">
          <el-tag v-for="item in snapshot.analysis.bottlenecks" :key="item.type" effect="dark" type="warning">
            {{ item.type }}：{{ item.text }}
          </el-tag>
        </div>
        <div v-if="snapshot && topImpactGroups.length" class="impact-list">
          <div v-for="item in topImpactGroups" :key="item.name" class="impact-row">
            <div>
              <strong>{{ item.name }}</strong>
              <small>{{ item.count }} 个进程 · {{ riskLabel(item.risk) }}</small>
            </div>
            <span>{{ item.cpuPercent }}% / {{ item.workingSetGb }}GB</span>
          </div>
        </div>
      </article>
    </section>

    <section class="content-grid">
      <article class="panel suggestions">
        <div class="panel-title">
          <Database :size="18" />
          建议清理
        </div>
        <div v-if="snapshot && cleanableSuggestions.length" class="suggestion-list">
          <div v-for="item in cleanableSuggestions" :key="`${item.processName}-${item.pid}`" class="suggestion" :class="item.level">
            <div class="suggestion-copy">
              <strong>{{ item.title }} {{ item.processName ? `· ${item.processName}` : '' }}</strong>
              <p>{{ item.text }}</p>
            </div>
            <div class="suggestion-action">
              <span>{{ item.cpuPercent }}% / {{ item.memoryGb }}GB</span>
              <el-button size="small" type="danger" :loading="cleaningPid === item.pid" @click="cleanupProcess(item)">
                <Trash2 :size="14" />
                清理
              </el-button>
            </div>
          </div>
        </div>
        <el-empty v-else :description="snapshot ? '暂无推荐清理项' : '暂无建议'" :image-size="76" />
      </article>

      <article class="panel memory-panel">
        <div class="panel-title">内存结构</div>
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
          <div class="projects-toolbar">
            <span>正在运行的开发项目 {{ localProjectRows.length }} 个</span>
            <div class="projects-actions">
              <el-button size="small" :loading="localProjectsLoading" @click="loadLocalProjects">
                <RefreshCcw :size="14" />
                刷新
              </el-button>
              <el-button
                size="small"
                type="danger"
                :disabled="!stoppableProjects.length"
                :loading="stoppingAllProjects"
                @click="stopAllLocalProjects"
              >
                <Trash2 :size="14" />
                全部停止
              </el-button>
            </div>
          </div>
          <el-table :data="localProjectRows" height="390" stripe :row-class-name="rowClassName">
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
