<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { missionsService } from '@/services/api'

interface Mission {
  _id: string
  title: string
  status: string
  priority: string
  startedAt?: string
  completedAt?: string
}

interface ProgressData {
  progress: number
  tasks: {
    total: number
    completed: number
    failed: number
    pending: number
    inProgress: number
    awaitingHuman: number
  }
  agents: {
    active: number
  }
  duration: number | null
}

interface TimelineEntry {
  timestamp: string
  action: string
  details: Record<string, any>
}

interface TimelineData {
  timeline: TimelineEntry[]
  totalEvents: number
}

const props = defineProps<{
  mission: Mission
}>()

const emit = defineEmits<{
  (e: 'refresh'): void
}>()

const loading = ref(false)
const progress = ref<ProgressData | null>(null)
const timeline = ref<TimelineData | null>(null)
const showTimeline = ref(false)

// Status-based controls
const canOrchestrate = computed(() => props.mission.status === 'draft')
const canPause = computed(() => props.mission.status === 'active')
const canResume = computed(() => props.mission.status === 'paused')
const canCancel = computed(() =>
  props.mission.status === 'active' ||
  props.mission.status === 'paused' ||
  props.mission.status === 'draft'
)

// Status badge color
const statusColor = computed(() => {
  switch (props.mission.status) {
    case 'draft': return 'bg-gray-600'
    case 'active': return 'bg-green-600'
    case 'paused': return 'bg-yellow-600'
    case 'completed': return 'bg-blue-600'
    default: return 'bg-gray-600'
  }
})

// Priority badge color
const priorityColor = computed(() => {
  switch (props.mission.priority) {
    case 'high': return 'text-red-400'
    case 'medium': return 'text-yellow-400'
    case 'low': return 'text-green-400'
    default: return 'text-gray-400'
  }
})

// Format duration
const formatDuration = (ms: number | null) => {
  if (!ms) return '-'
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

// Format timestamp
const formatTimestamp = (timestamp: string) => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString() + ' ' + date.toLocaleDateString()
}

// Action labels for timeline
const getActionLabel = (action: string) => {
  const labels: Record<string, string> = {
    orchestration_started: '🚀 Orquestación iniciada',
    mission_paused: '⏸️ Misión pausada',
    mission_resumed: '▶️ Misión reanudada',
    mission_cancelled: '❌ Misión cancelada',
    mission_completed: '✅ Misión completada',
    squad_lead_output_received: '📋 Plan recibido del Squad Lead',
    agent_created: '🤖 Agente creado',
    agent_creation_failed: '⚠️ Error creando agente',
    task_created: '📝 Tarea creada',
    task_creation_failed: '⚠️ Error creando tarea'
  }
  return labels[action] || action
}

// Fetch progress data
const fetchProgress = async () => {
  if (props.mission.status === 'draft') return

  try {
    const response = await missionsService.getProgress(props.mission._id)
    progress.value = response.data
  } catch (error) {
    console.error('Error fetching progress:', error)
  }
}

// Fetch timeline data
const fetchTimeline = async () => {
  try {
    const response = await missionsService.getTimeline(props.mission._id)
    timeline.value = response.data
  } catch (error) {
    console.error('Error fetching timeline:', error)
  }
}

// Toggle timeline view
const toggleTimeline = async () => {
  showTimeline.value = !showTimeline.value
  if (showTimeline.value && !timeline.value) {
    await fetchTimeline()
  }
}

// Actions
const orchestrate = async () => {
  loading.value = true
  try {
    await missionsService.orchestrate(props.mission._id)
    emit('refresh')
  } catch (error: any) {
    alert('Error orquestando misión: ' + (error.response?.data?.error || error.message))
  } finally {
    loading.value = false
  }
}

const pause = async () => {
  const reason = prompt('Razón para pausar (opcional):')
  loading.value = true
  try {
    await missionsService.pause(props.mission._id, reason || undefined)
    emit('refresh')
  } catch (error: any) {
    alert('Error pausando misión: ' + (error.response?.data?.error || error.message))
  } finally {
    loading.value = false
  }
}

const resume = async () => {
  loading.value = true
  try {
    await missionsService.resume(props.mission._id)
    emit('refresh')
  } catch (error: any) {
    alert('Error reanudando misión: ' + (error.response?.data?.error || error.message))
  } finally {
    loading.value = false
  }
}

const cancel = async () => {
  const reason = prompt('Razón para cancelar (opcional):')
  if (reason === null) return // User cancelled

  if (!confirm('¿Estás seguro de cancelar esta misión?')) return

  loading.value = true
  try {
    await missionsService.cancel(props.mission._id, reason || undefined)
    emit('refresh')
  } catch (error: any) {
    alert('Error cancelando misión: ' + (error.response?.data?.error || error.message))
  } finally {
    loading.value = false
  }
}

// Load progress on mount
onMounted(() => {
  fetchProgress()
})
</script>

<template>
  <div class="bg-gray-800 rounded-lg p-4 border border-gray-700 space-y-4">
    <!-- Mission Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h3 class="text-lg font-semibold text-white">{{ mission.title }}</h3>
        <span :class="[statusColor, 'px-2 py-1 rounded text-xs text-white']">
          {{ mission.status.toUpperCase() }}
        </span>
        <span :class="[priorityColor, 'text-xs font-medium']">
          {{ mission.priority.toUpperCase() }}
        </span>
      </div>
      <button
        @click="fetchProgress"
        class="text-gray-400 hover:text-white text-sm"
        title="Refrescar progreso"
      >
        🔄
      </button>
    </div>

    <!-- Progress Section -->
    <div v-if="progress && mission.status !== 'draft'" class="space-y-3">
      <!-- Progress Bar -->
      <div>
        <div class="flex justify-between text-sm text-gray-400 mb-1">
          <span>Progreso</span>
          <span>{{ progress.progress }}%</span>
        </div>
        <div class="w-full bg-gray-700 rounded-full h-2">
          <div
            class="bg-blue-600 h-2 rounded-full transition-all"
            :style="{ width: progress.progress + '%' }"
          ></div>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="grid grid-cols-3 gap-2 text-center text-sm">
        <div class="bg-gray-700 rounded p-2">
          <div class="text-gray-400">Total</div>
          <div class="text-white font-semibold">{{ progress.tasks.total }}</div>
        </div>
        <div class="bg-green-900/50 rounded p-2">
          <div class="text-green-400">Completadas</div>
          <div class="text-white font-semibold">{{ progress.tasks.completed }}</div>
        </div>
        <div class="bg-blue-900/50 rounded p-2">
          <div class="text-blue-400">En progreso</div>
          <div class="text-white font-semibold">{{ progress.tasks.inProgress }}</div>
        </div>
      </div>

      <!-- Additional Stats -->
      <div class="flex justify-between text-sm text-gray-400">
        <span>Agents activos: {{ progress.agents.active }}</span>
        <span>Duración: {{ formatDuration(progress.duration) }}</span>
      </div>

      <!-- Human Input Alert -->
      <div v-if="progress.tasks.awaitingHuman > 0" class="bg-yellow-900/50 border border-yellow-600 rounded p-3">
        <div class="flex items-center gap-2 text-yellow-400">
          <span>❓</span>
          <span class="font-medium">Esperando tu respuesta</span>
        </div>
        <p class="text-sm text-yellow-300 mt-1">
          El Squad Lead necesita información para continuar.
        </p>
      </div>
    </div>

    <!-- Timeline Section -->
    <div v-if="showTimeline && timeline" class="space-y-2 max-h-60 overflow-y-auto">
      <div class="text-sm text-gray-400 font-medium">Timeline de eventos</div>
      <div
        v-for="(entry, index) in timeline.timeline"
        :key="index"
        class="bg-gray-700 rounded p-2 text-sm"
      >
        <div class="flex justify-between text-gray-400 text-xs mb-1">
          <span>{{ getActionLabel(entry.action) }}</span>
          <span>{{ formatTimestamp(entry.timestamp) }}</span>
        </div>
        <div v-if="Object.keys(entry.details).length > 0" class="text-gray-300 text-xs">
          <pre class="whitespace-pre-wrap break-words">{{ JSON.stringify(entry.details, null, 2) }}</pre>
        </div>
      </div>
    </div>

    <!-- Control Buttons -->
    <div class="flex flex-wrap gap-2 pt-2 border-t border-gray-700">
      <!-- Orchestrate -->
      <button
        v-if="canOrchestrate"
        @click="orchestrate"
        :disabled="loading"
        class="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded text-sm font-medium"
      >
        🚀 Orquestar
      </button>

      <!-- Pause -->
      <button
        v-if="canPause"
        @click="pause"
        :disabled="loading"
        class="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 text-white rounded text-sm font-medium"
      >
        ⏸️ Pausar
      </button>

      <!-- Resume -->
      <button
        v-if="canResume"
        @click="resume"
        :disabled="loading"
        class="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded text-sm font-medium"
      >
        ▶️ Reanudar
      </button>

      <!-- Cancel -->
      <button
        v-if="canCancel"
        @click="cancel"
        :disabled="loading"
        class="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white rounded text-sm font-medium"
      >
        ❌ Cancelar
      </button>

      <!-- Timeline Toggle -->
      <button
        v-if="mission.status !== 'draft'"
        @click="toggleTimeline"
        class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm font-medium"
      >
        {{ showTimeline ? '📋 Ocultar' : '📋 Timeline' }}
      </button>
    </div>
  </div>
</template>
