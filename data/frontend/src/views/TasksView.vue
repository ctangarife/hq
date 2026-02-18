<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { tasksService, missionsService, agentsService } from '@/services/api'

interface RetryAttempt {
  attempt: number
  error: string
  timestamp: string
  agentId?: string
}

interface Task {
  _id: string
  title: string
  description?: string
  type?: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'awaiting_human_response'
  assignedTo?: string
  missionId?: string
  missionTitle?: string  // Título de la misión (enviado por API)
  agentName?: string  // Nombre del agente (enviado por API)
  dependencies?: string[]
  result?: any
  createdAt: string
  updatedAt: string
  assignedAgent?: { _id: string; name: string }
  originalMissionId?: string // Para preservar la misión original al editar
  // Phase 7: Retry & Auditor fields
  retryCount?: number
  maxRetries?: number
  retryHistory?: RetryAttempt[]
  auditorReviewId?: string
  error?: string
}

const tasks = ref<Task[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const showCreateModal = ref(false)
const showEditModal = ref(false)
const showRetryHistoryModal = ref(false)  // NEW: Modal de historial de reintentos
const showManualAuditModal = ref(false)  // NEW: Modal para decisión manual de auditoría
const submitting = ref(false)
const updating = ref<string | null>(null)
const editingTask = ref<Task | null>(null)
const selectedMissionId = ref<string>('')  // NEW: Filtro por misión
const selectedTaskForHistory = ref<Task | null>(null)  // NEW: Tarea seleccionada para ver historial
const selectedTaskForAudit = ref<Task | null>(null)  // NEW: Tarea seleccionada para auditoría manual
const manualAuditDecision = ref('')  // NEW: Decisión seleccionada
const manualAuditReason = ref('')  // NEW: Razón de la decisión
const manualAuditSubmitting = ref(false)  // NEW: Estado de envío de auditoría manual

// SSE connection
let taskEventSource: EventSource | null = null

// Drag and drop state
const draggedTaskId = ref<string | null>(null)
const draggedOverColumn = ref<string | null>(null)

// Form data
const formData = ref({
  title: '',
  description: '',
  missionId: '',
  assignedTo: '',
  type: 'custom' as string
})

const taskTypes = [
  { value: 'custom', label: 'Custom' },
  { value: 'web_search', label: 'Búsqueda Web' },
  { value: 'data_analysis', label: 'Análisis de Datos' },
  { value: 'content_generation', label: 'Generación de Contenido' },
  { value: 'code_execution', label: 'Ejecución de Código' },
  { value: 'mission_analysis', label: 'Análisis de Misión (Squad Lead)' }
]

const agents = ref<Array<{ _id: string; name: string }>>([])
const missions = ref<Array<{ _id: string; title: string }>>([])

const columns = {
  pending: { title: 'Pendientes', color: 'border-gray-600', bg: 'bg-gray-500' },
  in_progress: { title: 'En Progreso', color: 'border-yellow-600', bg: 'bg-yellow-500' },
  completed: { title: 'Completadas', color: 'border-green-600', bg: 'bg-green-500' },
  failed: { title: 'Fallidas', color: 'border-red-600', bg: 'bg-red-500' }
}

const getTasksByStatus = (status: string) => {
  let filteredTasks = tasks.value

  // Aplicar filtro por misión si está seleccionado
  if (selectedMissionId.value) {
    filteredTasks = filteredTasks.filter(t => t.missionId === selectedMissionId.value)
  }

  return filteredTasks.filter(t => t.status === status)
}

// Tareas filtradas (para mostrar contador)
const filteredTasksCount = computed(() => {
  if (selectedMissionId.value) {
    return tasks.value.filter(t => t.missionId === selectedMissionId.value).length
  }
  return tasks.value.length
})

// Helper para obtener el nombre de la misión de una tarea
const getMissionTitle = (task: Task) => {
  const missionId = (task as any).missionId
  if (!missionId) return null
  // Si viene del populate, tiene title
  if (typeof missionId === 'object' && missionId.title) {
    return missionId.title
  }
  // Si no, buscar en la lista
  const mission = missions.value.find(m => m._id === missionId || m._id === missionId._id)
  return mission?.title || null
}

// Fetch missions and agents for dropdowns
const fetchOptions = async () => {
  try {
    const [missionsRes, agentsRes] = await Promise.all([
      missionsService.getAll().catch(() => ({ data: [] })),
      agentsService.getAll().catch(() => ({ data: [] }))
    ])
    missions.value = missionsRes.data
    agents.value = agentsRes.data
  } catch (err) {
    console.error('Error loading options:', err)
  }
}

// Fetch tasks
const fetchTasks = async () => {
  try {
    loading.value = true
    error.value = null
    const response = await tasksService.getAll()
    tasks.value = response.data
  } catch (err) {
    error.value = 'Error al cargar tareas'
    console.error(err)
  } finally {
    loading.value = false
  }
}

// Create task
const createTask = async () => {
  try {
    submitting.value = true
    await tasksService.create({
      title: formData.value.title,
      description: formData.value.description,
      missionId: formData.value.missionId || undefined,
      assignedTo: formData.value.assignedTo || undefined,
      type: formData.value.type,
      status: 'pending'
    })
    formData.value = { title: '', description: '', missionId: '', assignedTo: '', type: 'custom' }
    showCreateModal.value = false
    await fetchTasks()
  } catch (err) {
    console.error('Error creating task:', err)
    alert('Error al crear tarea')
  } finally {
    submitting.value = false
  }
}

// Update task status (used by buttons and drag-drop)
const updateTaskStatus = async (taskId: string, newStatus: string) => {
  try {
    updating.value = taskId
    await tasksService.update(taskId, { status: newStatus })
    await fetchTasks()
  } catch (err) {
    console.error('Error updating task:', err)
    alert('Error al actualizar tarea')
  } finally {
    updating.value = null
  }
}

// Delete task
const deleteTask = async (taskId: string) => {
  if (!confirm('¿Estás seguro de eliminar esta tarea?')) return
  try {
    await tasksService.delete(taskId)
    await fetchTasks()
  } catch (err) {
    console.error('Error deleting task:', err)
    alert('Error al eliminar tarea')
  }
}

// Open edit modal
const openEditModal = (task: Task) => {
  editingTask.value = {
    ...task,
    // Guardar el missionId original como string (puede venir como objeto del populate)
    originalMissionId: (task as any).missionId?._id || (task as any).missionId,
    // Normalizar assignedTo: extraer el _id si viene como objeto del populate
    assignedTo: (task as any).assignedTo?._id || (task as any).assignedTo,
    // Asegurar que type tenga un valor por defecto
    type: task.type || 'custom'
  }
  showEditModal.value = true
}

// Open retry history modal
const openRetryHistoryModal = (task: Task) => {
  selectedTaskForHistory.value = task
  showRetryHistoryModal.value = true
}

// Format timestamp for display
const formatTimestamp = (timestamp: string) => {
  const date = new Date(timestamp)
  return date.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// Get retry badge color based on retry count vs max retries
const getRetryBadgeColor = (task: Task) => {
  const retryCount = task.retryCount || 0
  const maxRetries = task.maxRetries || 3

  if (retryCount === 0) return 'bg-gray-600/50 text-gray-300'
  if (retryCount < maxRetries) return 'bg-yellow-600/50 text-yellow-300'
  return 'bg-red-600/50 text-red-300'
}

// Check if task needs audit
const needsAudit = (task: Task) => {
  return (task.retryCount || 0) >= (task.maxRetries || 3) && !task.auditorReviewId
}

// Open manual audit modal
const openManualAuditModal = (task: Task) => {
  selectedTaskForAudit.value = task
  manualAuditDecision.value = ''
  manualAuditReason.value = ''
  showManualAuditModal.value = true
}

// Submit manual audit decision
const submitManualAuditDecision = async () => {
  if (!selectedTaskForAudit.value || !manualAuditDecision.value || !manualAuditReason.value) {
    alert('Por favor selecciona una decisión y proporciona una razón')
    return
  }

  try {
    manualAuditSubmitting.value = true

    const decisionData: any = {
      decision: manualAuditDecision.value,
      reason: manualAuditReason.value
    }

    // Add decision-specific fields
    if (manualAuditDecision.value === 'reassign') {
      const suggestedRole = prompt('Rol de agente sugerido (developer, researcher, writer, analyst):', 'developer')
      if (!suggestedRole) {
        alert('Debe especificar un rol de agente')
        return
      }
      decisionData.suggestedAgentRole = suggestedRole
    } else if (manualAuditDecision.value === 'refine') {
      const refinedDesc = prompt('Descripción mejorada de la tarea:', selectedTaskForAudit.value.description || '')
      if (!refinedDesc) {
        alert('Debe proporcionar una descripción mejorada')
        return
      }
      decisionData.refinedDescription = refinedDesc
    } else if (manualAuditDecision.value === 'escalate_human') {
      const question = prompt('Pregunta para el humano:', '¿Qué información adicional necesitas?')
      if (!question) {
        alert('Debe proporcionar una pregunta')
        return
      }
      decisionData.questionForHuman = question
    }

    const response = await fetch(`/api/tasks/${selectedTaskForAudit.value._id}/auditor-decision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token') || 'hq-agent-token'}`
      },
      body: JSON.stringify(decisionData)
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Error al procesar decisión')
    }

    // Close modal and refresh
    showManualAuditModal.value = false
    selectedTaskForAudit.value = null
    manualAuditDecision.value = ''
    manualAuditReason.value = ''

    await fetchTasks()

    alert('Decisión de auditoría aplicada correctamente')
  } catch (err: any) {
    console.error('Error submitting audit decision:', err)
    alert(err.message || 'Error al procesar decisión de auditoría')
  } finally {
    manualAuditSubmitting.value = false
  }
}

// Update task (full edit)
const updateTask = async () => {
  if (!editingTask.value) return
  try {
    submitting.value = true

    // Si la tarea ya tenía misión, mantenerla inmutable
    const hasOriginalMission = !!(editingTask.value as any).originalMissionId

    await tasksService.update(editingTask.value._id, {
      title: editingTask.value.title,
      description: editingTask.value.description,
      type: editingTask.value.type,
      // Si ya tenía misión, usar la original (inmutable), sino la que se seleccione
      missionId: hasOriginalMission
        ? (editingTask.value as any).originalMissionId
        : (editingTask.value as any).missionId?._id || editingTask.value.missionId,
      assignedTo: editingTask.value.assignedTo || undefined
    })
    showEditModal.value = false
    editingTask.value = null
    await fetchTasks()
  } catch (err) {
    console.error('Error updating task:', err)
    alert('Error al actualizar tarea')
  } finally {
    submitting.value = false
  }
}

// Drag and drop handlers
const onDragStart = (taskId: string, event: DragEvent) => {
  draggedTaskId.value = taskId
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', taskId)
  }
}

const onDragEnd = () => {
  draggedTaskId.value = null
  draggedOverColumn.value = null
}

const onDragOver = (status: string, event: DragEvent) => {
  event.preventDefault()
  draggedOverColumn.value = status
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

const onDragLeave = () => {
  draggedOverColumn.value = null
}

const onDrop = async (newStatus: string, event: DragEvent) => {
  event.preventDefault()
  const taskId = draggedTaskId.value
  if (!taskId) return

  // Don't update if dropping in same column
  const task = tasks.value.find(t => t._id === taskId)
  if (task && task.status !== newStatus) {
    await updateTaskStatus(taskId, newStatus)
  }

  draggedTaskId.value = null
  draggedOverColumn.value = null
}

// Connect to SSE stream for real-time task updates
const connectToTaskStream = () => {
  if (taskEventSource) {
    taskEventSource.close()
  }

  taskEventSource = tasksService.streamTasks()

  taskEventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)

      switch (data.type) {
        case 'connected':
          console.log('Connected to task updates stream')
          break

        case 'task.created':
        case 'task.updated':
          // Actualizar o agregar tarea en la lista
          handleTaskUpdate(data.data)
          break

        case 'task.deleted':
          // Remover tarea de la lista
          tasks.value = tasks.value.filter(t => t._id !== data.data.taskId)
          break

        case 'task.status_changed':
          // Recargar todas las tareas para obtener datos completos
          fetchTasks()
          break

        case 'task.completed':
        case 'task.failed':
          // Recargar para ver el estado final
          fetchTasks()
          break

        case 'heartbeat':
          // Mantener conexión viva
          break
      }
    } catch (error) {
      console.error('Error parsing SSE message:', error)
    }
  }

  taskEventSource.onerror = (error) => {
    console.error('SSE error:', error)
    // Reconnectar después de 5 segundos
    setTimeout(() => {
      if (taskEventSource) {
        connectToTaskStream()
      }
    }, 5000)
  }
}

// Handle individual task update (optimización para no recargar todo)
const handleTaskUpdate = (updatedTask: Task) => {
  const index = tasks.value.findIndex(t => t._id === updatedTask._id)

  if (index !== -1) {
    // Actualizar tarea existente
    tasks.value[index] = updatedTask
  } else {
    // Agregar nueva tarea
    tasks.value.unshift(updatedTask)
  }
}

onMounted(async () => {
  await fetchTasks()
  await fetchOptions()

  // Conectar al stream SSE
  connectToTaskStream()
})

onUnmounted(() => {
  if (taskEventSource) {
    taskEventSource.close()
    taskEventSource = null
  }
})
</script>

<template>
  <div class="p-6">
    <!-- Header -->
    <header class="mb-8">
      <div class="flex justify-between items-center mb-4">
        <div>
          <h1 class="text-3xl font-bold text-white">Tareas</h1>
          <p class="text-gray-400 mt-1">Tablero Kanban del squad (arrastra para mover)</p>
        </div>
        <button
          @click="showCreateModal = true"
          class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition"
        >
          + Nueva Tarea
        </button>
      </div>

      <!-- Mission Filter -->
      <div class="flex items-center gap-4 bg-gray-800 rounded-lg p-3 border border-gray-700">
        <label class="text-gray-400 text-sm whitespace-nowrap">Filtrar por Misión:</label>
        <select
          v-model="selectedMissionId"
          class="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="">Todas las misiones</option>
          <option v-for="mission in missions" :key="mission._id" :value="mission._id">
            {{ mission.title }}
          </option>
        </select>
        <span class="text-gray-500 text-sm whitespace-nowrap">
          {{ filteredTasksCount }} tarea{{ filteredTasksCount !== 1 ? 's' : '' }}
        </span>
        <button
          v-if="selectedMissionId"
          @click="selectedMissionId = ''"
          class="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm transition"
          title="Limpiar filtro"
        >
          ✕
        </button>
      </div>
    </header>

    <!-- Error State -->
    <div v-if="error" class="bg-red-900/30 border border-red-800 rounded-lg p-4 mb-6">
      <p class="text-red-400">{{ error }}</p>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="text-center py-12">
      <p class="text-gray-400">Cargando tareas...</p>
    </div>

    <!-- Kanban Board -->
    <div v-else class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div
        v-for="(column, status) in columns"
        :key="status"
        class="bg-gray-800 rounded-lg border-2 flex flex-col max-h-[calc(100vh-180px)] transition-colors"
        :class="draggedOverColumn === status ? 'border-purple-500 bg-gray-700/50' : 'border-gray-700'"
        @dragover.prevent="onDragOver(status, $event)"
        @dragleave="onDragLeave"
        @drop="onDrop(status, $event)"
      >
        <!-- Column Header -->
        <div class="p-3 border-b border-gray-700 flex items-center gap-2">
          <div :class="['w-3 h-3 rounded-full', column.bg]"></div>
          <h3 class="font-semibold text-gray-300 flex-1">{{ column.title }}</h3>
          <span class="text-gray-500 text-sm">{{ getTasksByStatus(status).length }}</span>
        </div>

        <!-- Tasks List -->
        <div class="p-3 space-y-2 overflow-y-auto flex-1">
          <div
            v-for="task in getTasksByStatus(status)"
            :key="task._id"
            class="bg-gray-700 rounded p-3 border cursor-move transition group"
            :class="[
              task._id === draggedTaskId ? 'opacity-50 border-purple-500' : 'border-gray-600 hover:border-gray-500',
              updating === task._id ? 'opacity-60 pointer-events-none' : ''
            ]"
            draggable="true"
            @dragstart="onDragStart(task._id, $event)"
            @dragend="onDragEnd"
          >
            <div class="flex justify-between items-start gap-2">
              <h4 class="text-white font-medium flex-1 cursor-pointer hover:text-purple-300" @click="openEditModal(task)">
                {{ task.title }}
              </h4>
              <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                <button
                  @click="openEditModal(task)"
                  class="text-gray-600 hover:text-purple-400 transition"
                  title="Editar"
                >
                  ✎
                </button>
                <button
                  @click="deleteTask(task._id)"
                  class="text-gray-600 hover:text-red-400 transition"
                  title="Eliminar"
                >
                  ✕
                </button>
              </div>
            </div>

            <p v-if="task.description" class="text-gray-400 text-sm mt-2 line-clamp-2">
              {{ task.description }}
            </p>

            <div class="flex flex-wrap gap-2 mt-3">
              <!-- Misión - usa missionTitle del API -->
              <span v-if="task.missionTitle" class="text-xs bg-blue-600/50 text-blue-300 px-2 py-1 rounded flex items-center gap-1">
                🎯 {{ task.missionTitle }}
              </span>

              <!-- Agente asignado - usa agentName del API -->
              <span v-if="task.agentName" class="text-xs bg-purple-600/50 text-purple-300 px-2 py-1 rounded flex items-center gap-1">
                👤 {{ task.agentName }}
              </span>
              <span v-else class="text-xs text-gray-500 cursor-pointer hover:text-purple-400" @click.stop="openEditModal(task)">
                + Asignar agente
              </span>

              <!-- Retry Badge (Phase 7.4) -->
              <span
                v-if="task.retryCount && task.retryCount > 0"
                :class="['text-xs px-2 py-1 rounded flex items-center gap-1 cursor-pointer hover:opacity-80 transition', getRetryBadgeColor(task)]"
                @click.stop="openRetryHistoryModal(task)"
                title="Ver historial de reintentos"
              >
                🔁 {{ task.retryCount }}/{{ task.maxRetries || 3 }}
              </span>

              <!-- Needs Audit Badge (Phase 7.4) - Now clickable! -->
              <span
                v-if="needsAudit(task)"
                class="text-xs bg-red-600/50 text-red-300 px-2 py-1 rounded flex items-center gap-1 animate-pulse cursor-pointer hover:opacity-80 transition"
                @click.stop="openRetryHistoryModal(task)"
                title="Ver detalles y solicitar auditoría"
              >
                🔍 Auditoría pendiente
              </span>

              <!-- Under Audit Badge (Phase 7.4) - Also clickable -->
              <span
                v-if="task.auditorReviewId"
                class="text-xs bg-indigo-600/50 text-indigo-300 px-2 py-1 rounded flex items-center gap-1 cursor-pointer hover:opacity-80 transition"
                @click.stop="openRetryHistoryModal(task)"
                title="Ver estado de auditoría"
              >
                🎭 En auditoría
              </span>
            </div>

            <!-- Error Message (Phase 7.4) -->
            <div v-if="task.error && task.status === 'failed'" class="mt-2 p-2 bg-red-900/20 border border-red-700/50 rounded">
              <p class="text-red-400 text-xs line-clamp-2">{{ task.error }}</p>
            </div>

            <div class="flex justify-end mt-2">
              <!-- Quick actions -->
              <div class="flex gap-1">
                <button
                  v-if="status !== 'completed'"
                  @click="updateTaskStatus(task._id, 'completed')"
                  :disabled="updating === task._id"
                  class="text-xs px-2 py-1 bg-green-600/50 hover:bg-green-600 text-green-300 rounded transition"
                  title="Completar"
                >
                  ✓
                </button>
              </div>
            </div>
          </div>

          <div v-if="getTasksByStatus(status).length === 0" class="text-gray-600 text-center py-8 text-sm">
            Arrastra tareas aquí
          </div>
        </div>
      </div>
    </div>

    <!-- Create Modal -->
    <div v-if="showCreateModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-gray-800 rounded-lg p-6 w-full max-w-md border border-gray-700">
        <h2 class="text-xl font-bold text-white mb-4">Nueva Tarea</h2>
        <form @submit.prevent="createTask" class="space-y-4">
          <div>
            <label class="block text-gray-400 text-sm mb-1">Título *</label>
            <input
              v-model="formData.title"
              type="text"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              placeholder="Ej: Investigar competencia"
              required
            />
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">Descripción</label>
            <textarea
              v-model="formData.description"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              rows="3"
              placeholder="Detalles de la tarea..."
            />
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">Misión</label>
            <select
              v-model="formData.missionId"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
            >
              <option value="">Sin misión asignada</option>
              <option v-for="mission in missions" :key="mission._id" :value="mission._id">
                {{ mission.title }}
              </option>
            </select>
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">Tipo</label>
            <select
              v-model="formData.type"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
            >
              <option v-for="type in taskTypes" :key="type.value" :value="type.value">
                {{ type.label }}
              </option>
            </select>
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">Asignar a</label>
            <select
              v-model="formData.assignedTo"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
            >
              <option value="">Sin asignar</option>
              <option v-for="agent in agents" :key="agent._id" :value="agent._id">
                {{ agent.name }}
              </option>
            </select>
          </div>
          <div class="flex gap-2 justify-end">
            <button
              type="button"
              @click="showCreateModal = false"
              class="px-4 py-2 text-gray-400 hover:text-white transition"
              :disabled="submitting"
            >
              Cancelar
            </button>
            <button
              type="submit"
              class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded transition"
              :disabled="submitting || !formData.title"
            >
              {{ submitting ? 'Creando...' : 'Crear' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Edit Modal -->
    <div v-if="showEditModal && editingTask" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-gray-800 rounded-lg p-6 w-full max-w-md border border-gray-700">
        <h2 class="text-xl font-bold text-white mb-4">Editar Tarea</h2>
        <form @submit.prevent="updateTask" class="space-y-4">
          <div>
            <label class="block text-gray-400 text-sm mb-1">Título *</label>
            <input
              v-model="editingTask.title"
              type="text"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              required
            />
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">Descripción</label>
            <textarea
              v-model="editingTask.description"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              rows="3"
              placeholder="Detalles de la tarea..."
            />
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">Misión</label>
            <div v-if="getMissionTitle(editingTask)" class="px-3 py-2 bg-gray-900/50 border border-gray-700 rounded text-gray-400 flex items-center gap-2">
              🎯 {{ getMissionTitle(editingTask) }}
              <span class="text-xs text-gray-500">(inmutable)</span>
            </div>
            <select
              v-else
              v-model="editingTask.missionId"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
            >
              <option value="">Sin misión asignada</option>
              <option v-for="mission in missions" :key="mission._id" :value="mission._id">
                {{ mission.title }}
              </option>
            </select>
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">Tipo</label>
            <select
              v-model="editingTask.type"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
            >
              <option v-for="type in taskTypes" :key="type.value" :value="type.value">
                {{ type.label }}
              </option>
            </select>
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">Asignar a</label>
            <select
              v-model="editingTask.assignedTo"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
            >
              <option value="">Sin asignar</option>
              <option v-for="agent in agents" :key="agent._id" :value="agent._id">
                {{ agent.name }}
              </option>
            </select>
          </div>
          <div class="flex gap-2 justify-end">
            <button
              type="button"
              @click="showEditModal = false; editingTask = null"
              class="px-4 py-2 text-gray-400 hover:text-white transition"
              :disabled="submitting"
            >
              Cancelar
            </button>
            <button
              type="submit"
              class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded transition"
              :disabled="submitting || !editingTask.title"
            >
              {{ submitting ? 'Guardando...' : 'Guardar' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Retry History Modal (Phase 7.4) -->
    <div v-if="showRetryHistoryModal && selectedTaskForHistory" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-gray-800 rounded-lg p-6 w-full max-w-2xl border border-gray-700 max-h-[80vh] overflow-hidden flex flex-col">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-bold text-white flex items-center gap-2">
            🔁 Historial de Reintentos
          </h2>
          <button
            @click="showRetryHistoryModal = false; selectedTaskForHistory = null"
            class="text-gray-400 hover:text-white text-2xl"
          >
            ✕
          </button>
        </div>

        <div class="overflow-y-auto flex-1">
          <!-- Task Info -->
          <div class="mb-4 p-3 bg-gray-700 rounded">
            <h3 class="text-white font-medium">{{ selectedTaskForHistory.title }}</h3>
            <p v-if="selectedTaskForHistory.description" class="text-gray-400 text-sm mt-1">
              {{ selectedTaskForHistory.description }}
            </p>
            <div class="flex gap-2 mt-2">
              <span class="text-xs bg-gray-600 text-gray-300 px-2 py-1 rounded">
                Intentos: {{ selectedTaskForHistory.retryCount || 0 }}/{{ selectedTaskForHistory.maxRetries || 3 }}
              </span>
              <span v-if="selectedTaskForHistory.auditorReviewId" class="text-xs bg-indigo-600/50 text-indigo-300 px-2 py-1 rounded">
                🎭 En auditoría
              </span>
            </div>
          </div>

          <!-- Retry History List -->
          <div v-if="selectedTaskForHistory.retryHistory && selectedTaskForHistory.retryHistory.length > 0" class="space-y-3">
            <h4 class="text-gray-400 text-sm font-medium">Intentos previos:</h4>
            <div
              v-for="(attempt, index) in selectedTaskForHistory.retryHistory"
              :key="index"
              class="p-3 bg-red-900/20 border border-red-700/50 rounded"
            >
              <div class="flex items-start gap-3">
                <div class="flex-shrink-0 w-8 h-8 bg-red-600/30 rounded-full flex items-center justify-center">
                  <span class="text-red-300 text-sm font-medium">{{ attempt.attempt }}</span>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="text-red-400 text-sm font-medium">Intento #{{ attempt.attempt }}</span>
                    <span v-if="attempt.agentId" class="text-xs bg-gray-600 text-gray-300 px-2 py-0.5 rounded">
                      ID: {{ attempt.agentId.substring(0, 8) }}...
                    </span>
                  </div>
                  <p class="text-red-300 text-sm">{{ attempt.error }}</p>
                  <p class="text-gray-500 text-xs mt-1">
                    {{ formatTimestamp(attempt.timestamp) }}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- No Retries Message -->
          <div v-else class="text-center py-8">
            <p class="text-gray-500">No hay intentos previos registrados</p>
          </div>

          <!-- Current Error -->
          <div v-if="selectedTaskForHistory.error && selectedTaskForHistory.status === 'failed'" class="mt-4 p-3 bg-red-900/30 border border-red-700 rounded">
            <h4 class="text-red-400 text-sm font-medium mb-1">Error actual:</h4>
            <p class="text-red-300 text-sm">{{ selectedTaskForHistory.error }}</p>
          </div>

          <!-- Audit Info -->
          <div v-if="needsAudit(selectedTaskForHistory)" class="mt-4 p-3 bg-orange-900/20 border border-orange-700 rounded">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-orange-400">🔍</span>
              <h4 class="text-orange-400 text-sm font-medium">Requiere auditoría</h4>
            </div>
            <p class="text-gray-300 text-sm mb-3">
              Esta tarea ha alcanzado el máximo de reintentos. Puedes:
            </p>
            <div class="flex gap-2">
              <button
                @click="openManualAuditModal(selectedTaskForHistory)"
                class="px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded text-sm transition"
                title="Decidir manualmente qué hacer con esta tarea"
              >
                ⚖️ Decidir Manualmente
              </button>
              <button
                @click="showRetryHistoryModal = false; selectedTaskForHistory = null"
                class="px-3 py-2 bg-gray-600 hover:bg-gray-700 text-gray-300 rounded text-sm transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Manual Audit Decision Modal (Phase 7.4) -->
    <div v-if="showManualAuditModal && selectedTaskForAudit" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-gray-800 rounded-lg p-6 w-full max-w-2xl border border-gray-700 max-h-[80vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-bold text-white flex items-center gap-2">
            ⚖️ Decisión de Auditoría Manual
          </h2>
          <button
            @click="showManualAuditModal = false; selectedTaskForAudit = null"
            class="text-gray-400 hover:text-white text-2xl"
          >
            ✕
          </button>
        </div>

        <!-- Task Summary -->
        <div class="mb-4 p-3 bg-gray-700 rounded">
          <h3 class="text-white font-medium">{{ selectedTaskForAudit.title }}</h3>
          <p v-if="selectedTaskForAudit.description" class="text-gray-400 text-sm mt-1">
            {{ selectedTaskForAudit.description }}
          </p>
          <div class="flex gap-2 mt-2 text-xs">
            <span class="bg-red-600/50 text-red-300 px-2 py-1 rounded">
              {{ selectedTaskForAudit.retryCount }}/{{ selectedTaskForAudit.maxRetries }} reintentos fallidos
            </span>
            <span class="bg-gray-600 text-gray-300 px-2 py-1 rounded">
              Tipo: {{ selectedTaskForAudit.type || 'custom' }}
            </span>
          </div>
        </div>

        <!-- Decision Options -->
        <div class="space-y-3">
          <h4 class="text-gray-300 text-sm font-medium">Selecciona una acción:</h4>

          <div class="grid grid-cols-2 gap-2">
            <!-- RETRY -->
            <button
              @click="manualAuditDecision = 'retry'"
              :class="['p-3 rounded border text-left transition', manualAuditDecision === 'retry' ? 'border-blue-500 bg-blue-900/30' : 'border-gray-600 hover:border-gray-500']"
            >
              <div class="flex items-center gap-2 mb-1">
                <span class="text-blue-400">🔄</span>
                <span class="text-white font-medium">REINTENTAR</span>
              </div>
              <p class="text-gray-400 text-xs">El error fue temporal. Reiniciar contador y dar un intento extra.</p>
            </button>

            <!-- REFINE -->
            <button
              @click="manualAuditDecision = 'refine'"
              :class="['p-3 rounded border text-left transition', manualAuditDecision === 'refine' ? 'border-purple-500 bg-purple-900/30' : 'border-gray-600 hover:border-gray-500']"
            >
              <div class="flex items-center gap-2 mb-1">
                <span class="text-purple-400">✏️</span>
                <span class="text-white font-medium">REFINAR</span>
              </div>
              <p class="text-gray-400 text-xs">La descripción de la tarea no está clara. Mejorarla y reintentar.</p>
            </button>

            <!-- REASSIGN -->
            <button
              @click="manualAuditDecision = 'reassign'"
              :class="['p-3 rounded border text-left transition', manualAuditDecision === 'reassign' ? 'border-green-500 bg-green-900/30' : 'border-gray-600 hover:border-gray-500']"
            >
              <div class="flex items-center gap-2 mb-1">
                <span class="text-green-400">👤</span>
                <span class="text-white font-medium">REASIGNAR</span>
              </div>
              <p class="text-gray-400 text-xs">El agente actual no tiene las habilidades necesarias. Asignar a otro.</p>
            </button>

            <!-- ESCALATE TO HUMAN -->
            <button
              @click="manualAuditDecision = 'escalate_human'"
              :class="['p-3 rounded border text-left transition', manualAuditDecision === 'escalate_human' ? 'border-yellow-500 bg-yellow-900/30' : 'border-gray-600 hover:border-gray-500']"
            >
              <div class="flex items-center gap-2 mb-1">
                <span class="text-yellow-400">👥</span>
                <span class="text-white font-medium">ESCALAR A HUMANO</span>
              </div>
              <p class="text-gray-400 text-xs">Falta información o archivos necesarios. Pedir al usuario.</p>
            </button>
          </div>

          <!-- Reason Input -->
          <div v-if="manualAuditDecision" class="mt-4">
            <label class="block text-gray-400 text-sm mb-2">Razón de la decisión:</label>
            <textarea
              v-model="manualAuditReason"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
              rows="3"
              placeholder="Explica por qué tomas esta decisión..."
            ></textarea>
          </div>

          <!-- Decision Explanation -->
          <div v-if="manualAuditDecision" class="mt-3 p-3 bg-blue-900/20 border border-blue-700/50 rounded">
            <p class="text-blue-300 text-sm">
              <strong>¿Qué hará esta decisión?</strong><br>
              <span v-if="manualAuditDecision === 'retry'">Se reiniciará el contador de reintentos y se dará un intento extra a la tarea.</span>
              <span v-else-if="manualAuditDecision === 'refine'">Se te pedirá que ingreses una descripción mejorada de la tarea.</span>
              <span v-else-if="manualAuditDecision === 'reassign'">Se te pedirá que especifiques el rol del agente que debe tomar la tarea.</span>
              <span v-else-if="manualAuditDecision === 'escalate_human'">Se creará una tarea para que el humano proporcione la información faltante.</span>
            </p>
          </div>

          <!-- Action Buttons -->
          <div class="flex gap-2 justify-end mt-4">
            <button
              @click="showManualAuditModal = false; selectedTaskForAudit = null; manualAuditDecision = ''; manualAuditReason = ''"
              class="px-4 py-2 text-gray-400 hover:text-white transition"
              :disabled="manualAuditSubmitting"
            >
              Cancelar
            </button>
            <button
              @click="submitManualAuditDecision"
              :disabled="manualAuditSubmitting || !manualAuditDecision || !manualAuditReason"
              class="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded transition disabled:opacity-50"
            >
              {{ manualAuditSubmitting ? 'Procesando...' : 'Aplicar Decisión' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.cursor-move {
  cursor: move;
}
</style>
