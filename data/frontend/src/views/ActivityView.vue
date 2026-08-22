<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { activityService, agentsService, tasksService } from '@/services/api'
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

// Tooltip de zona (hover en el mapa): posición en pantalla + resumen
const zoneTooltip = ref<{ name: string; zoneId: string; x: number; y: number } | null>(null)

// Filtro activo del feed ('' = todos)
const activeFilter = ref('')

// Ticker para refrescar timestamps relativos cada 30s
const now = ref(Date.now())
let ticker: number | null = null

const typeBars = {
  mission: 'border-l-blue-500',
  task: 'border-l-green-500',
  agent: 'border-l-purple-500',
  container: 'border-l-yellow-500'
}

const typeIcons = {
  mission: '🎯',
  task: '✓',
  agent: '🤖',
  container: '📦'
}

const filterOptions = [
  { id: '', label: 'Todos', icon: '.stack' },
  { id: 'mission', label: 'Misiones', icon: '🎯' },
  { id: 'task', label: 'Tareas', icon: '✓' },
  { id: 'agent', label: 'Agentes', icon: '🤖' },
  { id: 'container', label: 'Containers', icon: '📦' }
]

// ── Helpers de tiempo ──

// Timestamp relativo: "hace 30s", "hace 5 min", "hace 2 h", "21/8 19:38"
const timeAgo = (timestamp: string | Date | undefined): string => {
  if (!timestamp) return '-'
  try {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
    if (isNaN(date.getTime())) return '-'
    const diffMs = now.value - date.getTime()
    const diffS = Math.floor(diffMs / 1000)
    if (diffS < 10) return 'ahora'
    if (diffS < 60) return `hace ${diffS}s`
    const diffMin = Math.floor(diffS / 60)
    if (diffMin < 60) return `hace ${diffMin} min`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return `hace ${diffH} h`
    return date.toLocaleDateString('es', { day: 'numeric', month: 'short' }) +
      ' ' + date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return '-'
  }
}

// Etiqueta de grupo temporal para separadores de la timeline
const groupLabel = (timestamp: string | Date | undefined): string => {
  if (!timestamp) return ''
  try {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
    if (isNaN(date.getTime())) return ''
    const diffMin = Math.floor((now.value - date.getTime()) / 60000)
    if (diffMin < 2) return 'Ahora'
    if (diffMin < 60) return 'Hace unos minutos'
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return diffH === 1 ? 'Hace una hora' : `Hace ${diffH} horas`
    return date.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })
  } catch {
    return ''
  }
}

// ¿Mostrar separador antes de esta actividad? (cuando cambia el grupo vs la anterior)
const showSeparator = (index: number): boolean => {
  if (index === 0) return true
  const current = filteredActivities.value[index]
  const prev = filteredActivities.value[index - 1]
  return groupLabel(current.timestamp) !== groupLabel(prev.timestamp)
}

// ── Computed ──

// Actividades filtradas por tipo
const filteredActivities = computed<Activity[]>(() => {
  if (!activeFilter.value) return activities.value
  return activities.value.filter(a => a.type === activeFilter.value)
})

// Métricas para el header compacto
const activeAgentCount = computed(() =>
  agents.value.filter(a => a.status === 'active').length
)
const runningTaskCount = computed(() =>
  tasks.value.filter(t => t.status === 'in_progress').length
)

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

// ── Data fetching ──

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

const fetchAgents = async () => {
  try {
    const response = await agentsService.getAll()
    agents.value = response.data
  } catch (err) {
    console.error('Error fetching agents:', err)
  }
}

const fetchTasks = async () => {
  try {
    const response = await tasksService.getAll()
    tasks.value = response.data
  } catch (err) {
    console.error('Error fetching tasks:', err)
  }
}

// ── SSE ──

const connectStream = () => {
  try {
    eventSource.value = activityService.subscribe()

    eventSource.value.onopen = () => {
      connected.value = true
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

    eventSource.value.onerror = () => {
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

// ── Interacción ──

const handleAgentClick = (agent: Agent) => {
  selectedAgent.value = agent
  selectedZone.value = null
}

const handleZoneClick = (zone: any) => {
  selectedZone.value = zone.id
  selectedAgent.value = null
}

const handleZoneHover = (payload: { zoneId: string; name: string; screenX: number; screenY: number }) => {
  zoneTooltip.value = { zoneId: payload.zoneId, name: payload.name, x: payload.screenX, y: payload.screenY }
}

const handleZoneLeave = () => {
  zoneTooltip.value = null
}

// Agentes para el tooltip (según la zona hovered)
const tooltipAgents = computed<Agent[]>(() => {
  if (!zoneTooltip.value) return []
  const zoneId = zoneTooltip.value.zoneId
  if (zoneId === 'work-control') return agentsByZone.value.workControl
  if (zoneId === 'work-area') return agentsByZone.value.workArea
  return agentsByZone.value.lounge
})

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
  // Refrescar timestamps relativos
  ticker = window.setInterval(() => { now.value = Date.now() }, 30000)
})

onUnmounted(() => {
  disconnectStream()
  stopPolling()
  if (ticker) clearInterval(ticker)
})
</script>

<template>
  <div class="activity-view h-screen flex">
    <!-- Mapa Isométrico — protagonista, pantalla completa -->
    <div class="flex-1 relative">
      <IsometricMap
        :agents="agents"
        :tasks="tasks"
        @agent-click="handleAgentClick"
        @zone-click="handleZoneClick"
        @zone-hover="handleZoneHover"
        @zone-leave="handleZoneLeave"
      />

      <!-- Tooltip flotante de zona (hover) -->
      <div
        v-if="zoneTooltip"
        class="absolute z-20 pointer-events-none bg-slate-950/90 backdrop-blur border border-slate-700/70 rounded-xl shadow-xl px-3.5 py-2.5 min-w-[180px] max-w-[260px]"
        :style="{ left: (zoneTooltip.x + 14) + 'px', top: (zoneTooltip.y + 14) + 'px' }"
      >
        <p class="text-xs font-semibold text-slate-200 tracking-wide">{{ zoneTooltip.name }}</p>
        <p class="text-[10px] text-slate-500 mt-0.5">{{ tooltipAgents.length }} agente{{ tooltipAgents.length === 1 ? '' : 's' }}</p>
        <div v-if="tooltipAgents.length > 0" class="mt-1.5 space-y-1">
          <div v-for="a in tooltipAgents.slice(0, 4)" :key="a._id" class="text-[11px] leading-tight">
            <span class="text-slate-300">{{ a.name }}</span>
            <span v-if="getAgentTask(a)" class="text-slate-500"> — {{ getAgentTask(a)!.title.slice(0, 28) }}…</span>
          </div>
          <p v-if="tooltipAgents.length > 4" class="text-[10px] text-slate-600">+{{ tooltipAgents.length - 4 }} más</p>
        </div>
      </div>

      <!-- Header compacto translúcido -->
      <div class="absolute top-0 left-0 right-0 z-10">
        <div class="mx-4 mt-4 px-4 py-2.5 rounded-xl bg-slate-900/80 backdrop-blur-md border border-slate-700/60 shadow-lg flex items-center justify-between gap-4">
          <div class="flex items-center gap-4 min-w-0">
            <h1 class="text-lg font-semibold text-white whitespace-nowrap">Actividad HQ</h1>

            <!-- Métricas inline -->
            <div class="flex items-center gap-2 text-sm">
              <span
                class="flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium"
                :class="connected ? 'bg-green-900/50 text-green-300' : 'bg-gray-800 text-gray-400'"
              >
                <span
                  class="w-1.5 h-1.5 rounded-full"
                  :class="connected ? 'bg-green-400 animate-pulse' : 'bg-gray-500'"
                ></span>
                {{ connected ? 'Live' : 'Offline' }}
              </span>
              <span class="px-2.5 py-1 rounded-full bg-purple-900/40 text-purple-300">
                🤖 {{ activeAgentCount }} activos
              </span>
              <span class="px-2.5 py-1 rounded-full bg-blue-900/40 text-blue-300 hidden sm:inline-flex">
                ⚡ {{ runningTaskCount }} en curso
              </span>
            </div>
          </div>

          <div class="flex gap-2 shrink-0">
            <button
              @click="showActivityLog = !showActivityLog"
              class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm rounded-lg transition border border-slate-600/50"
            >
              {{ showActivityLog ? 'Ocultar panel' : 'Ver panel' }}
            </button>
            <button
              v-if="!connected"
              @click="connectStream"
              class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition"
            >
              Reconectar
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Panel Lateral: Timeline moderna -->
    <div
      v-if="showActivityLog"
      class="w-96 bg-slate-900 border-l border-slate-700/60 flex flex-col"
    >
      <!-- Detalle de agente seleccionado -->
      <div v-if="selectedAgent" class="m-3 p-4 rounded-xl bg-slate-800/80 border border-slate-700/60">
        <div class="flex justify-between items-start mb-3">
          <div>
            <h3 class="text-base font-semibold text-white">{{ selectedAgent.name }}</h3>
            <p class="text-slate-400 text-xs">{{ selectedAgent.role || 'Sin rol' }}</p>
          </div>
          <button
            @click="selectedAgent = null"
            class="text-slate-500 hover:text-white text-sm"
          >
            ✕
          </button>
        </div>

        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="p-2 rounded-lg bg-slate-900/70">
            <p class="text-slate-500">Ubicación</p>
            <p
              class="font-medium mt-0.5"
              :class="{
                'text-purple-400': getAgentZone(selectedAgent) === 'work-control',
                'text-green-400': getAgentZone(selectedAgent) === 'work-area',
                'text-amber-400': getAgentZone(selectedAgent) === 'lounge'
              }"
            >
              {{ getAgentZone(selectedAgent) === 'work-control' ? '🎯 Control' :
                 getAgentZone(selectedAgent) === 'work-area' ? '⚡ Trabajando' : '☕ Lounge' }}
            </p>
          </div>
          <div class="p-2 rounded-lg bg-slate-900/70">
            <p class="text-slate-500">Estado</p>
            <p class="font-medium mt-0.5 flex items-center gap-1.5"
               :class="{
                 'text-green-400': selectedAgent.status === 'active',
                 'text-slate-400': selectedAgent.status === 'inactive' || selectedAgent.status === 'offline',
                 'text-red-400': selectedAgent.status === 'error' || selectedAgent.status === 'failed'
               }"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-current inline-block"></span>
              {{ selectedAgent.status }}
            </p>
          </div>
        </div>

        <div v-if="getAgentTask(selectedAgent)" class="mt-3 p-2.5 rounded-lg bg-slate-900/70 border border-slate-700/40">
          <p class="text-slate-500 text-xs mb-1">Tarea actual</p>
          <p class="text-white text-sm font-medium leading-snug">{{ getAgentTask(selectedAgent)?.title }}</p>
          <div class="flex items-center gap-2 mt-1.5">
            <span class="text-xs px-2 py-0.5 rounded-full"
              :class="{
                'bg-yellow-900/50 text-yellow-300': getAgentTask(selectedAgent)?.status === 'pending',
                'bg-green-900/50 text-green-300': getAgentTask(selectedAgent)?.status === 'in_progress'
              }"
            >
              {{ getAgentTask(selectedAgent)?.status }}
            </span>
            <span v-if="getAgentTask(selectedAgent)?.type" class="text-xs text-slate-500 font-mono">
              {{ getAgentTask(selectedAgent)?.type }}
            </span>
          </div>
        </div>
        <div v-else class="mt-3 p-2.5 rounded-lg border border-dashed border-slate-700/60 text-center">
          <p class="text-slate-500 text-xs">
            {{ getAgentZone(selectedAgent) === 'lounge' ? '☕ Esperando asignación' : '⏳ Pendiente de inicio' }}
          </p>
        </div>
      </div>

      <!-- Detalle de zona seleccionada -->
      <div v-else-if="selectedZone" class="m-3 p-4 rounded-xl bg-slate-800/80 border border-slate-700/60">
        <div class="flex justify-between items-start mb-2">
          <h3 class="text-base font-semibold text-white">
            {{ selectedZone === 'work-control' ? '🎯 Control' :
               selectedZone === 'work-area' ? '⚡ Área de trabajo' : '☕ Lounge' }}
          </h3>
          <button @click="selectedZone = null" class="text-slate-500 hover:text-white text-sm">✕</button>
        </div>
        <p class="text-slate-400 text-xs mb-3">
          {{ selectedZone === 'work-control' ? 'Agentes con tareas asignadas esperando inicio' :
             selectedZone === 'work-area' ? 'Agentes ejecutando tareas' :
             'Agentes disponibles sin tareas asignadas' }}
        </p>
        <div class="space-y-1.5">
          <button
            v-for="agent in (selectedZone === 'work-control' ? agentsByZone.workControl :
                             selectedZone === 'work-area' ? agentsByZone.workArea :
                             agentsByZone.lounge)"
            :key="agent._id"
            class="w-full p-2 rounded-lg bg-slate-900/70 border border-slate-700/40 text-left hover:border-slate-500 transition"
            @click="selectedAgent = agent; selectedZone = null"
          >
            <div class="flex justify-between items-center">
              <span class="text-white text-sm">{{ agent.name }}</span>
              <span class="text-xs text-slate-500">{{ agent.role || 'Agent' }}</span>
            </div>
          </button>
          <p
            v-if="(selectedZone === 'work-control' && agentsByZone.workControl.length === 0) ||
                  (selectedZone === 'work-area' && agentsByZone.workArea.length === 0) ||
                  (selectedZone === 'lounge' && agentsByZone.lounge.length === 0)"
            class="text-slate-500 text-xs text-center py-2"
          >
            No hay agentes en esta zona
          </p>
        </div>
      </div>

      <!-- Header del feed con filtros -->
      <div class="px-3 pt-3 pb-2 border-b border-slate-700/60">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-sm font-semibold text-slate-200 uppercase tracking-wide">
            Actividad
          </h2>
          <span class="text-xs text-slate-500">{{ filteredActivities.length }} eventos</span>
        </div>
        <div class="flex gap-1 flex-wrap">
          <button
            v-for="opt in filterOptions"
            :key="opt.id"
            @click="activeFilter = opt.id"
            class="px-2.5 py-1 rounded-full text-xs font-medium transition border"
            :class="activeFilter === opt.id
              ? 'bg-slate-700 text-white border-slate-500'
              : 'bg-slate-900/60 text-slate-400 border-slate-700/50 hover:text-slate-200'"
          >
            {{ opt.icon }} {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- Feed: timeline agrupada -->
      <div class="flex-1 overflow-y-auto">
        <div v-if="error" class="m-3 p-3 rounded-lg bg-red-900/30 border border-red-800/60">
          <p class="text-red-400 text-sm">{{ error }}</p>
        </div>

        <div v-if="loading" class="py-12 text-center">
          <div class="inline-block w-6 h-6 border-2 border-slate-600 border-t-blue-400 rounded-full animate-spin"></div>
          <p class="text-slate-500 text-sm mt-2">Cargando actividad…</p>
        </div>

        <div v-else-if="filteredActivities.length === 0" class="py-12 px-6 text-center">
          <span class="text-4xl">📡</span>
          <p class="text-slate-400 text-sm mt-3">
            {{ activeFilter ? 'Sin eventos de este tipo' : 'Sin actividad aún' }}
          </p>
          <p class="text-slate-600 text-xs mt-1">
            Lanzá una misión para ver al equipo en acción
          </p>
        </div>

        <TransitionGroup
          v-else
          name="feed"
          tag="div"
          class="px-3 py-3 space-y-1"
        >
          <template v-for="(activity, index) in filteredActivities" :key="activity._id">
            <!-- Separador de grupo temporal -->
            <div v-if="showSeparator(index)" class="flex items-center gap-2 pt-3 pb-1 first:pt-0">
              <span class="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                {{ groupLabel(activity.timestamp) }}
              </span>
              <span class="flex-1 h-px bg-slate-700/50"></span>
            </div>

            <!-- Card de evento -->
            <div
              class="group flex gap-2.5 py-2 pl-3 pr-2 rounded-r-lg border-l-2 bg-slate-800/40 hover:bg-slate-800/80 transition-colors"
              :class="typeBars[activity.type]"
            >
              <div class="flex-shrink-0 pt-0.5 text-sm">{{ typeIcons[activity.type] }}</div>
              <div class="flex-1 min-w-0">
                <p class="text-slate-200 text-[13px] leading-snug break-words">
                  {{ activity.message }}
                </p>
                <p class="text-slate-500 text-[11px] mt-0.5">
                  {{ timeAgo(activity.timestamp) }}
                </p>
              </div>
            </div>
          </template>
        </TransitionGroup>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Animación de entrada de eventos nuevos (SSE) */
.feed-enter-active {
  transition: all 0.35s ease-out;
}
.feed-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}
.feed-leave-active {
  transition: all 0.2s ease-in;
}
.feed-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
.feed-move {
  transition: transform 0.3s ease;
}
</style>
