<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { missionsService, tasksService } from '@/services/api'
import MissionControlPanel from '@/components/MissionControlPanel.vue'

interface Mission {
  _id: string
  title: string
  description: string
  objective?: string
  status: 'draft' | 'active' | 'paused' | 'completed'
  priority: 'high' | 'medium' | 'low'
  createdAt: string
  squadLeadId?: string
  autoOrchestrate?: boolean
  orchestrationLog?: Array<{
    timestamp: string
    action: string
    details: any
  }>
  awaitingHumanTaskId?: string
}

interface HumanTask {
  _id: string
  title: string
  description: string
  status: string
  missionId: string
  input?: {
    parentTaskId: string
    agentId: string
  }
}

const missions = ref<Mission[]>([])
const humanTasks = ref<HumanTask[]>([])
const showCreateModal = ref(false)
const showTasksModal = ref(false)
const showLogModal = ref(false)
const showHumanResponseModal = ref(false)
const showControlPanelModal = ref(false)
const loading = ref(true)
const error = ref<string | null>(null)
const submitting = ref(false)
const orchestrating = ref(false)
const submittingHumanResponse = ref(false)
const selectedMission = ref<Mission | null>(null)
const selectedHumanTask = ref<HumanTask | null>(null)
const missionTasks = ref<any[]>([])
const orchestrationLog = ref<any[]>([])
const humanResponse = ref('')

// Form data
const formData = ref({
  title: '',
  description: '',
  objective: '',
  autoOrchestrate: false
})

const statusColors = {
  draft: 'text-gray-400 bg-gray-800',
  active: 'text-green-400 bg-green-900/30',
  paused: 'text-yellow-400 bg-yellow-900/30',
  completed: 'text-blue-400 bg-blue-900/30'
}

const statusLabels = {
  draft: 'Borrador',
  active: 'Activa',
  paused: 'Pausada',
  completed: 'Completada'
}

// Fetch missions
const fetchMissions = async () => {
  try {
    loading.value = true
    error.value = null
    const response = await missionsService.getAll()
    missions.value = response.data
  } catch (err) {
    error.value = 'Error al cargar misiones'
    console.error(err)
  } finally {
    loading.value = false
  }
}

// Create mission
const createMission = async () => {
  try {
    submitting.value = true
    const response = await missionsService.create({
      title: formData.value.title,
      description: formData.value.description,
      objective: formData.value.objective,
      status: 'draft',
      autoOrchestrate: formData.value.autoOrchestrate
    })

    // Reset form and close modal
    formData.value = { title: '', description: '', objective: '', autoOrchestrate: false }
    showCreateModal.value = false

    // If auto-orchestrate is enabled, trigger orchestration
    if (formData.value.autoOrchestrate) {
      await orchestrateMission(response.data._id)
    }

    // Refresh list
    await fetchMissions()
  } catch (err: any) {
    console.error('Error creating mission:', err)
    alert(err.response?.data?.error || 'Error al crear misión')
  } finally {
    submitting.value = false
  }
}

// Orchestrate mission
const orchestrateMission = async (id: string) => {
  try {
    orchestrating.value = true
    const response = await missionsService.orchestrate(id)

    alert(`Orquestación iniciada:\n${response.data.message}`)

    // Refresh missions to see updated data
    await fetchMissions()
  } catch (err: any) {
    console.error('Error orchestrating mission:', err)
    alert(err.response?.data?.error || 'Error al orquestar misión')
  } finally {
    orchestrating.value = false
  }
}

// View mission tasks
const viewMissionTasks = async (mission: Mission) => {
  selectedMission.value = mission
  showTasksModal.value = true

  try {
    const response = await tasksService.getByMission(mission._id)
    missionTasks.value = response.data
  } catch (err) {
    console.error('Error fetching tasks:', err)
    missionTasks.value = []
  }
}

// View orchestration log
const viewOrchestrationLog = (mission: Mission) => {
  selectedMission.value = mission
  orchestrationLog.value = mission.orchestrationLog || []
  showLogModal.value = true
}

// Update mission status
const updateStatus = async (id: string, status: string) => {
  try {
    await missionsService.update(id, { status })
    await fetchMissions()
  } catch (err) {
    console.error('Error updating mission:', err)
    alert('Error al actualizar estado')
  }
}

// Delete mission
const deleteMission = async (id: string) => {
  if (!confirm('¿Estás seguro de eliminar esta misión?')) return
  try {
    await missionsService.delete(id)
    await fetchMissions()
  } catch (err) {
    console.error('Error deleting mission:', err)
    alert('Error al eliminar misión')
  }
}

// Fetch human input tasks
const fetchHumanTasks = async () => {
  try {
    const response = await tasksService.getHumanTasks()
    humanTasks.value = response.data
  } catch (err) {
    console.error('Error fetching human tasks:', err)
  }
}

// Get human task for a mission
const getHumanTaskForMission = (mission: Mission) => {
  if (!mission.awaitingHumanTaskId) return null
  return humanTasks.value.find(t => t._id === mission.awaitingHumanTaskId)
}

// Open human response modal
const openHumanResponseModal = async (mission: Mission) => {
  selectedMission.value = mission
  const humanTask = getHumanTaskForMission(mission)

  if (!humanTask) {
    // Try to fetch human tasks if not loaded
    await fetchHumanTasks()
    const retryTask = getHumanTaskForMission(mission)
    if (!retryTask) {
      alert('No se encontró la tarea de respuesta humana')
      return
    }
    selectedHumanTask.value = retryTask
  } else {
    selectedHumanTask.value = humanTask
  }

  humanResponse.value = ''
  showHumanResponseModal.value = true
}

// Open control panel modal
const openControlPanel = (mission: Mission) => {
  selectedMission.value = mission
  showControlPanelModal.value = true
}

// Submit human response
const submitHumanResponse = async () => {
  if (!selectedHumanTask.value || !humanResponse.value.trim()) {
    alert('Por favor proporciona una respuesta')
    return
  }

  try {
    submittingHumanResponse.value = true
    await tasksService.submitHumanResponse(selectedHumanTask.value._id, humanResponse.value)

    // Close modal and refresh
    showHumanResponseModal.value = false
    selectedHumanTask.value = null
    humanResponse.value = ''

    await Promise.all([fetchMissions(), fetchHumanTasks()])

    alert('Respuesta enviada. El Squad Lead continuará con tu información.')
  } catch (err: any) {
    console.error('Error submitting human response:', err)
    alert(err.response?.data?.error || 'Error al enviar respuesta')
  } finally {
    submittingHumanResponse.value = false
  }
}

onMounted(() => {
  fetchMissions()
  fetchHumanTasks()
})
</script>

<template>
  <div class="p-6">
    <!-- Header -->
    <header class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-3xl font-bold text-white">Misiones</h1>
        <p class="text-gray-400 mt-1">Gestiona los objetivos de tu squad de IA con orquestación automática</p>
      </div>
      <button
        @click="showCreateModal = true"
        class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
      >
        + Nueva Misión
      </button>
    </header>

    <!-- Error State -->
    <div v-if="error" class="bg-red-900/30 border border-red-800 rounded-lg p-4 mb-6">
      <p class="text-red-400">{{ error }}</p>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="text-center py-12">
      <p class="text-gray-400">Cargando misiones...</p>
    </div>

    <!-- Empty State -->
    <div v-else-if="missions.length === 0" class="text-center py-16">
      <p class="text-gray-500 text-lg">No hay misiones creadas</p>
      <p class="text-gray-600 mt-2">Crea tu primera misión para comenzar</p>
    </div>

    <!-- Missions List -->
    <div v-else class="grid gap-4">
      <div
        v-for="mission in missions"
        :key="mission._id"
        class="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition"
      >
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <h3 class="text-xl font-semibold text-white">{{ mission.title }}</h3>
              <span v-if="mission.squadLeadId" class="px-2 py-0.5 rounded text-xs bg-purple-600 text-white">
                Squad Lead Assigned
              </span>
            </div>
            <p class="text-gray-400 mt-1">{{ mission.description }}</p>
            <p v-if="mission.objective" class="text-gray-500 text-sm mt-2">
              <strong>Objetivo:</strong> {{ mission.objective }}
            </p>

            <!-- Orchestration Info -->
            <div v-if="mission.orchestrationLog && mission.orchestrationLog.length > 0" class="mt-3 text-sm">
              <div class="flex items-center gap-2 text-gray-500">
                <span>📋 {{ mission.orchestrationLog.length }} eventos de orquestación</span>
                <button
                  @click="viewOrchestrationLog(mission)"
                  class="text-blue-400 hover:text-blue-300 underline"
                >
                  Ver log
                </button>
              </div>
            </div>

            <!-- Waiting for Human Input Indicator -->
            <div v-if="mission.awaitingHumanTaskId" class="mt-3 p-2 bg-orange-900/30 border border-orange-700 rounded text-sm">
              <div class="flex items-center gap-2">
                <span class="text-orange-400">❓ Esperando tu respuesta</span>
                <button
                  @click="openHumanResponseModal(mission)"
                  class="px-2 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded text-xs transition"
                >
                  Responder
                </button>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <!-- Status Badge -->
            <span :class="['px-2 py-1 rounded text-sm', statusColors[mission.status]]">
              {{ statusLabels[mission.status] }}
            </span>

            <!-- Orchestrate Button (for draft missions) -->
            <button
              v-if="mission.status === 'draft'"
              @click="orchestrateMission(mission._id)"
              :disabled="orchestrating"
              class="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm transition disabled:opacity-50"
              title="Iniciar orquestación automática con Squad Lead"
            >
              {{ orchestrating ? 'Orquestando...' : '🚀 Orquestar' }}
            </button>

            <!-- View Tasks Button -->
            <button
              @click="viewMissionTasks(mission)"
              class="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm transition"
              title="Ver tareas de la misión"
            >
              📋 Tareas
            </button>

            <!-- Control Panel Button -->
            <button
              @click="openControlPanel(mission)"
              class="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm transition"
              title="Panel de control de misión"
            >
              🎮 Control
            </button>

            <!-- Status Actions -->
            <select
              :value="mission.status"
              @change="updateStatus(mission._id, ($event.target as HTMLSelectElement).value)"
              class="bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600"
            >
              <option value="draft">Borrador</option>
              <option value="active">Activa</option>
              <option value="paused">Pausada</option>
              <option value="completed">Completada</option>
            </select>

            <!-- Delete Button -->
            <button
              @click="deleteMission(mission._id)"
              class="text-red-400 hover:text-red-300 p-1"
              title="Eliminar"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Modal -->
    <div v-if="showCreateModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-gray-800 rounded-lg p-6 w-full max-w-md border border-gray-700">
        <h2 class="text-xl font-bold text-white mb-4">Nueva Misión</h2>
        <form @submit.prevent="createMission" class="space-y-4">
          <div>
            <label class="block text-gray-400 text-sm mb-1">Título *</label>
            <input
              v-model="formData.title"
              type="text"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              placeholder="Ej: Lanzamiento de Producto"
              required
            />
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">Descripción *</label>
            <textarea
              v-model="formData.description"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              rows="3"
              placeholder="Describe el objetivo de la misión..."
              required
            />
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">Objetivo Principal</label>
            <input
              v-model="formData.objective"
              type="text"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              placeholder="Ej: Incrementar ventas en 20%"
            />
          </div>
          <div class="flex items-center gap-2">
            <input
              id="autoOrchestrate"
              v-model="formData.autoOrchestrate"
              type="checkbox"
              class="w-4 h-4 rounded bg-gray-700 border-gray-600"
            />
            <label for="autoOrchestrate" class="text-gray-400 text-sm">
              Iniciar orquestación automática con Squad Lead
            </label>
          </div>
          <div class="flex gap-2 justify-end">
            <button
              type="button"
              @click="showCreateModal = false"
              class="px-4 py-2 text-gray-400 hover:text-white transition"
              :disabled="submitting || orchestrating"
            >
              Cancelar
            </button>
            <button
              type="submit"
              class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition"
              :disabled="submitting || orchestrating || !formData.title || !formData.description"
            >
              {{ submitting ? 'Creando...' : orchestrating ? 'Orquestando...' : 'Crear' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Tasks Modal -->
    <div v-if="showTasksModal && selectedMission" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-gray-800 rounded-lg p-6 w-full max-w-3xl border border-gray-700 max-h-[80vh] overflow-hidden flex flex-col">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-bold text-white">
            Tareas: {{ selectedMission.title }}
          </h2>
          <button
            @click="showTasksModal = false"
            class="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div class="overflow-y-auto flex-1">
          <div v-if="missionTasks.length === 0" class="text-center py-8 text-gray-400">
            No hay tareas para esta misión
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="task in missionTasks"
              :key="task._id"
              class="bg-gray-700 rounded p-3"
            >
              <div class="flex justify-between items-start">
                <div>
                  <h4 class="text-white font-medium">{{ task.title }}</h4>
                  <p v-if="task.description" class="text-gray-400 text-sm">{{ task.description }}</p>
                  <div class="flex gap-2 mt-2 text-xs text-gray-500">
                    <span class="px-2 py-0.5 rounded bg-gray-600">{{ task.type }}</span>
                    <span v-if="task.assignedTo" class="px-2 py-0.5 rounded bg-blue-900">
                      {{ task.agentName || 'Agent' }}
                    </span>
                  </div>
                </div>
                <span :class="[
                  'px-2 py-1 rounded text-xs',
                  task.status === 'completed' ? 'bg-green-900 text-green-400' :
                  task.status === 'in_progress' ? 'bg-yellow-900 text-yellow-400' :
                  'bg-gray-600 text-gray-400'
                ]">
                  {{ task.status }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Orchestration Log Modal -->
    <div v-if="showLogModal && selectedMission" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-gray-800 rounded-lg p-6 w-full max-w-2xl border border-gray-700 max-h-[80vh] overflow-hidden flex flex-col">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-bold text-white">
            Log de Orquestación: {{ selectedMission.title }}
          </h2>
          <button
            @click="showLogModal = false"
            class="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div class="overflow-y-auto flex-1 font-mono text-sm">
          <div v-if="orchestrationLog.length === 0" class="text-center py-8 text-gray-400">
            No hay eventos de orquestación
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="(log, index) in orchestrationLog"
              :key="index"
              class="bg-gray-900 rounded p-3"
            >
              <div class="text-gray-500 text-xs mb-1">
                {{ new Date(log.timestamp).toLocaleString() }}
              </div>
              <div class="text-purple-400 font-medium">
                {{ log.action }}
              </div>
              <pre class="text-gray-400 text-xs mt-1 overflow-x-auto">{{ JSON.stringify(log.details, null, 2) }}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Human Response Modal -->
    <div v-if="showHumanResponseModal && selectedMission && selectedHumanTask" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-gray-800 rounded-lg p-6 w-full max-w-2xl border border-gray-700 max-h-[80vh] overflow-hidden flex flex-col">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-bold text-white">
            ❓ Squad Lead Necesita Información
          </h2>
          <button
            @click="showHumanResponseModal = false"
            class="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div class="overflow-y-auto flex-1">
          <div class="mb-4 p-3 bg-orange-900/20 border border-orange-700 rounded">
            <p class="text-orange-400 font-medium mb-2">Preguntas del Squad Lead:</p>
            <p class="text-white whitespace-pre-wrap">{{ selectedHumanTask.description }}</p>
          </div>

          <div class="space-y-4">
            <div>
              <label class="block text-gray-400 text-sm mb-2">Tu Respuesta:</label>
              <textarea
                v-model="humanResponse"
                class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white min-h-[150px]"
                placeholder="Proporciona la información que el Squad Lead necesita..."
              />
            </div>

            <div class="flex justify-end gap-2">
              <button
                @click="showHumanResponseModal = false"
                :disabled="submittingHumanResponse"
                class="px-4 py-2 text-gray-400 hover:text-white transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                @click="submitHumanResponse"
                :disabled="submittingHumanResponse || !humanResponse.trim()"
                class="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded transition disabled:opacity-50"
              >
                {{ submittingHumanResponse ? 'Enviando...' : 'Enviar Respuesta' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Control Panel Modal -->
    <div v-if="showControlPanelModal && selectedMission" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="bg-gray-800 rounded-lg w-full max-w-2xl border border-gray-700 max-h-[90vh] overflow-y-auto">
        <div class="sticky top-0 bg-gray-800 border-b border-gray-700 p-4 flex justify-between items-center">
          <h2 class="text-xl font-bold text-white">Panel de Control: {{ selectedMission.title }}</h2>
          <button
            @click="showControlPanelModal = false"
            class="text-gray-400 hover:text-white text-2xl"
          >
            ✕
          </button>
        </div>

        <div class="p-4">
          <MissionControlPanel
            v-if="selectedMission"
            :mission="selectedMission"
            @refresh="fetchMissions"
          />
        </div>
      </div>
    </div>
  </div>
</template>
