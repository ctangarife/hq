<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { missionsService, tasksService, attachmentsService } from '@/services/api'
import TaskDependencyGraph from '@/components/TaskDependencyGraph.vue'
import FileUploader from '@/components/FileUploader.vue'

/**
 * MissionDetailModal — panel único de misión.
 *
 * Plega lo que antes eran 5 modales solapados (Tareas, Control, Archivos,
 * log, DAG) en tabs, y agrega la vista "Ahora": la tarea en curso con su
 * especialista + feed de tareas completadas con duración y preview del
 * output — eventos de CONTENIDO, no de infraestructura.
 *
 * Actualización en vivo vía SSE de tareas (/tasks/stream).
 */

interface Task {
  _id: string
  title: string
  description?: string
  type?: string
  status: string
  assignedTo?: string
  agentName?: string
  startedAt?: string
  completedAt?: string
  updatedAt: string
  error?: string
  output?: { success?: boolean; result?: any; duration?: number; error?: string }
}

interface Attachment {
  attachmentId: string
  type: string
  resource: { originalName: string; mimeType: string; size: number }
}

interface Progress {
  progress: number
  tasks: { total: number; completed: number; failed: number; pending: number; inProgress: number }
  duration: number | null
}

const props = defineProps<{
  mission: {
    _id: string
    title: string
    status: string
    priority?: string
    orchestrationLog?: Array<{ timestamp: string; action: string; details?: Record<string, any> }>
  }
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'refresh'): void
}>()

type Tab = 'now' | 'tasks' | 'files' | 'flow'
const activeTab = ref<Tab>('now')

const tasks = ref<Task[]>([])
const progress = ref<Progress | null>(null)
const attachments = ref<Attachment[]>([])
const loading = ref(true)
const controlBusy = ref(false)
const showLog = ref(false)
const expandedTask = ref<string | null>(null)

const authToken = typeof localStorage !== 'undefined'
  ? localStorage.getItem('hq_token') || ''
  : ''

// ── Data ──

const fetchAll = async () => {
  try {
    const [tasksRes, progressRes] = await Promise.all([
      tasksService.getByMission(props.mission._id).catch(() => ({ data: [] })),
      missionsService.getProgress(props.mission._id).catch(() => null),
    ])
    tasks.value = tasksRes.data || []
    progress.value = progressRes?.data || null
  } finally {
    loading.value = false
  }
}

const fetchAttachments = async () => {
  try {
    const res = await attachmentsService.getByMission(props.mission._id)
    attachments.value = res.data.attachments || []
  } catch {
    attachments.value = []
  }
}

onMounted(() => {
  fetchAll()
  fetchAttachments()
})

// ── SSE: refresco en vivo (debounced) ──

let eventSource: EventSource | null = null
let refetchTimer: number | null = null

const scheduleRefetch = () => {
  if (refetchTimer) return
  refetchTimer = window.setTimeout(() => {
    refetchTimer = null
    fetchAll()
  }, 1000)
}

const connectStream = () => {
  eventSource = tasksService.streamTasks()
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (['task.created', 'task.updated', 'task.status_changed', 'task.completed', 'task.failed'].includes(data.type)) {
        scheduleRefetch()
      }
    } catch { /* heartbeat u otros */ }
  }
}

connectStream()

onUnmounted(() => {
  eventSource?.close()
  if (refetchTimer) clearTimeout(refetchTimer)
})

// ── Computed ──

const inProgressTasks = computed(() => tasks.value.filter(t => t.status === 'in_progress'))
const pendingTasks = computed(() => tasks.value.filter(t => t.status === 'pending'))
const failedTasks = computed(() => tasks.value.filter(t => t.status === 'failed'))
const completedFeed = computed(() =>
  tasks.value
    .filter(t => t.status === 'completed')
    .sort((a, b) => new Date(b.completedAt || b.updatedAt).getTime() - new Date(a.completedAt || a.updatedAt).getTime()),
)

const progressPct = computed(() => progress.value?.progress ?? 0)
const taskCounts = computed(() => progress.value?.tasks ?? { total: tasks.value.length, completed: completedFeed.value.length, failed: 0, pending: 0, inProgress: 0 })

const statusColor = computed(() => {
  switch (props.mission.status) {
    case 'active': return 'bg-green-600'
    case 'paused': return 'bg-yellow-600'
    case 'completed': return 'bg-blue-600'
    default: return 'bg-gray-600'
  }
})

// ── Helpers ──

const formatDuration = (ms?: number | null) => {
  if (!ms) return null
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

const taskDuration = (t: Task) => {
  if (t.output?.duration) return formatDuration(t.output.duration)
  if (t.startedAt && t.completedAt) {
    return formatDuration(new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime())
  }
  return null
}

const elapsed = (since: string) => {
  const ms = Date.now() - new Date(since).getTime()
  return formatDuration(ms) || 'ahora'
}

const outputPreview = (t: Task) => {
  const r = t.output?.result
  return typeof r === 'string' ? r : r ? JSON.stringify(r) : ''
}

const statusChip = (status: string) => {
  const map: Record<string, string> = {
    completed: 'bg-green-900/60 text-green-300',
    in_progress: 'bg-yellow-900/60 text-yellow-300',
    pending: 'bg-gray-700 text-gray-300',
    failed: 'bg-red-900/60 text-red-300',
  }
  return map[status] || 'bg-gray-700 text-gray-300'
}

const statusLabel = (s: string) =>
  ({ in_progress: 'en curso', completed: 'completada', pending: 'pendiente', failed: 'fallida' } as Record<string, string>)[s] || s

// ── Control ──

const controlAction = async (action: 'pause' | 'resume' | 'cancel') => {
  if (action === 'cancel' && !confirm('¿Cancelar esta misión?')) return
  controlBusy.value = true
  try {
    if (action === 'pause') await missionsService.pause(props.mission._id)
    if (action === 'resume') await missionsService.resume(props.mission._id)
    if (action === 'cancel') await missionsService.cancel(props.mission._id)
    emit('refresh')
  } catch (err: any) {
    alert(err.response?.data?.error || `Error al ${action === 'pause' ? 'pausar' : action === 'resume' ? 'reanudar' : 'cancelar'}`)
  } finally {
    controlBusy.value = false
  }
}

const canPause = computed(() => props.mission.status === 'active')
const canResume = computed(() => props.mission.status === 'paused')

const removeAttachment = async (attachmentId: string) => {
  if (!confirm('¿Eliminar este archivo?')) return
  try {
    await attachmentsService.delete(attachmentId)
    await fetchAttachments()
  } catch (err: any) {
    alert(err.response?.data?.error || 'Error al eliminar')
  }
}

const formatSize = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`

// Errores técnicos → lenguaje humano (el usuario final no sabe qué es un
// "ephemeral task timeout")
const friendlyError = (e?: string): string => {
  if (!e) return 'La tarea falló'
  if (e.includes('timed out')) return 'El agente agotó su tiempo (10 min) sin terminar — se puede reintentar'
  if (e.includes('401') || e.includes('Authentication')) return 'Error de autenticación con el modelo'
  if (e.includes('429')) return 'Límite de uso del modelo alcanzado — reintentar en unos minutos'
  return e
}

const logLabels: Record<string, string> = {
  orchestration_started: '🚀 Orquestación iniciada',
  mission_paused: '⏸️ Pausada',
  mission_resumed: '▶️ Reanudada',
  mission_cancelled: '❌ Cancelada',
  mission_completed: '✅ Completada',
  squad_lead_output_received: '📋 Plan del Squad Lead',
  agent_created: '🤖 Agente creado',
  agent_creation_failed: '⚠️ Error creando agente',
  task_created: '📝 Tarea creada',
  task_creation_failed: '⚠️ Error creando tarea',
}
</script>

<template>
  <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
    <div class="bg-gray-800 rounded-xl w-full max-w-3xl border border-gray-700 max-h-[88vh] overflow-hidden flex flex-col shadow-2xl">

      <!-- Header: título + progreso + acciones -->
      <div class="p-5 border-b border-gray-700 bg-gradient-to-r from-gray-800 to-gray-900">
        <div class="flex justify-between items-start gap-3">
          <div class="min-w-0">
            <h2 class="text-lg font-bold text-white truncate flex items-center gap-2">
              {{ mission.title }}
              <span :class="['px-2 py-0.5 rounded text-xs font-medium shrink-0', statusColor]">{{ mission.status }}</span>
            </h2>
            <div class="flex items-center gap-3 mt-2 text-sm">
              <div class="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden min-w-[120px]">
                <div
                  class="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-500"
                  :style="{ width: `${progressPct}%` }"
                ></div>
              </div>
              <span class="text-gray-300 whitespace-nowrap">{{ progressPct }}% · {{ taskCounts.completed }}/{{ taskCounts.total }} tareas</span>
              <span v-if="inProgressTasks.length > 0" class="text-yellow-300 flex items-center gap-1 whitespace-nowrap">
                <span class="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse"></span> ejecutando
              </span>
            </div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button v-if="canPause" :disabled="controlBusy" @click="controlAction('pause')"
              class="px-2.5 py-1.5 bg-yellow-700/70 hover:bg-yellow-700 text-white text-xs rounded-lg transition disabled:opacity-50">⏸ Pausar</button>
            <button v-if="canResume" :disabled="controlBusy" @click="controlAction('resume')"
              class="px-2.5 py-1.5 bg-green-700/70 hover:bg-green-700 text-white text-xs rounded-lg transition disabled:opacity-50">▶ Reanudar</button>
            <button v-if="mission.status === 'active' || mission.status === 'paused'" :disabled="controlBusy" @click="controlAction('cancel')"
              class="px-2.5 py-1.5 bg-red-800/70 hover:bg-red-800 text-white text-xs rounded-lg transition disabled:opacity-50">✕ Cancelar</button>
            <button @click="emit('close')" class="text-gray-400 hover:text-white text-xl px-1" title="Cerrar">✕</button>
          </div>
        </div>

        <!-- Tabs -->
        <div class="flex gap-1 mt-4">
          <button v-for="tab in ([
            { id: 'now', label: '⚡ Ahora' },
            { id: 'tasks', label: `📋 Tareas (${tasks.length})` },
            { id: 'files', label: `📁 Archivos (${attachments.length})` },
            { id: 'flow', label: '🔀 Flujo' },
          ] as const)" :key="tab.id"
            @click="activeTab = tab.id"
            :class="[
              'px-3.5 py-1.5 rounded-lg text-sm font-medium transition',
              activeTab === tab.id ? 'bg-blue-600 text-white' : 'bg-gray-700/60 text-gray-300 hover:bg-gray-700',
            ]"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>

      <!-- Contenido -->
      <div class="flex-1 overflow-y-auto p-5">
        <div v-if="loading && activeTab !== 'flow'" class="text-center py-10 text-gray-400">Cargando…</div>

        <!-- ⚡ AHORA: la misión en vivo -->
        <div v-else-if="activeTab === 'now'" class="space-y-4">
          <!-- Ejecutando -->
          <div v-if="inProgressTasks.length > 0">
            <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Ejecutando ahora</h3>
            <div v-for="t in inProgressTasks" :key="t._id"
              class="bg-yellow-900/20 border border-yellow-700/40 rounded-lg p-4">
              <div class="flex justify-between items-start gap-2">
                <div>
                  <p class="text-white font-medium">{{ t.title }}</p>
                  <p class="text-gray-400 text-sm mt-0.5">
                    {{ t.agentName || t.type || 'especialista' }} · hace {{ elapsed(t.startedAt || t.updatedAt) }}
                  </p>
                </div>
                <span class="w-2 h-2 rounded-full bg-yellow-400 animate-pulse mt-2 shrink-0"></span>
              </div>
            </div>
          </div>

          <!-- Pendientes -->
          <div v-if="pendingTasks.length > 0">
            <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">En cola ({{ pendingTasks.length }})</h3>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="t in pendingTasks" :key="t._id"
                class="px-2.5 py-1 bg-gray-700 rounded-full text-xs text-gray-300">{{ t.title.slice(0, 40) }}</span>
            </div>
          </div>

          <!-- Fallidas -->
          <div v-if="failedTasks.length > 0">
            <h3 class="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">Fallidas ({{ failedTasks.length }})</h3>
            <div v-for="t in failedTasks" :key="t._id" class="bg-red-900/20 border border-red-800/40 rounded-lg p-3">
              <p class="text-white text-sm font-medium">{{ t.title }}</p>
              <p v-if="t.error || t.output?.error" class="text-red-300 text-xs mt-1">{{ friendlyError(t.error || t.output?.error) }}</p>
            </div>
          </div>

          <!-- Completadas: el feed de contenido -->
          <div>
            <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Completadas ({{ completedFeed.length }})
            </h3>
            <div v-if="completedFeed.length === 0" class="text-gray-500 text-sm py-4 text-center">Aún no hay tareas completadas</div>
            <div v-else class="space-y-2">
              <div v-for="t in completedFeed" :key="t._id" class="bg-gray-750/60 bg-gray-700/40 rounded-lg border border-gray-600/40">
                <button class="w-full text-left p-3 hover:bg-gray-700/60 transition rounded-lg"
                  @click="expandedTask = expandedTask === t._id ? null : t._id">
                  <div class="flex justify-between items-center gap-2">
                    <div class="min-w-0">
                      <p class="text-gray-100 text-sm font-medium truncate">✓ {{ t.title }}</p>
                      <p class="text-gray-500 text-xs mt-0.5">
                        {{ t.agentName || t.type || 'especialista' }}
                        <span v-if="taskDuration(t)"> · {{ taskDuration(t) }}</span>
                      </p>
                    </div>
                    <span class="text-gray-500 text-xs shrink-0">{{ expandedTask === t._id ? '▲' : '▼' }}</span>
                  </div>
                </button>
                <div v-if="expandedTask === t._id" class="px-3 pb-3">
                  <pre class="text-xs text-gray-300 whitespace-pre-wrap bg-gray-900/70 rounded p-3 max-h-60 overflow-y-auto">{{ outputPreview(t).slice(0, 2000) }}</pre>
                </div>
              </div>
            </div>
          </div>

          <!-- Log de orquestación (plegado) -->
          <div v-if="mission.orchestrationLog && mission.orchestrationLog.length > 0">
            <button class="text-gray-500 hover:text-gray-300 text-xs mt-2" @click="showLog = !showLog">
              {{ showLog ? '▲ Ocultar' : '▼ Ver' }} log de orquestación ({{ mission.orchestrationLog.length }})
            </button>
            <div v-if="showLog" class="mt-2 bg-gray-900/60 rounded-lg p-3 space-y-1.5 max-h-52 overflow-y-auto">
              <div v-for="(entry, i) in mission.orchestrationLog" :key="i" class="flex gap-2 text-xs">
                <span class="text-gray-600 whitespace-nowrap">{{ new Date(entry.timestamp).toLocaleTimeString() }}</span>
                <span class="text-gray-400">{{ logLabels[entry.action] || entry.action }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 📋 TAREAS -->
        <div v-else-if="activeTab === 'tasks'" class="space-y-2">
          <div v-if="tasks.length === 0" class="text-center py-8 text-gray-400">No hay tareas para esta misión</div>
          <div v-for="task in tasks" :key="task._id" class="bg-gray-700 rounded p-3">
            <div class="flex justify-between items-start">
              <div class="min-w-0">
                <h4 class="text-white font-medium">{{ task.title }}</h4>
                <p v-if="task.description" class="text-gray-400 text-sm line-clamp-2">{{ task.description }}</p>
                <div class="flex gap-2 mt-2 text-xs text-gray-500">
                  <span class="px-2 py-0.5 rounded bg-gray-600">{{ task.type }}</span>
                  <span v-if="task.assignedTo" class="px-2 py-0.5 rounded bg-blue-900">{{ task.agentName || 'Agent' }}</span>
                </div>
              </div>
              <span :class="['px-2 py-1 rounded text-xs shrink-0', statusChip(task.status)]">{{ statusLabel(task.status) }}</span>
            </div>
          </div>
        </div>

        <!-- 📁 ARCHIVOS -->
        <div v-else-if="activeTab === 'files'" class="space-y-4">
          <FileUploader :mission-id="mission._id" type="mission_input" :max-size="3" @uploaded="fetchAttachments" @removed="fetchAttachments" />
          <div v-if="attachments.length > 0" class="space-y-1.5">
            <div v-for="att in attachments" :key="att.attachmentId"
              class="flex items-center justify-between bg-gray-700/50 rounded-lg px-3 py-2">
              <div class="min-w-0">
                <p class="text-gray-200 text-sm truncate">{{ att.resource.originalName }}</p>
                <p class="text-gray-500 text-xs">{{ att.resource.mimeType }} · {{ formatSize(att.resource.size) }}</p>
              </div>
              <div class="flex gap-1 shrink-0">
                <button class="text-blue-400 hover:text-blue-300 text-xs px-2 py-1"
                  @click="attachmentsService.download(att.attachmentId)">Descargar</button>
                <button class="text-red-400 hover:text-red-300 text-xs px-2 py-1"
                  @click="removeAttachment(att.attachmentId)">Eliminar</button>
              </div>
            </div>
          </div>
          <p class="text-gray-600 text-xs">Máx 3 MB por archivo. Los agentes reciben el contenido de estos archivos como fuente primaria del brief.</p>
        </div>

        <!-- 🔀 FLUJO (DAG) -->
        <div v-else-if="activeTab === 'flow'">
          <TaskDependencyGraph :mission-id="mission._id" :token="authToken" />
        </div>
      </div>
    </div>
  </div>
</template>
