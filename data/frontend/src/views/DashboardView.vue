<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { missionsService, agentsService, tasksService, activityService } from '@/services/api'

// Dashboard data
const stats = ref({
  activeMissions: 0,
  activeAgents: 0,
  pendingTasks: 0,
  completedTasks: 0
})

const recentActivity = ref<Array<{ id: string; message: string; timestamp: Date }>>([])
const loading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    // Fetch all data in parallel
    const [missionsRes, agentsRes, tasksRes, activityRes] = await Promise.all([
      missionsService.getAll().catch(() => ({ data: [] })),
      agentsService.getAll().catch(() => ({ data: [] })),
      tasksService.getAll().catch(() => ({ data: [] })),
      activityService.getAll().catch(() => ({ data: [] }))
    ])

    // Calculate stats
    const missions = missionsRes.data || []
    const agents = agentsRes.data || []
    const tasks = tasksRes.data || []
    const activities = activityRes.data || []

    stats.value = {
      activeMissions: missions.filter((m: any) => m.status === 'active').length,
      activeAgents: agents.filter((a: any) => a.status === 'active').length,
      pendingTasks: tasks.filter((t: any) => t.status === 'pending' || t.status === 'in_progress').length,
      completedTasks: tasks.filter((t: any) => t.status === 'completed').length
    }

    // Get recent activity (last 5)
    recentActivity.value = activities
      .slice(0, 5)
      .map((a: any) => ({
        id: a._id || a.id,
        message: a.message,
        timestamp: new Date(a.timestamp)
      }))
  } catch (err) {
    error.value = 'Error loading dashboard data'
    console.error(err)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="p-6">
    <!-- Header -->
    <header class="mb-8">
      <h1 class="text-3xl font-bold text-white">HQ Dashboard</h1>
      <p class="text-gray-400 mt-1">AI Agent Headquarters</p>
    </header>

    <!-- Loading State -->
    <div v-if="loading" class="text-center py-12">
      <p class="text-gray-400">Cargando dashboard...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="bg-red-900/30 border border-red-800 rounded-lg p-4 mb-6">
      <p class="text-red-400">{{ error }}</p>
    </div>

    <!-- Dashboard Content -->
    <template v-else>
      <!-- Stats Grid -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <p class="text-gray-400 text-sm">Misiones Activas</p>
          <p class="text-3xl font-bold text-blue-400">{{ stats.activeMissions }}</p>
        </div>
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <p class="text-gray-400 text-sm">Agentes Activos</p>
          <p class="text-3xl font-bold text-green-400">{{ stats.activeAgents }}</p>
        </div>
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <p class="text-gray-400 text-sm">Tareas Pendientes</p>
          <p class="text-3xl font-bold text-yellow-400">{{ stats.pendingTasks }}</p>
        </div>
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <p class="text-gray-400 text-sm">Tareas Completadas</p>
          <p class="text-3xl font-bold text-purple-400">{{ stats.completedTasks }}</p>
        </div>
      </div>

      <!-- Recent Activity -->
      <div class="bg-gray-800 rounded-lg border border-gray-700">
        <div class="p-4 border-b border-gray-700">
          <h2 class="text-xl font-semibold">Actividad Reciente</h2>
        </div>
        <div class="p-4">
          <div v-if="recentActivity.length === 0" class="text-gray-500 text-center py-4">
            No hay actividad reciente
          </div>
          <div v-else class="space-y-3">
            <div v-for="activity in recentActivity" :key="activity.id" class="flex items-start gap-3">
              <div class="w-2 h-2 mt-2 rounded-full bg-blue-500"></div>
              <div>
                <p class="text-gray-200">{{ activity.message }}</p>
                <p class="text-gray-500 text-sm">{{ activity.timestamp.toLocaleString() }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
