<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { agentsService } from '@/services/api'

interface AgentMetric {
  agentId: string
  agentName: string
  agentRole: string
  tasksCompleted: number
  tasksFailed: number
  tasksTotal: number
  successRate: number
  averageDuration: number
  lastActivity?: string
  currentStatus: string
}

interface SystemMetrics {
  totalAgents: number
  activeAgents: number
  totalTasks: number
  completedTasks: number
  failedTasks: number
  averageTaskDuration: number
  topAgents: AgentMetric[]
  tasksByType: Record<string, number>
  tasksByStatus: Record<string, number>
}

const loading = ref(true)
const systemMetrics = ref<SystemMetrics | null>(null)
const agentMetrics = ref<AgentMetric[]>([])

// Filters
const filterDateRange = ref<'all' | '7d' | '30d'>('all')

// Computed values for visualizations
const tasksByTypeChartData = computed(() => {
  if (!systemMetrics.value) return []
  return Object.entries(systemMetrics.value.tasksByType).map(([type, count]) => ({
    type,
    count,
    percentage: systemMetrics.value ? Math.round((count / systemMetrics.value.totalTasks) * 100) : 0
  }))
})

const tasksByStatusChartData = computed(() => {
  if (!systemMetrics.value) return []
  return Object.entries(systemMetrics.value.tasksByStatus).map(([status, count]) => ({
    status,
    count,
    percentage: systemMetrics.value ? Math.round((count / systemMetrics.value.totalTasks) * 100) : 0
  }))
})

const statusColors: Record<string, string> = {
  pending: 'bg-gray-500',
  in_progress: 'bg-blue-500',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  awaiting_human_response: 'bg-yellow-500'
}

const statusLabels: Record<string, string> = {
  pending: 'Pendientes',
  in_progress: 'En Progreso',
  completed: 'Completadas',
  failed: 'Fallidas',
  awaiting_human_response: 'Esperando Humano'
}

const typeColors: Record<string, string> = {
  web_search: 'bg-purple-500',
  data_analysis: 'bg-blue-500',
  content_generation: 'bg-green-500',
  code_execution: 'bg-orange-500',
  custom: 'bg-gray-500',
  mission_analysis: 'bg-pink-500',
  agent_creation: 'bg-cyan-500',
  coordination: 'bg-indigo-500',
  human_input: 'bg-yellow-500'
}

const typeLabels: Record<string, string> = {
  web_search: 'Búsqueda Web',
  data_analysis: 'Análisis de Datos',
  content_generation: 'Generación de Contenido',
  code_execution: 'Ejecución de Código',
  custom: 'Personalizado',
  mission_analysis: 'Análisis de Misión',
  agent_creation: 'Creación de Agente',
  coordination: 'Coordinación',
  human_input: 'Input Humano'
}

// Format duration
const formatDuration = (ms: number) => {
  if (ms < 1000) return '< 1s'
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}

// Format date
const formatDate = (dateStr?: string) => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString()
}

// Fetch metrics
const fetchMetrics = async () => {
  try {
    loading.value = true

    // Calculate date range
    let startDate: string | undefined
    let endDate: string | undefined

    if (filterDateRange.value === '7d') {
      startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    } else if (filterDateRange.value === '30d') {
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    }

    const [systemRes, agentsRes] = await Promise.all([
      agentsService.getSystemMetrics(startDate, endDate),
      agentsService.getAllMetrics()
    ])

    systemMetrics.value = systemRes.data
    agentMetrics.value = agentsRes.data
  } catch (error) {
    console.error('Error fetching metrics:', error)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchMetrics()
})
</script>

<template>
  <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
    <!-- Header -->
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-white">📊 Métricas de Agentes</h2>
      <div class="flex items-center gap-4">
        <!-- Date Range Filter -->
        <select
          v-model="filterDateRange"
          @change="fetchMetrics"
          class="bg-gray-700 text-white text-sm rounded px-3 py-2 border border-gray-600"
        >
          <option value="all">Todo el tiempo</option>
          <option value="7d">Últimos 7 días</option>
          <option value="30d">Últimos 30 días</option>
        </select>
        <button
          @click="fetchMetrics"
          class="text-gray-400 hover:text-white"
          title="Refrescar métricas"
        >
          🔄
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="text-center py-12">
      <p class="text-gray-400">Cargando métricas...</p>
    </div>

    <!-- Metrics Content -->
    <div v-else-if="systemMetrics" class="space-y-6">
      <!-- System Overview Cards -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="bg-gray-700 rounded-lg p-4">
          <div class="text-gray-400 text-sm">Total Agentes</div>
          <div class="text-2xl font-bold text-white">{{ systemMetrics.totalAgents }}</div>
          <div class="text-green-400 text-xs">{{ systemMetrics.activeAgents }} activos</div>
        </div>
        <div class="bg-gray-700 rounded-lg p-4">
          <div class="text-gray-400 text-sm">Total Tareas</div>
          <div class="text-2xl font-bold text-white">{{ systemMetrics.totalTasks }}</div>
          <div class="text-blue-400 text-xs">{{ systemMetrics.completedTasks }} completadas</div>
        </div>
        <div class="bg-gray-700 rounded-lg p-4">
          <div class="text-gray-400 text-sm">Tasa de Éxito</div>
          <div class="text-2xl font-bold text-white">
            {{ systemMetrics.totalTasks > 0
              ? Math.round((systemMetrics.completedTasks / systemMetrics.totalTasks) * 100)
              : 0 }}%
          </div>
          <div class="text-red-400 text-xs">{{ systemMetrics.failedTasks }} fallidas</div>
        </div>
        <div class="bg-gray-700 rounded-lg p-4">
          <div class="text-gray-400 text-sm">Duración Promedio</div>
          <div class="text-2xl font-bold text-white">{{ formatDuration(systemMetrics.averageTaskDuration) }}</div>
          <div class="text-gray-400 text-xs">por tarea completada</div>
        </div>
      </div>

      <!-- Charts Row -->
      <div class="grid md:grid-cols-2 gap-6">
        <!-- Tasks by Type -->
        <div class="bg-gray-700 rounded-lg p-4">
          <h3 class="text-lg font-semibold text-white mb-4">Tareas por Tipo</h3>
          <div class="space-y-2">
            <div
              v-for="item in tasksByTypeChartData"
              :key="item.type"
              class="flex items-center gap-3"
            >
              <div class="w-24 text-sm text-gray-300 truncate">{{ typeLabels[item.type] || item.type }}</div>
              <div class="flex-1 bg-gray-600 rounded-full h-4 overflow-hidden">
                <div
                  :class="[typeColors[item.type], 'h-full transition-all']"
                  :style="{ width: item.percentage + '%' }"
                ></div>
              </div>
              <div class="w-16 text-right text-sm text-white">{{ item.count }}</div>
              <div class="w-12 text-right text-xs text-gray-400">{{ item.percentage }}%</div>
            </div>
          </div>
        </div>

        <!-- Tasks by Status -->
        <div class="bg-gray-700 rounded-lg p-4">
          <h3 class="text-lg font-semibold text-white mb-4">Tareas por Estado</h3>
          <div class="space-y-2">
            <div
              v-for="item in tasksByStatusChartData"
              :key="item.status"
              class="flex items-center gap-3"
            >
              <div class="w-24 text-sm text-gray-300">{{ statusLabels[item.status] || item.status }}</div>
              <div class="flex-1 bg-gray-600 rounded-full h-4 overflow-hidden">
                <div
                  :class="[statusColors[item.status], 'h-full transition-all']"
                  :style="{ width: item.percentage + '%' }"
                ></div>
              </div>
              <div class="w-16 text-right text-sm text-white">{{ item.count }}</div>
              <div class="w-12 text-right text-xs text-gray-400">{{ item.percentage }}%</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Top Agents Table -->
      <div class="bg-gray-700 rounded-lg p-4">
        <h3 class="text-lg font-semibold text-white mb-4">🏆 Ranking de Agentes</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-gray-400 border-b border-gray-600">
                <th class="pb-2 pr-4">#</th>
                <th class="pb-2 pr-4">Agente</th>
                <th class="pb-2 pr-4">Rol</th>
                <th class="pb-2 pr-4 text-center">Total</th>
                <th class="pb-2 pr-4 text-center">✅ Completadas</th>
                <th class="pb-2 pr-4 text-center">❌ Fallidas</th>
                <th class="pb-2 pr-4 text-center">Tasa Éxito</th>
                <th class="pb-2 pr-4 text-center">Duración Promedio</th>
                <th class="pb-2 pr-4">Última Actividad</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(agent, index) in systemMetrics.topAgents"
                :key="agent.agentId"
                class="border-b border-gray-600 last:border-0"
              >
                <td class="py-2 pr-4 text-gray-400">
                  <span v-if="index < 3" class="text-lg">
                    {{ index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉' }}
                  </span>
                  <span v-else>{{ index + 1 }}</span>
                </td>
                <td class="py-2 pr-4 text-white font-medium">{{ agent.agentName }}</td>
                <td class="py-2 pr-4 text-gray-300">{{ agent.agentRole }}</td>
                <td class="py-2 pr-4 text-center text-white">{{ agent.tasksTotal }}</td>
                <td class="py-2 pr-4 text-center text-green-400">{{ agent.tasksCompleted }}</td>
                <td class="py-2 pr-4 text-center text-red-400">{{ agent.tasksFailed }}</td>
                <td class="py-2 pr-4 text-center">
                  <span
                    :class="agent.successRate >= 80 ? 'text-green-400' : agent.successRate >= 50 ? 'text-yellow-400' : 'text-red-400'"
                  >
                    {{ agent.successRate }}%
                  </span>
                </td>
                <td class="py-2 pr-4 text-center text-gray-300">{{ formatDuration(agent.averageDuration) }}</td>
                <td class="py-2 text-gray-400 text-xs">{{ formatDate(agent.lastActivity) }}</td>
              </tr>
              <tr v-if="systemMetrics.topAgents.length === 0">
                <td colspan="9" class="py-4 text-center text-gray-400">
                  No hay datos de agentes disponibles
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- All Agents Grid -->
      <div v-if="agentMetrics.length > 0" class="bg-gray-700 rounded-lg p-4">
        <h3 class="text-lg font-semibold text-white mb-4">Todos los Agentes</h3>
        <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div
            v-for="agent in agentMetrics"
            :key="agent.agentId"
            class="bg-gray-800 rounded-lg p-3 border border-gray-600"
          >
            <div class="flex items-center justify-between mb-2">
              <div class="text-white font-medium">{{ agent.agentName }}</div>
              <div class="text-xs px-2 py-1 rounded" :class="{
                'bg-green-900 text-green-300': agent.currentStatus === 'active',
                'bg-yellow-900 text-yellow-300': agent.currentStatus === 'idle',
                'bg-gray-600 text-gray-300': agent.currentStatus === 'offline'
              }">
                {{ agent.currentStatus }}
              </div>
            </div>
            <div class="text-sm text-gray-400 mb-2">{{ agent.agentRole }}</div>
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span class="text-gray-500">Total:</span>
                <span class="text-white ml-1">{{ agent.tasksTotal }}</span>
              </div>
              <div>
                <span class="text-gray-500">Completadas:</span>
                <span class="text-green-400 ml-1">{{ agent.tasksCompleted }}</span>
              </div>
              <div>
                <span class="text-gray-500">Fallidas:</span>
                <span class="text-red-400 ml-1">{{ agent.tasksFailed }}</span>
              </div>
              <div>
                <span class="text-gray-500">Éxito:</span>
                <span class="text-white ml-1">{{ agent.successRate }}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
