<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { missionsService } from '@/services/api'

interface Mission {
  _id: string
  title: string
  description: string
  objective?: string
  status: 'draft' | 'active' | 'paused' | 'completed'
  createdAt: string
  squadIds?: string[]
}

const missions = ref<Mission[]>([])
const showCreateModal = ref(false)
const loading = ref(true)
const error = ref<string | null>(null)
const submitting = ref(false)

// Form data
const formData = ref({
  title: '',
  description: '',
  objective: ''
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
    await missionsService.create({
      title: formData.value.title,
      description: formData.value.description,
      objective: formData.value.objective,
      status: 'draft'
    })
    // Reset form and close modal
    formData.value = { title: '', description: '', objective: '' }
    showCreateModal.value = false
    // Refresh list
    await fetchMissions()
  } catch (err) {
    console.error('Error creating mission:', err)
    alert('Error al crear misión')
  } finally {
    submitting.value = false
  }
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

onMounted(() => {
  fetchMissions()
})
</script>

<template>
  <div class="p-6">
    <!-- Header -->
    <header class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-3xl font-bold text-white">Misiones</h1>
        <p class="text-gray-400 mt-1">Gestiona los objetivos de tu squad de IA</p>
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
            <h3 class="text-xl font-semibold text-white">{{ mission.title }}</h3>
            <p class="text-gray-400 mt-1">{{ mission.description }}</p>
            <p v-if="mission.objective" class="text-gray-500 text-sm mt-2">
              <strong>Objetivo:</strong> {{ mission.objective }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <span :class="['px-2 py-1 rounded text-sm', statusColors[mission.status]]">
              {{ statusLabels[mission.status] }}
            </span>
            <!-- Status actions -->
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
              class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition"
              :disabled="submitting || !formData.title || !formData.description"
            >
              {{ submitting ? 'Creando...' : 'Crear' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
