<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { missionsService, tasksService, attachmentsService, resourcesService, templatesService } from '@/services/api'
import MissionControlPanel from '@/components/MissionControlPanel.vue'
import FileUploader from '@/components/FileUploader.vue'
import TaskDependencyGraph from '@/components/TaskDependencyGraph.vue'

type MissionType = 'AUTO_ORCHESTRATED' | 'TEMPLATE_BASED' | 'MANUAL'

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
  missionType?: MissionType
  templateId?: string
  context?: string
  audience?: string
  deliverableFormat?: string
  successCriteria?: string
  constraints?: string
  tone?: string
  orchestrationLog?: Array<{
    timestamp: string
    action: string
    details: any
  }>
  awaitingHumanTaskId?: string
}

interface MissionPlan {
  complexity?: 'low' | 'medium' | 'high'
  estimatedDuration?: string
  tasks?: Array<{
    title: string
    description: string
    type: string
    agentRole?: string
  }>
  agents?: Array<{
    role: string
    name: string
  }>
  dependencies?: Array<[string, string]>
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

interface UploadedFile {
  attachmentId: string
  resourceId: string
  originalName: string
  mimeType: string
  size: number
  type: string
  order: number
}

const missions = ref<Mission[]>([])
const humanTasks = ref<HumanTask[]>([])
const showCreateModal = ref(false)
const showTasksModal = ref(false)
const showLogModal = ref(false)
const showHumanResponseModal = ref(false)
const showControlPanelModal = ref(false)
const showFilesModal = ref(false)
const showPlanPreviewModal = ref(false)  // NEW: Plan preview before orchestration
const showDependencyGraphModal = ref(false)  // Phase 12.1: Dependency DAG modal
const loading = ref(true)
const error = ref<string | null>(null)
const submitting = ref(false)
const orchestrating = ref(false)
const submittingHumanResponse = ref(false)
const selectedMission = ref<Mission | null>(null)
const selectedHumanTask = ref<HumanTask | null>(null)
const dependencyMissionId = ref<string | null>(null)  // Phase 12.1: Mission ID for DAG view
const authToken = typeof localStorage !== 'undefined' ? localStorage.getItem('token') || 'hq-agent-token' : 'hq-agent-token'
const missionTasks = ref<any[]>([])
const orchestrationLog = ref<any[]>([])
const humanResponse = ref('')
const missionAttachments = ref<UploadedFile[]>([])
const createdMissionId = ref<string | null>(null)  // NEW: Store created mission ID
const squadLeadPlan = ref<MissionPlan | null>(null)  // NEW: Store Squad Lead's plan
const showAdditionalContext = ref(false)  // NEW: Toggle for additional context section

// Phase 10.2: Mission Templates
const templates = ref<any[]>([])
const selectedTemplate = ref<any>(null)
const loadingTemplates = ref(false)

// Form data
const formData = ref<{
  title: string
  description: string
  objective: string
  missionType: MissionType
  autoOrchestrate: boolean
  templateId?: string
  context: string
  audience: string
  deliverableFormat: string
  successCriteria: string
  constraints: string
  tone: string
}>({
  title: '',
  description: '',
  objective: '',
  missionType: 'AUTO_ORCHESTRATED' as MissionType,
  autoOrchestrate: false,
  templateId: undefined,
  context: '',
  audience: '',
  deliverableFormat: '',
  successCriteria: '',
  constraints: '',
  tone: ''
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

// Close create modal and reset form
const closeCreateModal = () => {
  showCreateModal.value = false
  // Reset form data
  formData.value = {
    title: '',
    description: '',
    objective: '',
    missionType: 'AUTO_ORCHESTRATED',
    autoOrchestrate: false,
    templateId: undefined,
    context: '',
    audience: '',
    deliverableFormat: '',
    successCriteria: '',
    constraints: '',
    tone: ''
  }
  selectedTemplate.value = null
  showAdditionalContext.value = false
}

// Phase 12.1: Open dependency graph modal
const openDependencyGraphModal = (missionId: string) => {
  dependencyMissionId.value = missionId
  showDependencyGraphModal.value = true
}

// Create mission
const createMission = async () => {
  // Phase 10.2: If template-based, use template flow
  if (formData.value.missionType === 'TEMPLATE_BASED') {
    await createMissionFromTemplate()
    return
  }

  try {
    submitting.value = true

    const missionData: any = {
      title: formData.value.title,
      description: formData.value.description,
      objective: formData.value.objective,
      status: 'draft',
      missionType: formData.value.missionType,
      autoOrchestrate: formData.value.autoOrchestrate
    }

    // Add optional context fields if provided
    if (formData.value.context) missionData.context = formData.value.context
    if (formData.value.audience) missionData.audience = formData.value.audience
    if (formData.value.deliverableFormat) missionData.deliverableFormat = formData.value.deliverableFormat
    if (formData.value.successCriteria) missionData.successCriteria = formData.value.successCriteria
    if (formData.value.constraints) missionData.constraints = formData.value.constraints
    if (formData.value.tone) missionData.tone = formData.value.tone

    // For template-based missions, include template ID
    if ((formData.value.missionType as MissionType) === 'TEMPLATE_BASED' && formData.value.templateId) {
      missionData.templateId = formData.value.templateId
    }

    const response = await missionsService.create(missionData)

    // Store the created mission ID
    createdMissionId.value = response.data._id

    // Reset form and close modal
    formData.value = {
      title: '',
      description: '',
      objective: '',
      missionType: 'AUTO_ORCHESTRATED',
      autoOrchestrate: false,
      templateId: undefined,
      context: '',
      audience: '',
      deliverableFormat: '',
      successCriteria: '',
      constraints: '',
      tone: ''
    }
    showCreateModal.value = false

    // If auto-orchestrate is enabled and it's AUTO_ORCHESTRATED type, show plan preview first
    if (formData.value.autoOrchestrate && formData.value.missionType === 'AUTO_ORCHESTRATED') {
      // Fetch the initial analysis task result for plan preview
      await fetchMissionPlan(response.data._id)
    } else if (formData.value.autoOrchestrate) {
      // For other types, orchestrate directly
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

// Phase 12.1: Handle task click from DAG
const handleTaskClickFromDAG = (node: any) => {
  console.log('Task clicked from DAG:', node.title)
  // Could navigate to task details or show more info
}

// Fetch mission plan from Squad Lead analysis
const fetchMissionPlan = async (missionId: string) => {
  try {
    orchestrating.value = true

    // Get the mission analysis task
    const tasksResponse = await tasksService.getByMission(missionId)
    const analysisTask = tasksResponse.data.find((t: any) => t.type === 'mission_analysis')

    if (analysisTask && analysisTask.output) {
      squadLeadPlan.value = analysisTask.output as MissionPlan
      showPlanPreviewModal.value = true
    } else {
      // No plan available yet, orchestrate directly
      await orchestrateMission(missionId)
    }
  } catch (err) {
    console.error('Error fetching plan:', err)
    // If we can't get the plan, just orchestrate
    await orchestrateMission(missionId)
  } finally {
    orchestrating.value = false
  }
}

// Confirm and execute the plan
const confirmPlan = async () => {
  if (!createdMissionId.value) return

  showPlanPreviewModal.value = false
  squadLeadPlan.value = null

  // Orchestrate the mission with the confirmed plan
  await orchestrateMission(createdMissionId.value)
  createdMissionId.value = null
}

// Edit the plan before executing
const editPlan = async () => {
  // TODO: Implement plan editing
  alert('Edición de plan próximamente disponible. Por ahora, el plan se ejecutará tal como fue generado por el Squad Lead.')
  await confirmPlan()
}

// Reject the plan and keep mission in draft
const rejectPlan = () => {
  showPlanPreviewModal.value = false
  squadLeadPlan.value = null
  createdMissionId.value = null
  alert('Misión creada en estado borrador. Puedes orquestarla manualmente más tarde o editarla.')
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

// Consolidate mission outputs
const consolidateMission = async (missionId: string) => {
  if (!confirm('¿Consolidar outputs de esta misión en un PDF?')) return
  try {
    await resourcesService.consolidate(missionId)
    alert('✅ Outputs consolidados exitosamente')
    await fetchMissions()
  } catch (err) {
    console.error('Error consolidating mission:', err)
    alert('Error al consolidar outputs')
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

// Phase 10.2: Mission Templates
const fetchTemplates = async () => {
  try {
    loadingTemplates.value = true
    const response = await templatesService.getAll()
    templates.value = response.data
  } catch (err) {
    console.error('Error fetching templates:', err)
  } finally {
    loadingTemplates.value = false
  }
}

const selectTemplate = (template: any) => {
  selectedTemplate.value = template
  formData.value.templateId = template.templateId

  // Pre-fill form with template defaults
  formData.value.context = template.context || ''
  formData.value.audience = template.audience || ''
  formData.value.deliverableFormat = template.deliverableFormat || ''
  formData.value.successCriteria = template.successCriteria || ''
  formData.value.constraints = template.constraints || ''
  formData.value.tone = template.tone || ''
}

const createMissionFromTemplate = async () => {
  if (!selectedTemplate.value) return

  try {
    submitting.value = true

    // Extract parameters from template title placeholders
    const params: Record<string, string> = {}
    const matches = selectedTemplate.value.defaultTitle.match(/\{([^}]+)\}/g) || []
    matches.forEach((match: string) => {
      const key = match.substring(1, match.length - 1)
      const value = prompt(`Ingresa valor para: ${key}`, key)
      if (value) params[key] = value
    })

    const response = await templatesService.createMission(
      selectedTemplate.value.templateId,
      params
    )

    await fetchMissions()
    closeCreateModal()

    // Ask if user wants to orchestrate immediately
    if (response.data.mission.status === 'draft') {
      const shouldOrchestrate = confirm(
        '✅ Misión creada desde plantilla.\n\n¿Deseas iniciar la orquestación automática ahora?'
      )
      if (shouldOrchestrate) {
        await orchestrateMission(response.data.mission._id)
      }
    }
  } catch (err) {
    console.error('Error creating mission from template:', err)
    alert('Error al crear misión desde plantilla')
  } finally {
    submitting.value = false
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

// Open files modal
const openFilesModal = async (mission: Mission) => {
  selectedMission.value = mission
  showFilesModal.value = true
  await fetchMissionAttachments(mission._id)
}

// Fetch mission attachments
const fetchMissionAttachments = async (missionId: string) => {
  try {
    const response = await attachmentsService.getByMission(missionId)
    missionAttachments.value = response.data.attachments || []
  } catch (err) {
    console.error('Error fetching attachments:', err)
    missionAttachments.value = []
  }
}

// Handle file uploaded
const handleFileUploaded = async () => {
  if (selectedMission.value) {
    await fetchMissionAttachments(selectedMission.value._id)
  }
}

// Handle file removed
const handleFileRemoved = async (_attachmentId: string) => {
  if (selectedMission.value) {
    await fetchMissionAttachments(selectedMission.value._id)
  }
}

// Download attachment
const downloadAttachment = (attachment: UploadedFile) => {
  attachmentsService.download(attachment.attachmentId)
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
  fetchTemplates()  // Phase 10.2: Load templates
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

            <!-- Files Button -->
            <button
              @click="openFilesModal(mission)"
              class="px-3 py-1 bg-green-700 hover:bg-green-600 text-white rounded text-sm transition"
              title="Archivos de la misión"
            >
              📎 Archivos
            </button>

            <!-- Control Panel Button -->
            <button
              @click="openControlPanel(mission)"
              class="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm transition"
              title="Panel de control de misión"
            >
              🎮 Control
            </button>

            <!-- Consolidate Button (Phase 8.2) -->
            <button
              v-if="mission.status === 'completed' || mission.status === 'active'"
              @click="consolidateMission(mission._id)"
              class="px-3 py-1 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-sm transition"
              title="Consolidar outputs en PDF"
            >
              📄 Consolidar
            </button>

            <!-- Dependency Graph Button (Phase 12.1) -->
            <button
              @click="openDependencyGraphModal(mission._id)"
              class="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm transition"
              title="Ver grafo de dependencias"
            >
              🔗 DAG
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
    <div v-if="showCreateModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="bg-gray-800 rounded-lg w-full max-w-lg border border-gray-700 flex flex-col max-h-[90vh]">
        <!-- Header -->
        <div class="p-4 border-b border-gray-700 flex-shrink-0">
          <h2 class="text-xl font-bold text-white">Nueva Misión</h2>
        </div>

        <!-- Scrollable Content -->
        <div class="p-4 overflow-y-auto flex-1">
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

          <!-- Additional Context Section (Optional - Collapsible) -->
          <div class="border border-gray-700 rounded-lg bg-gray-900/30 overflow-hidden">
            <button
              type="button"
              @click="showAdditionalContext = !showAdditionalContext"
              class="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/50 transition"
            >
              <div class="flex items-center gap-2">
                <span class="text-lg">💡</span>
                <label class="text-gray-300 font-medium text-sm cursor-pointer">Contexto Adicional</label>
                <span class="text-gray-500 text-xs">(Opcional - Mejora los resultados)</span>
              </div>
              <span class="text-gray-400 transition-transform" :class="{ 'rotate-180': showAdditionalContext }">▼</span>
            </button>

            <div v-if="showAdditionalContext" class="px-4 pb-4 space-y-3 border-t border-gray-700">
              <!-- Context -->
              <div>
                <label class="block text-gray-400 text-xs mb-1">
                  Contexto del proyecto
                  <span class="text-gray-600 font-normal"> - ¿Qué es tu empresa/proyecto?</span>
                </label>
                <input
                  v-model="formData.context"
                  type="text"
                  class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  placeholder="Ej: Startup B2B SaaS en etapa de crecimiento"
                />
              </div>

              <!-- Audience -->
              <div>
                <label class="block text-gray-400 text-xs mb-1">
                  Audiencia objetivo
                  <span class="text-gray-600 font-normal"> - ¿Quién consumirá el resultado?</span>
                </label>
                <input
                  v-model="formData.audience"
                  type="text"
                  class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  placeholder="Ej: Gerentes de marketing no técnicos"
                />
              </div>

              <!-- Deliverable Format -->
              <div>
                <label class="block text-gray-400 text-xs mb-1">
                  Formato de entrega esperado
                  <span class="text-gray-600 font-normal"> - ¿Cómo quieres recibir el resultado?</span>
                </label>
                <select
                  v-model="formData.deliverableFormat"
                  class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                >
                  <option value="">Seleccionar formato...</option>
                  <option value="report_pdf">📄 Reporte PDF</option>
                  <option value="presentation">📊 Presentación</option>
                  <option value="code_repository">💻 Repositorio de código</option>
                  <option value="api_integration">🔌 API/Integración</option>
                  <option value="markdown_document">📝 Documento Markdown</option>
                  <option value="data_analysis">📈 Análisis de datos</option>
                  <option value="other">🎯 Otro (especificar en descripción)</option>
                </select>
              </div>

              <!-- Success Criteria -->
              <div>
                <label class="block text-gray-400 text-xs mb-1">
                  Criterios de éxito
                  <span class="text-gray-600 font-normal"> - ¿Cómo sabremos que la misión está completa?</span>
                </label>
                <input
                  v-model="formData.successCriteria"
                  type="text"
                  class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  placeholder="Ej: Mínimo 5 estrategias accionables con KPIs"
                />
              </div>

              <!-- Constraints -->
              <div>
                <label class="block text-gray-400 text-xs mb-1">
                  Restricciones
                  <span class="text-gray-600 font-normal"> - ¿Límites de tiempo, presupuesto, técnicos?</span>
                </label>
                <input
                  v-model="formData.constraints"
                  type="text"
                  class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  placeholder="Ej: Sin inversión en ads, máximo 3 páginas"
                />
              </div>

              <!-- Tone -->
              <div>
                <label class="block text-gray-400 text-xs mb-1">
                  Tono/Estilo
                  <span class="text-gray-600 font-normal"> - ¿Qué estilo de comunicación prefieres?</span>
                </label>
                <select
                  v-model="formData.tone"
                  class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                >
                  <option value="">Seleccionar tono...</option>
                  <option value="formal_academic">🎓 Formal académico</option>
                  <option value="professional">💼 Profesional</option>
                  <option value="casual_friendly">😊 Casual y amigable</option>
                  <option value="technical">🔧 Técnico/Profundo</option>
                  <option value="executive">👔 Ejecutivo (alto nivel)</option>
                  <option value="creative">🎨 Creativo/Inspirador</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Mission Type Selector -->
          <div>
            <label class="block text-gray-400 text-sm mb-2">Tipo de Misión *</label>
            <div class="grid grid-cols-3 gap-2">
              <button
                type="button"
                @click="formData.missionType = 'AUTO_ORCHESTRATED'"
                :class="[
                  'p-3 rounded-lg border-2 transition text-center',
                  formData.missionType === 'AUTO_ORCHESTRATED'
                    ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                    : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500'
                ]"
              >
                <div class="text-2xl mb-1">🤖</div>
                <div class="text-xs font-medium">Auto Orquestada</div>
                <div class="text-[10px] text-gray-500 mt-1">Squad Lead decide todo</div>
              </button>

              <button
                type="button"
                @click="formData.missionType = 'TEMPLATE_BASED'"
                :class="[
                  'p-3 rounded-lg border-2 transition text-center',
                  formData.missionType === 'TEMPLATE_BASED'
                    ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                    : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500'
                ]"
              >
                <div class="text-2xl mb-1">📋</div>
                <div class="text-xs font-medium">Plantilla</div>
                <div class="text-[10px] text-gray-500 mt-1">Usa plantilla predefinida</div>
              </button>

              <button
                type="button"
                @click="formData.missionType = 'MANUAL'"
                :class="[
                  'p-3 rounded-lg border-2 transition text-center',
                  formData.missionType === 'MANUAL'
                    ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                    : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500'
                ]"
              >
                <div class="text-2xl mb-1">✋</div>
                <div class="text-xs font-medium">Manual</div>
                <div class="text-[10px] text-gray-500 mt-1">Tú defines las tareas</div>
              </button>
            </div>
          </div>

          <!-- Phase 10.2: Template Selector (shown when TEMPLATE_BASED is selected) -->
          <div v-if="formData.missionType === 'TEMPLATE_BASED'" class="mt-4">
            <label class="block text-gray-400 text-sm mb-2">Seleccionar Plantilla *</label>
            <div v-if="loadingTemplates" class="text-gray-500 text-sm py-4 text-center">
              Cargando plantillas...
            </div>
            <div v-else-if="templates.length === 0" class="text-gray-500 text-sm py-4 text-center">
              No hay plantillas disponibles
            </div>
            <div v-else class="grid grid-cols-2 gap-3 max-h-48 overflow-y-auto pr-2">
              <div
                v-for="template in templates"
                :key="template.templateId"
                @click="selectTemplate(template)"
                :class="[
                  'p-3 rounded-lg border-2 cursor-pointer transition',
                  selectedTemplate?.templateId === template.templateId
                    ? 'bg-blue-600/20 border-blue-500'
                    : 'bg-gray-700 border-gray-600 hover:border-gray-500'
                ]"
              >
                <div class="flex items-start gap-2">
                  <span class="text-xl">{{ template.icon }}</span>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium text-white truncate">{{ template.name }}</div>
                    <div class="text-xs text-gray-400 truncate">{{ template.description }}</div>
                    <div class="flex flex-wrap gap-1 mt-2">
                      <span
                        v-for="tag in template.tags.slice(0, 2)"
                        :key="tag"
                        class="text-[10px] px-1.5 py-0.5 bg-gray-600 rounded text-gray-300"
                      >
                        {{ tag }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Auto-Orchestrate Checkbox (only for AUTO_ORCHESTRATED type) -->
          <div v-if="formData.missionType === 'AUTO_ORCHESTRATED'" class="flex items-center gap-2 p-3 bg-purple-900/20 border border-purple-700 rounded-lg">
            <input
              id="autoOrchestrate"
              v-model="formData.autoOrchestrate"
              type="checkbox"
              class="w-4 h-4 rounded bg-gray-700 border-gray-600"
            />
            <label for="autoOrchestrate" class="text-gray-300 text-sm">
              <span class="font-medium">🚀 Iniciar orquestación automática</span>
              <span class="text-gray-500 block text-xs mt-1">El Squad Lead analizará la misión y generará un plan que podrás revisar antes de ejecutar</span>
            </label>
          </div>

          <!-- Info for TEMPLATE_BASED -->
          <div v-if="formData.missionType === 'TEMPLATE_BASED'" class="p-3 bg-blue-900/20 border border-blue-700 rounded-lg">
            <p class="text-blue-300 text-sm">
              📋 <strong>Modo Plantilla:</strong> Selecciona una plantilla predefinida para crear la misión rápidamente.
              <span class="text-yellow-400 block mt-1">* Próximamente: Selección de plantillas disponibles</span>
            </p>
          </div>

          <!-- Info for MANUAL -->
          <div v-if="formData.missionType === 'MANUAL'" class="p-3 bg-gray-700/50 border border-gray-600 rounded-lg">
            <p class="text-gray-300 text-sm">
              ✋ <strong>Modo Manual:</strong> Crea la misión en estado borrador. Luego podrás crear y asignar tareas manualmente desde el panel de control.
            </p>
          </div>
        </form>
        </div>

        <!-- Footer - Buttons (sticky at bottom) -->
        <div class="p-4 border-t border-gray-700 flex-shrink-0">
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
              @click="createMission"
              class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="submitting || orchestrating || !formData.title || !formData.description"
            >
              {{ submitting ? 'Creando...' : orchestrating ? 'Orquestando...' : 'Crear Misión' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Plan Preview Modal -->
    <div v-if="showPlanPreviewModal && squadLeadPlan" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="bg-gray-800 rounded-lg w-full max-w-3xl border border-gray-700 max-h-[90vh] overflow-hidden flex flex-col">
        <div class="sticky top-0 bg-gray-800 border-b border-gray-700 p-4">
          <div class="flex justify-between items-start">
            <div>
              <h2 class="text-xl font-bold text-white flex items-center gap-2">
                <span class="text-2xl">🎯</span>
                Plan Generado por Squad Lead
              </h2>
              <p class="text-gray-400 text-sm mt-1">Revisa el plan antes de ejecutar la misión</p>
            </div>
            <button
              @click="rejectPlan"
              class="text-gray-400 hover:text-white text-2xl"
              title="Rechazar plan"
            >
              ✕
            </button>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto p-4 space-y-4">
          <!-- Plan Complexity -->
          <div class="bg-gray-900 rounded-lg p-4">
            <h3 class="text-white font-semibold mb-2">Complejidad de la Misión</h3>
            <div class="flex items-center gap-3">
              <span
                :class="[
                  'px-3 py-1 rounded-full text-sm font-medium',
                  squadLeadPlan.complexity === 'high' ? 'bg-red-600/30 text-red-300' :
                  squadLeadPlan.complexity === 'medium' ? 'bg-yellow-600/30 text-yellow-300' :
                  'bg-green-600/30 text-green-300'
                ]"
              >
                {{ squadLeadPlan.complexity?.toUpperCase() || 'MEDIA' }}
              </span>
              <span v-if="squadLeadPlan.estimatedDuration" class="text-gray-400 text-sm">
                ⏱️ Duración estimada: {{ squadLeadPlan.estimatedDuration }}
              </span>
            </div>
          </div>

          <!-- Agents to Create -->
          <div v-if="squadLeadPlan.agents && squadLeadPlan.agents.length > 0" class="bg-gray-900 rounded-lg p-4">
            <h3 class="text-white font-semibold mb-3">🤖 Agentes a Crear</h3>
            <div class="grid grid-cols-2 gap-2">
              <div
                v-for="agent in squadLeadPlan.agents"
                :key="agent.role"
                class="bg-gray-800 rounded p-3 border border-gray-700"
              >
                <div class="flex items-center gap-2">
                  <span class="text-xl">
                    {{ agent.role === 'researcher' ? '🔍' :
                       agent.role === 'developer' ? '💻' :
                       agent.role === 'writer' ? '✍️' :
                       agent.role === 'analyst' ? '📊' : '🤖' }}
                  </span>
                  <div>
                    <p class="text-white font-medium text-sm">{{ agent.name }}</p>
                    <p class="text-gray-500 text-xs">{{ agent.role }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Tasks to Execute -->
          <div v-if="squadLeadPlan.tasks && squadLeadPlan.tasks.length > 0" class="bg-gray-900 rounded-lg p-4">
            <h3 class="text-white font-semibold mb-3">📋 Tareas Planificadas ({{ squadLeadPlan.tasks.length }})</h3>
            <div class="space-y-2">
              <div
                v-for="(task, index) in squadLeadPlan.tasks"
                :key="index"
                class="bg-gray-800 rounded p-3 border border-gray-700"
              >
                <div class="flex items-start gap-3">
                  <span class="text-gray-600 font-bold text-sm">{{ index + 1 }}</span>
                  <div class="flex-1">
                    <p class="text-white font-medium text-sm">{{ task.title }}</p>
                    <p v-if="task.description" class="text-gray-400 text-xs mt-1">{{ task.description }}</p>
                    <div class="flex items-center gap-2 mt-2">
                      <span class="px-2 py-0.5 rounded bg-purple-900/50 text-purple-300 text-xs">
                        {{ task.type }}
                      </span>
                      <span v-if="task.agentRole" class="px-2 py-0.5 rounded bg-blue-900/50 text-blue-300 text-xs">
                        {{ task.agentRole }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Dependencies -->
          <div v-if="squadLeadPlan.dependencies && squadLeadPlan.dependencies.length > 0" class="bg-gray-900 rounded-lg p-4">
            <h3 class="text-white font-semibold mb-3">🔗 Dependencias</h3>
            <div class="space-y-1">
              <div
                v-for="(dep, index) in squadLeadPlan.dependencies"
                :key="index"
                class="text-gray-400 text-sm flex items-center gap-2"
              >
                <span class="text-gray-600">{{ dep[0] }}</span>
                <span class="text-gray-600">→</span>
                <span class="text-gray-600">{{ dep[1] }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="sticky bottom-0 bg-gray-800 border-t border-gray-700 p-4">
          <div class="flex gap-3 justify-end">
            <button
              @click="rejectPlan"
              class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition"
              :disabled="orchestrating"
            >
              Rechazar Plan
            </button>
            <button
              @click="editPlan"
              class="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded transition"
              :disabled="orchestrating"
            >
              ✏️ Editar Plan
            </button>
            <button
              @click="confirmPlan"
              class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition flex items-center gap-2"
              :disabled="orchestrating"
            >
              <span v-if="orchestrating" class="animate-spin">⏳</span>
              <span>{{ orchestrating ? 'Ejecutando...' : '✅ Confirmar y Ejecutar' }}</span>
            </button>
          </div>
          <p class="text-gray-500 text-xs text-center mt-2">
            Al confirmar, se crearán los agentes y tareas según el plan generado
          </p>
        </div>
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

    <!-- Files Modal -->
    <div v-if="showFilesModal && selectedMission" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="bg-gray-800 rounded-lg w-full max-w-3xl border border-gray-700 max-h-[90vh] overflow-hidden flex flex-col">
        <div class="sticky top-0 bg-gray-800 border-b border-gray-700 p-4 flex justify-between items-center">
          <div>
            <h2 class="text-xl font-bold text-white">📎 Archivos: {{ selectedMission.title }}</h2>
            <p class="text-gray-400 text-sm mt-1">Administra los archivos de entrada de la misión</p>
          </div>
          <button
            @click="showFilesModal = false"
            class="text-gray-400 hover:text-white text-2xl"
          >
            ✕
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-4">
          <!-- File Uploader -->
          <FileUploader
            v-if="selectedMission"
            :mission-id="selectedMission._id"
            type="mission_input"
            :existing-files="missionAttachments"
            @uploaded="handleFileUploaded"
            @removed="handleFileRemoved"
          />

          <!-- Existing Files List -->
          <div v-if="missionAttachments.length > 0" class="mt-6">
            <h3 class="text-lg font-semibold text-white mb-3">Archivos Adjuntos</h3>
            <div class="space-y-2">
              <div
                v-for="file in missionAttachments"
                :key="file.attachmentId"
                class="flex items-center gap-3 p-3 bg-gray-900 rounded-lg border border-gray-700"
              >
                <span class="text-2xl">
                  {{ file.mimeType.includes('pdf') ? '📄' :
                     file.mimeType.includes('image') ? '🖼️' :
                     file.mimeType.includes('excel') ? '📊' :
                     file.mimeType.includes('code') ? '💻' : '📎' }}
                </span>
                <div class="flex-1 min-w-0">
                  <p class="text-white font-medium truncate">{{ file.originalName }}</p>
                  <p class="text-gray-500 text-xs">
                    {{ (file.size / 1024).toFixed(1) }} KB · {{ file.type }}
                  </p>
                </div>
                <button
                  @click="downloadAttachment(file)"
                  class="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                  title="Descargar"
                >
                  ⬇️
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Phase 12.1: Dependency Graph Modal -->
    <div v-if="showDependencyGraphModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="bg-gray-800 rounded-lg w-full max-w-5xl border border-gray-700 flex flex-col max-h-[90vh]">
        <!-- Header -->
        <div class="p-4 border-b border-gray-700 flex justify-between items-center flex-shrink-0">
          <div>
            <h2 class="text-xl font-bold text-white flex items-center gap-2">
              <span>🔗</span>
              Grafo de Dependencias
            </h2>
            <p class="text-gray-400 text-xs mt-1">Visualización de tareas y sus relaciones</p>
          </div>
          <button
            @click="showDependencyGraphModal = false"
            class="text-gray-400 hover:text-white text-2xl"
          >
            ✕
          </button>
        </div>

        <!-- Content -->
        <div class="p-4 flex-1 overflow-y-auto">
          <TaskDependencyGraph
            v-if="dependencyMissionId"
            :mission-id="dependencyMissionId"
            :token="authToken"
            @task-click="handleTaskClickFromDAG"
          />
        </div>
      </div>
    </div>
  </div>
</template>
