<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { activityService, agentsService } from '@/services/api'
import IsometricMap from '@/components/isometric/IsometricMap.vue'

interface Activity {
  _id: string
  type: 'mission' | 'task' | 'agent' | 'container'
  message: string
  timestamp: string
  details?: Record<string, any>
}

interface Agent {
  _id: string
  name: string
  role?: string
  status: string
  containerId?: string
}

interface Task {
  _id: string
  title: string
  assignedTo?: string
  status: string
  missionId: string
  type?: string
}

interface ZoneAgents {
  workControl: Agent[]
  workArea: Agent[]
  lounge: Agent[]
}

const activities = ref<Activity[]>([])
const agents = ref<Agent[]>([])
const tasks = ref<Task[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const eventSource = ref<EventSource | null>(null)
const connected = ref(false)

const selectedAgent = ref<Agent | null>(null)
const selectedZone = ref<string | null>(null)
const showActivityLog = ref(true)

const typeColors = {
  mission: 'text-blue-400 bg-blue-900/30 border-blue-800',
  task: 'text-green-400 bg-green-900/30 border-green-800',
  agent: 'text-purple-400 bg-purple-900/30 border-purple-800',
  container: 'text-yellow-400 bg-yellow-900/30 border-yellow-800'
}

const typeIcons = {
  mission: '🎯',
  task: '✓',
  agent: '🤖',
  container: '📦'
}

// Format timestamp safely
const formatTimestamp = (timestamp: string | Date | undefined) => {
  if (!timestamp) return '-'
  try {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
    if (isNaN(date.getTime())) return '-'
    return date.toLocaleString()
  } catch {
    return '-'
  }
}

// Agrupar agentes por zona
const agentsByZone = computed<ZoneAgents>(() => {
  const result: ZoneAgents = {
    workControl: [],
    workArea: [],
    lounge: []
  }

  agents.value.forEach(agent => {
    const zone = getAgentZone(agent)
    if (zone === 'work-control') {
      result.workControl.push(agent)
    } else if (zone === 'work-area') {
      result.workArea.push(agent)
    } else {
      result.lounge.push(agent)
    }
  })

  return result
})

// Obtener zona de un agente
function getAgentZone(agent: Agent): string {
  if (!agent.containerId || agent.status === 'offline' || agent.status === 'inactive') {
    return 'lounge'
  }

  const hasPendingTask = tasks.value.some(
    t => t.assignedTo === agent.containerId && t.status === 'pending'
  )

  const hasInProgressTask = tasks.value.some(
    t => t.assignedTo === agent.containerId && t.status === 'in_progress'
  )

  if (hasPendingTask) return 'work-control'
  if (hasInProgressTask) return 'work-area'
  return 'lounge'
}

// Obtener tarea actual de un agente
function getAgentTask(agent: Agent): Task | null {
  if (!agent.containerId) return null
  return tasks.value.find(
    t => t.assignedTo === agent.containerId && (t.status === 'pending' || t.status === 'in_progress')
  ) || null
}

// Fetch activities
const fetchActivities = async () => {
  try {
    loading.value = true
    error.value = null
    const response = await activityService.getAll()
    activities.value = response.data
  } catch (err) {
    error.value = 'Error al cargar actividad'
    console.error(err)
  } finally {
    loading.value = false
  }
}

// Fetch agents
const fetchAgents = async () => {
  try {
    const response = await agentsService.getAll()
    agents.value = response.data
  } catch (err) {
    console.error('Error fetching agents:', err)
  }
}

// Fetch tasks
const fetchTasks = async () => {
  try {
    const { tasksService } = await import('@/services/api')
    const response = await tasksService.getAll()
    tasks.value = response.data
  } catch (err) {
    console.error('Error fetching tasks:', err)
  }
}

// Connect to SSE stream
const connectStream = () => {
  try {
    eventSource.value = activityService.subscribe()

    eventSource.value.onopen = () => {
      connected.value = true
      console.log('SSE connected')
    }

    eventSource.value.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'heartbeat') return

        activities.value.unshift(data)
        if (activities.value.length > 50) {
          activities.value = activities.value.slice(0, 50)
        }
      } catch (e) {
        console.error('Error parsing SSE data:', e)
      }
    }

    eventSource.value.onerror = (err) => {
      console.error('SSE error:', err)
      connected.value = false
    }
  } catch (err) {
    console.error('Error connecting to stream:', err)
  }
}

const disconnectStream = () => {
  if (eventSource.value) {
    eventSource.value.close()
    eventSource.value = null
    connected.value = false
  }
}

// Handle agent click
const handleAgentClick = (agent: Agent) => {
  selectedAgent.value = agent
  selectedZone.value = null
}

// Handle zone click
const handleZoneClick = (zone: any) => {
  selectedZone.value = zone.id
  selectedAgent.value = null
}

// Poll agents status
let pollInterval: number | null = null
const startPolling = () => {
  pollInterval = window.setInterval(async () => {
    await Promise.all([fetchAgents(), fetchTasks()])
  }, 5000)
}

const stopPolling = () => {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

onMounted(async () => {
  await Promise.all([fetchActivities(), fetchAgents(), fetchTasks()])
  connectStream()
  startPolling()
})

onUnmounted(() => {
  disconnectStream()
  stopPolling()
})
</script>

<template>
  <div class="activity-view h-screen flex">
    <!-- Mapa Isométrico -->
    <div class="flex-1 relative">
      <IsometricMap
        :agents="agents"
        :tasks="tasks"
        @agent-click="handleAgentClick"
        @zone-click="handleZoneClick"
      />

      <!-- Header overlay -->
      <div class="absolute top-0 left-0 right-0 p-6 bg-gradient-to-b from-gray-900 via-gray-900/95 to-transparent pointer-events-none">
        <header class="flex justify-between items-center">
          <div class="pointer-events-auto">
            <h1 class="text-3xl font-bold text-white">🍷 HQ Bar - Activity Hub</h1>
            <p class="text-gray-400 mt-1 flex items-center gap-2">
              Watch your agents work at the bar
              <span v-if="connected" class="flex items-center gap-1 text-green-400 text-sm">
                <span class="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                Live
              </span>
              <span v-else class="flex items-center gap-1 text-gray-500 text-sm">
                <span class="w-2 h-2 bg-gray-500 rounded-full"></span>
                Offline
              </span>
            </p>
          </div>

          <div class="flex gap-2 pointer-events-auto">
            <button
              @click="showActivityLog = !showActivityLog"
              class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
            >
              {{ showActivityLog ? 'Ocultar' : 'Mostrar' }} Log
            </button>
            <button
              v-if="!connected"
              @click="connectStream"
              class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
            >
              Reconectar
            </button>
          </div>
        </header>

        <!-- Zone Summary -->
        <div class="mt-4 flex gap-3">
          <div class="px-4 py-2 bg-purple-900/40 rounded-lg border border-purple-700/50">
            <span class="text-purple-400 font-semibold">🎯 Work Control:</span>
            <span class="text-white ml-2">{{ agentsByZone.workControl.length }} agentes</span>
          </div>
          <div class="px-4 py-2 bg-green-900/40 rounded-lg border border-green-700/50">
            <span class="text-green-400 font-semibold">⚡ Work Area:</span>
            <span class="text-white ml-2">{{ agentsByZone.workArea.length }} agentes</span>
          </div>
          <div class="px-4 py-2 bg-amber-900/40 rounded-lg border border-amber-700/50">
            <span class="text-amber-400 font-semibold">☕ Lounge:</span>
            <span class="text-white ml-2">{{ agentsByZone.lounge.length }} agentes</span>
          </div>
        </div>

        <!-- Agentes en pantalla rápida -->
        <div class="mt-3 flex gap-2 flex-wrap">
          <div
            v-for="agent in agentsByZone.workControl"
            :key="'wc-' + agent._id"
            class="px-3 py-1 bg-purple-900/60 rounded-full text-sm border border-purple-600"
          >
            <span class="text-purple-300">{{ agent.name }}</span>
            <span class="text-purple-400 ml-1">⏳</span>
          </div>
          <div
            v-for="agent in agentsByZone.workArea"
            :key="'wa-' + agent._id"
            class="px-3 py-1 bg-green-900/60 rounded-full text-sm border border-green-600"
          >
            <span class="text-green-300">{{ agent.name }}</span>
            <span class="text-green-400 ml-1">⚡</span>
          </div>
          <div v-if="agents.length === 0" class="text-gray-500 text-sm">
            No hay agentes creados aún
          </div>
        </div>
      </div>
    </div>

    <!-- Panel Lateral: Activity Log + Agent Details -->
    <div
      v-if="showActivityLog"
      class="w-96 bg-gray-800 border-l border-gray-700 flex flex-col"
    >
      <!-- Agent Details (si seleccionado) -->
      <div v-if="selectedAgent" class="p-4 border-b border-gray-700 bg-gray-750">
        <div class="flex justify-between items-start mb-3">
          <div>
            <h3 class="text-lg font-semibold text-white">{{ selectedAgent.name }}</h3>
            <p class="text-gray-400 text-sm">{{ selectedAgent.role || 'Sin rol' }}</p>
          </div>
          <button
            @click="selectedAgent = null"
            class="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <!-- Estado y ubicación -->
        <div class="space-y-2 text-sm">
          <div class="flex justify-between items-center">
            <span class="text-gray-400">Ubicación:</span>
            <span
              :class="{
                'text-purple-400': getAgentZone(selectedAgent) === 'work-control',
                'text-green-400': getAgentZone(selectedAgent) === 'work-area',
                'text-amber-400': getAgentZone(selectedAgent) === 'lounge'
              }"
            >
              {{
                getAgentZone(selectedAgent) === 'work-control' ? '🎯 Work Control' :
                getAgentZone(selectedAgent) === 'work-area' ? '⚡ Work Area' :
                '☕ Lounge'
              }}
            </span>
          </div>

          <div class="flex justify-between items-center">
            <span class="text-gray-400">Estado:</span>
            <span
              :class="{
                'text-green-400': selectedAgent.status === 'active',
                'text-gray-400': selectedAgent.status === 'inactive' || selectedAgent.status === 'offline',
                'text-red-400': selectedAgent.status === 'error' || selectedAgent.status === 'failed'
              }"
            >
              {{ selectedAgent.status }}
            </span>
          </div>

          <div class="flex justify-between">
            <span class="text-gray-400">Container:</span>
            <span class="text-white font-mono text-xs truncate max-w-[150px]">
              {{ selectedAgent.containerId || 'N/A' }}
            </span>
          </div>

          <!-- Tarea actual -->
          <div v-if="getAgentTask(selectedAgent)" class="mt-3 p-2 bg-gray-900 rounded border border-gray-700">
            <p class="text-gray-400 text-xs mb-1">Tarea actual:</p>
            <p class="text-white text-sm font-medium">{{ getAgentTask(selectedAgent)?.title }}</p>
            <div class="flex items-center gap-2 mt-1">
              <span
                :class="{
                  'text-yellow-400': getAgentTask(selectedAgent)?.status === 'pending',
                  'text-green-400': getAgentTask(selectedAgent)?.status === 'in_progress',
                  'text-gray-400': getAgentTask(selectedAgent)?.status === 'completed'
                }"
                class="text-xs"
              >
                {{ getAgentTask(selectedAgent)?.status }}
              </span>
              <span v-if="getAgentTask(selectedAgent)?.type" class="text-xs text-gray-500">
                {{ getAgentTask(selectedAgent)?.type }}
              </span>
            </div>
          </div>

          <!-- Sin tarea -->
          <div v-else class="mt-3 p-2 bg-gray-900/50 rounded border border-dashed border-gray-700">
            <p class="text-gray-500 text-sm text-center">
              {{ getAgentZone(selectedAgent) === 'lounge' ? '☺ Esperando asignación de tarea' : '⏳ Tarea asignada, pendiente de inicio' }}
            </p>
          </div>
        </div>
      </div>

      <!-- Zone Details (si zona seleccionada) -->
      <div v-else-if="selectedZone" class="p-4 border-b border-gray-700 bg-gray-750">
        <div class="flex justify-between items-start mb-3">
          <h3 class="text-lg font-semibold text-white">
            {{
              selectedZone === 'work-control' ? '🎯 Work Control' :
              selectedZone === 'work-area' ? '⚡ Work Area' :
              '☕ Lounge'
            }}
          </h3>
          <button
            @click="selectedZone = null"
            class="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <p class="text-gray-400 text-sm mb-3">
          {{
            selectedZone === 'work-control' ? 'Agentes con tareas asignadas esperando inicio' :
            selectedZone === 'work-area' ? 'Agentes ejecutando tareas' :
            'Agentes disponibles sin tareas asignadas'
          }}
        </p>

        <div class="space-y-2">
          <div
            v-for="agent in (selectedZone === 'work-control' ? agentsByZone.workControl :
                             selectedZone === 'work-area' ? agentsByZone.workArea :
                             agentsByZone.lounge)"
            :key="agent._id"
            class="p-2 bg-gray-900 rounded border border-gray-700 cursor-pointer hover:border-gray-600"
            @click="selectedAgent = agent; selectedZone = null"
          >
            <div class="flex justify-between items-center">
              <span class="text-white text-sm">{{ agent.name }}</span>
              <span class="text-xs text-gray-500">{{ agent.role || 'Agent' }}</span>
            </div>
            <div v-if="getAgentTask(agent)" class="mt-1 text-xs text-gray-400 truncate">
              {{ getAgentTask(agent)?.title }}
            </div>
          </div>
          <div v-if="(
            selectedZone === 'work-control' && agentsByZone.workControl.length === 0
          ) || (
            selectedZone === 'work-area' && agentsByZone.workArea.length === 0
          ) || (
            selectedZone === 'lounge' && agentsByZone.lounge.length === 0
          )" class="text-gray-500 text-sm text-center py-2">
            No hay agentes en esta zona
          </div>
        </div>
      </div>

      <!-- Activity Feed -->
      <div class="flex-1 overflow-y-auto">
        <div class="p-4 border-b border-gray-700 sticky top-0 bg-gray-800 z-10">
          <h2 class="text-lg font-semibold text-white">Activity Feed</h2>
        </div>

        <div v-if="error" class="p-4 bg-red-900/30 border-b border-red-800">
          <p class="text-red-400 text-sm">{{ error }}</p>
        </div>

        <div v-if="loading" class="p-8 text-center">
          <p class="text-gray-400">Cargando...</p>
        </div>

        <div v-else class="p-4 space-y-3">
          <div v-if="activities.length === 0" class="text-center py-8">
            <p class="text-gray-500 text-sm">No hay actividad reciente</p>
          </div>

          <div
            v-for="activity in activities"
            :key="activity._id"
            class="bg-gray-900 rounded-lg p-3 border border-gray-700"
          >
            <div class="flex gap-3">
              <div class="flex-shrink-0">
                <div :class="['w-8 h-8 rounded-full flex items-center justify-center text-sm border', typeColors[activity.type]]">
                  {{ typeIcons[activity.type] }}
                </div>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-white text-sm break-words">{{ activity.message }}</p>
                <p class="text-gray-500 text-xs mt-1">
                  {{ formatTimestamp(activity.timestamp) }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bg-gray-750 {
  background-color: #2d3748;
}
</style>
