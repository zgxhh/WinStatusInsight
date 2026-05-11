<script setup>
import { computed, onMounted, ref } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import {
  Activity,
  FolderOpen,
  Gauge,
  Layers3,
  LoaderCircle,
  Play,
  RefreshCcw,
  Square,
  Trash2
} from 'lucide-vue-next'
import { ElMessage, ElMessageBox } from 'element-plus'

use([CanvasRenderer, BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent])

const loading = ref(false)
const status = ref(null)
const history = ref([])
const localProjects = ref([])
const activeTab = ref('apps')
const stoppingProjectId = ref('')
const stoppingAllProjects = ref(false)
const errorMessage = ref('')

const formatGb = (value) => `${Number(value || 0).toFixed(2)} GB`
const formatPercent = (value) => `${Number(value || 0).toFixed(1)}%`
const groupMemory = (row) => Number(row.memoryGb ?? row.workingSetGb ?? row.privateMemoryGb ?? 0)
const processMemory = (row) => Number(row.memoryGb ?? row.workingSetGb ?? row.privateMemoryGb ?? 0)

const system = computed(() => status.value?.system || {})
const analysis = computed(() => status.value?.analysis || { score: 0, label: '未读取', bottlenecks: [] })
const processes = computed(() => status.value?.processes || [])
const appGroups = computed(() => status.value?.appGroups || [])
const suggestions = computed(() => status.value?.suggestions || [])
const stoppableProjects = computed(() => localProjects.value.filter((project) => !project.protected))

const topCpu = computed(() => [...processes.value].sort((a, b) => Number(b.cpuPercent || 0) - Number(a.cpuPercent || 0)).slice(0, 12))
const topMemory = computed(() => [...processes.value].sort((a, b) => processMemory(b) - processMemory(a)).slice(0, 12))

const scoreOption = computed(() => ({
  backgroundColor: 'transparent',
  series: [
    {
      type: 'pie',
      radius: ['72%', '86%'],
      startAngle: 220,
      label: { show: false },
      data: [
        { value: analysis.value.score, itemStyle: { color: '#24d6a5' } },
        { value: Math.max(0, 100 - analysis.value.score), itemStyle: { color: '#22303d' } }
      ]
    }
  ]
}))

const pressureOption = computed(() => ({
  backgroundColor: 'transparent',
  tooltip: { trigger: 'axis' },
  grid: { left: 36, right: 16, top: 24, bottom: 28 },
  xAxis: { type: 'category', data: ['CPU', '内存'], axisLabel: { color: '#92a4b4' } },
  yAxis: { type: 'value', max: 100, axisLabel: { color: '#92a4b4' }, splitLine: { lineStyle: { color: '#213142' } } },
  series: [
    {
      type: 'bar',
      data: [Number(system.value.cpuPercent || 0), Number(system.value.memoryPercent || 0)],
      itemStyle: { color: '#48a9f8', borderRadius: 5 }
    }
  ]
}))

const appGroupOption = computed(() => ({
  backgroundColor: 'transparent',
  tooltip: { trigger: 'axis' },
  grid: { left: 42, right: 18, top: 18, bottom: 44 },
  xAxis: {
    type: 'category',
    data: appGroups.value.slice(0, 8).map((item) => item.name),
    axisLabel: { color: '#92a4b4', rotate: 28 }
  },
  yAxis: { type: 'value', axisLabel: { color: '#92a4b4' }, splitLine: { lineStyle: { color: '#213142' } } },
  series: [
    {
      name: '内存 GB',
      type: 'bar',
      data: appGroups.value.slice(0, 8).map((item) => groupMemory(item)),
      itemStyle: { color: '#f2b84b', borderRadius: 5 }
    }
  ]
}))

async function requestJson(url, options) {
  const response = await fetch(url, options)
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.message || `请求失败：${response.status}`)
  return result
}

async function loadStatus() {
  loading.value = true
  errorMessage.value = ''
  try {
    status.value = await requestJson('/api/status')
    await Promise.all([loadHistory(), loadLocalProjects()])
    ElMessage.success('状态读取完成')
  } catch (error) {
    errorMessage.value = error.message
    ElMessage.error(error.message)
  } finally {
    loading.value = false
  }
}

async function loadHistory() {
  history.value = await requestJson('/api/history').catch(() => [])
}

async function loadLocalProjects() {
  localProjects.value = await requestJson('/api/local-projects').catch(() => [])
}

async function openReportDir() {
  try {
    const result = await requestJson('/api/open-report-dir')
    ElMessage.success(`已打开：${result.path}`)
  } catch (error) {
    ElMessage.error(error.message)
  }
}

async function stopPids(pids) {
  return requestJson('/api/local-projects/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pids })
  })
}

async function stopLocalProject(project) {
  if (project.protected) return
  const portText = project.ports?.length ? project.ports.join(', ') : '未检测到端口'
  const pidsText = project.pids.join(', ')
  try {
    await ElMessageBox.confirm(
      `确认停止「${project.name}」吗？\n路径：${project.projectPath || '未识别'}\n端口：${portText}\nPID：${pidsText}\n\n停止后对应开发服务会退出。`,
      '停止本地项目',
      { type: 'warning', confirmButtonText: '停止', cancelButtonText: '取消' }
    )
    stoppingProjectId.value = project.id
    await stopPids(project.pids)
    await loadLocalProjects()
    ElMessage.success('已停止项目')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error.message || '停止失败')
  } finally {
    stoppingProjectId.value = ''
  }
}

async function stopAllLocalProjects() {
  const projects = stoppableProjects.value
  if (!projects.length) return
  const names = projects.map((item) => `${item.name}${item.ports?.length ? `(${item.ports.join(', ')})` : ''}`).join('、')
  const pids = projects.flatMap((item) => item.pids)
  try {
    await ElMessageBox.confirm(`确认停止这些本地项目吗？\n${names}\n\nPID：${pids.join(', ')}`, '全部停止', {
      type: 'warning',
      confirmButtonText: '全部停止',
      cancelButtonText: '取消'
    })
    stoppingAllProjects.value = true
    await stopPids(pids)
    await loadLocalProjects()
    ElMessage.success('已停止可停止项目')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error.message || '停止失败')
  } finally {
    stoppingAllProjects.value = false
  }
}

function riskLabel(value) {
  if (value === 'high') return '高占用'
  if (value === 'medium') return '关注'
  return '正常'
}

function riskType(value) {
  if (value === 'high') return 'danger'
  if (value === 'medium') return 'warning'
  return 'success'
}

onMounted(async () => {
  await Promise.all([loadHistory(), loadLocalProjects()])
})
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div>
        <h1>WinStatusInsight</h1>
        <p>本机 Windows 状态分析与开发服务控制台</p>
      </div>
      <div class="actions">
        <el-button type="primary" :loading="loading" @click="loadStatus">
          <Play v-if="!loading" :size="17" />
          <LoaderCircle v-else class="spin" :size="17" />
          读取状态
        </el-button>
        <el-button @click="openReportDir">
          <FolderOpen :size="17" />
          打开报告目录
        </el-button>
      </div>
    </header>

    <el-alert v-if="errorMessage" type="error" :title="errorMessage" show-icon :closable="false" />

    <section class="overview-grid">
      <article class="panel score-panel">
        <div class="panel-title">
          <Gauge :size="18" />
          流畅评分
        </div>
        <div class="score-chart">
          <v-chart :option="scoreOption" autoresize />
          <div class="score-number">
            <strong>{{ analysis.score }}</strong>
            <span>{{ analysis.label }}</span>
          </div>
        </div>
      </article>

      <article class="panel">
        <div class="panel-title">
          <Activity :size="18" />
          当前压力
        </div>
        <div class="metric-row">
          <div><span>CPU</span><strong>{{ formatPercent(system.cpuPercent) }}</strong></div>
          <div><span>内存</span><strong>{{ formatPercent(system.memoryPercent) }}</strong></div>
          <div><span>进程</span><strong>{{ processes.length }}</strong></div>
        </div>
        <v-chart class="mini-chart" :option="pressureOption" autoresize />
      </article>

      <article class="panel">
        <div class="panel-title">
          <Layers3 :size="18" />
          当前瓶颈
        </div>
        <ul class="bottlenecks">
          <li v-for="item in analysis.bottlenecks" :key="`${item.type}-${item.text}`">
            <span>{{ item.type }}</span>
            <p>{{ item.text }}</p>
          </li>
        </ul>
      </article>
    </section>

    <section class="panel wide-panel">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="应用聚合" name="apps">
          <div class="split">
            <v-chart class="app-chart" :option="appGroupOption" autoresize />
            <el-table :data="appGroups" height="380" stripe>
              <el-table-column prop="name" label="应用" min-width="150" />
              <el-table-column label="进程" width="80">
                <template #default="{ row }">{{ row.processCount || row.count || 0 }}</template>
              </el-table-column>
              <el-table-column prop="cpuPercent" label="CPU" width="90">
                <template #default="{ row }">{{ formatPercent(row.cpuPercent) }}</template>
              </el-table-column>
              <el-table-column prop="memoryGb" label="内存" width="110">
                <template #default="{ row }">{{ formatGb(groupMemory(row)) }}</template>
              </el-table-column>
              <el-table-column prop="risk" label="风险" width="100">
                <template #default="{ row }">
                  <el-tag :type="riskType(row.risk)" effect="dark">{{ riskLabel(row.risk) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="建议" min-width="240" show-overflow-tooltip>
                <template #default="{ row }">{{ row.advice || row.suggestion || '-' }}</template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane label="本地项目" name="projects">
          <div class="projects-toolbar">
            <span>正在运行的开发项目 {{ localProjects.length }} 个</span>
            <div>
              <el-button size="small" @click="loadLocalProjects">
                <RefreshCcw :size="15" />
                刷新
              </el-button>
              <el-button
                size="small"
                type="danger"
                :disabled="!stoppableProjects.length"
                :loading="stoppingAllProjects"
                @click="stopAllLocalProjects"
              >
                <Square :size="15" />
                全部停止
              </el-button>
            </div>
          </div>
          <el-table :data="localProjects" height="390" stripe>
            <el-table-column prop="name" label="项目" min-width="150" />
            <el-table-column prop="kind" label="类型" width="150" />
            <el-table-column prop="ports" label="端口" width="120">
              <template #default="{ row }">{{ row.ports?.join(', ') || '-' }}</template>
            </el-table-column>
            <el-table-column prop="memoryGb" label="内存" width="110">
              <template #default="{ row }">{{ formatGb(row.memoryGb) }}</template>
            </el-table-column>
            <el-table-column prop="projectPath" label="路径" min-width="260" show-overflow-tooltip />
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <el-tag :type="row.protected ? 'success' : 'warning'" effect="dark">
                  {{ row.protected ? '面板保护' : '可停止' }}
                </el-tag>
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
                  <Trash2 :size="14" />
                  停止
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="进程排行" name="processes">
          <div class="double-table">
            <el-table :data="topCpu" height="380" stripe>
              <el-table-column prop="name" label="CPU 高占用" min-width="150" />
              <el-table-column prop="pid" label="PID" width="90" />
              <el-table-column prop="cpuPercent" label="CPU" width="90">
                <template #default="{ row }">{{ formatPercent(row.cpuPercent) }}</template>
              </el-table-column>
              <el-table-column prop="path" label="路径" min-width="220" show-overflow-tooltip />
            </el-table>
            <el-table :data="topMemory" height="380" stripe>
              <el-table-column prop="name" label="内存高占用" min-width="150" />
              <el-table-column prop="pid" label="PID" width="90" />
              <el-table-column prop="memoryGb" label="内存" width="100">
                <template #default="{ row }">{{ formatGb(processMemory(row)) }}</template>
              </el-table-column>
              <el-table-column prop="path" label="路径" min-width="220" show-overflow-tooltip />
            </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane label="历史记录" name="history">
          <el-table :data="history" height="390" stripe>
            <el-table-column prop="capturedAt" label="读取时间" min-width="190" />
            <el-table-column prop="score" label="评分" width="90" />
            <el-table-column prop="label" label="状态" width="130" />
            <el-table-column prop="cpuPercent" label="CPU" width="100">
              <template #default="{ row }">{{ formatPercent(row.cpuPercent) }}</template>
            </el-table-column>
            <el-table-column prop="memoryPercent" label="内存" width="100">
              <template #default="{ row }">{{ formatPercent(row.memoryPercent) }}</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </section>

    <section class="panel suggestions-panel">
      <div class="panel-title">处理建议</div>
      <div class="suggestion-list">
        <article v-for="item in suggestions.slice(0, 6)" :key="`${item.name}-${item.pid}`">
          <strong>{{ item.name }}</strong>
          <p>{{ item.action || item.reason || '建议人工确认后处理。' }}</p>
        </article>
        <article v-if="!suggestions.length">
          <strong>暂无高风险建议</strong>
          <p>读取状态后，这里会列出更值得处理的应用或进程。</p>
        </article>
      </div>
    </section>
  </main>
</template>
