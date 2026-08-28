<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { missionsService, activityService } from '@/services/api'

interface WorkspaceStats {
  workspaceId: string
  name: string
  members: number
  totalMissions: number
  activeMissions: number
  completedMissions: number
  pendingTasks: number
  inProgressTasks: number
  completedTasks: number
  failedTasks: number
  activeAgents: number
}

// Dashboard data — viene del backend con scope de workspace:
// el usuario de workspace ve SUS números, el super_admin ve los globales
// + desglose por workspace
const stats = ref({
  totalMissions: 0,
  activeMissions: 0,
  completedMissions: 0,
  pendingTasks: 0,
  inProgressTasks: 0,
  completedTasks: 0,
  failedTasks: 0,
  activeAgents: 0,
})
const isGlobalScope = ref(false)
const workspaceBreakdown = ref<WorkspaceStats[]>([])

const recentActivity = ref<Array<{ id: string; message: string; timestamp: Date }>>([])
const loading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    // El endpoint de stats ya viene filtrado por workspace (aislamiento
    // server-side); la actividad también (GET /api/activity aplica el filtro)
    const [statsRes, activityRes] = await Promise.all([
      missionsService.dashboardStats().catch(() => null),
      activityService.getAll().catch(() => ({ data: [] })),
    ])

    if (statsRes?.data) {
      const d = statsRes.data
      stats.value = {
        totalMissions: d.totalMissions || 0,
        activeMissions: d.activeMissions || 0,
        completedMissions: d.completedMissions || 0,
        pendingTasks: d.pendingTasks || 0,
        inProgressTasks: d.inProgressTasks || 0,
        completedTasks: d.completedTasks || 0,
        failedTasks: d.failedTasks || 0,
        activeAgents: d.activeAgents || 0,
      }
      isGlobalScope.value = d.scope === 'global'
      workspaceBreakdown.value = d.workspaces || []
    }

    recentActivity.value = (activityRes.data || [])
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
      <p class="text-gray-400 mt-1">
        {{ isGlobalScope ? 'Vista global — todos los workspaces' : 'AI Agent Headquarters' }}
      </p>
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
      <!-- Welcome card for new users (no missions) -->
      <div v-if="stats.totalMissions === 0 && stats.completedTasks === 0" class="mb-8 bg-gradient-to-r from-blue-900/40 to-purple-900/40 border border-blue-700/40 rounded-2xl p-6">
        <div class="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 class="text-xl font-bold text-white">👋 ¡Bienvenido a HQ!</h2>
            <p class="text-slate-300 mt-2 text-sm">
              Agentes IA que crean contenido para su negocio: posts, reportes, investigación y más.
            </p>
            <div class="flex gap-3 mt-4">
              <RouterLink to="/missions" class="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition text-sm">
                ✨ Crear mi primera misión
              </RouterLink>
              <RouterLink to="/guide" class="px-5 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition text-sm">
                📖 Ver guía paso a paso
              </RouterLink>
            </div>
          </div>
          <svg width="56" height="56" viewBox="0 0 64 64" class="mx-auto">
  <defs>
    <linearGradient id="loginLogo" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>
  <path d="M32 4 L56 18 L56 46 L32 60 L8 46 L8 18 Z" fill="url(#loginLogo)"/>
  <text x="32" y="42" font-size="22" text-anchor="middle" fill="#fff" font-family="system-ui" font-weight="700" letter-spacing="-1">HQ</text>
</svg>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <p class="text-gray-400 text-sm">Misiones Activas</p>
          <p class="text-3xl font-bold text-blue-400">{{ stats.activeMissions }}</p>
        </div>
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <p class="text-gray-400 text-sm">Misiones Completadas</p>
          <p class="text-3xl font-bold text-cyan-400">{{ stats.completedMissions }}</p>
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
          <p class="text-gray-400 text-sm">Tareas En Curso</p>
          <p class="text-3xl font-bold text-orange-400">{{ stats.inProgressTasks }}</p>
        </div>
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <p class="text-gray-400 text-sm">Tareas Completadas</p>
          <p class="text-3xl font-bold text-purple-400">{{ stats.completedTasks }}</p>
        </div>
      </div>

      <!-- Per-workspace breakdown (solo super_admin) -->
      <div v-if="isGlobalScope && workspaceBreakdown.length > 0" class="bg-gray-800 rounded-lg border border-gray-700 mb-8">
        <div class="p-4 border-b border-gray-700 flex items-center justify-between">
          <h2 class="text-xl font-semibold">Métricas por Workspace</h2>
          <span class="text-xs text-gray-500">{{ workspaceBreakdown.length }} workspaces</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-gray-400 border-b border-gray-700">
                <th class="px-4 py-3 font-medium">Workspace</th>
                <th class="px-4 py-3 font-medium text-center">Miembros</th>
                <th class="px-4 py-3 font-medium text-center">Misiones</th>
                <th class="px-4 py-3 font-medium text-center">Activas</th>
                <th class="px-4 py-3 font-medium text-center">Completadas</th>
                <th class="px-4 py-3 font-medium text-center">Tareas ✓</th>
                <th class="px-4 py-3 font-medium text-center">Tareas ✗</th>
                <th class="px-4 py-3 font-medium text-center">Agentes</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="ws in workspaceBreakdown"
                :key="ws.workspaceId"
                class="border-b border-gray-700/50 hover:bg-gray-700/30 transition"
              >
                <td class="px-4 py-3 font-medium text-white">{{ ws.name }}</td>
                <td class="px-4 py-3 text-center text-gray-300">{{ ws.members }}</td>
                <td class="px-4 py-3 text-center text-gray-300">{{ ws.totalMissions }}</td>
                <td class="px-4 py-3 text-center text-blue-400">{{ ws.activeMissions }}</td>
                <td class="px-4 py-3 text-center text-cyan-400">{{ ws.completedMissions }}</td>
                <td class="px-4 py-3 text-center text-purple-400">{{ ws.completedTasks }}</td>
                <td class="px-4 py-3 text-center text-red-400">{{ ws.failedTasks }}</td>
                <td class="px-4 py-3 text-center text-green-400">{{ ws.activeAgents }}</td>
              </tr>
            </tbody>
          </table>
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
