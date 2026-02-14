<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()

const navItems = [
  { path: '/', name: 'Dashboard', icon: '📊' },
  { path: '/missions', name: 'Misiones', icon: '🎯' },
  { path: '/agents', name: 'Agentes', icon: '🤖' },
  { path: '/tasks', name: 'Tareas', icon: '✓' },
  { path: '/activity', name: 'Actividad', icon: '📡' }
]

const isActive = (path: string) => {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}
</script>

<template>
  <nav class="bg-slate-900 border-b border-slate-700">
    <div class="px-6">
      <div class="flex items-center justify-between h-16">
        <!-- Logo -->
        <div class="flex items-center gap-2">
          <span class="text-2xl">🦞</span>
          <span class="text-xl font-bold text-white">HQ</span>
        </div>

        <!-- Navigation -->
        <div class="flex gap-1">
          <RouterLink
            v-for="item in navItems"
            :key="item.path"
            :to="item.path"
            class="px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            :class="isActive(item.path) ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'"
          >
            <span>{{ item.icon }}</span>
            <span>{{ item.name }}</span>
          </RouterLink>
        </div>

        <!-- Status -->
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-green-500"></span>
          <span class="text-sm text-slate-400">Conectado</span>
        </div>
      </div>
    </div>
  </nav>
</template>
