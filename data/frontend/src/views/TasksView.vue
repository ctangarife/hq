<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { tasksService, missionsService, agentsService } from '@/services/api'

interface Task {
  _id: string
  title: string
  description?: string
  type?: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
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
}

const tasks = ref<Task[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const showCreateModal = ref(false)
const showEditModal = ref(false)
const submitting = ref(false)
const updating = ref<string | null>(null)
const editingTask = ref<Task | null>(null)

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
  return tasks.value.filter(t => t.status === status)
}

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
    <header class="flex justify-between items-center mb-8">
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
              <span v-else class="text-xs text-gray-500 cursor-pointer hover:text-purple-400" @click="openEditModal(task)">
                + Asignar agente
              </span>
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
