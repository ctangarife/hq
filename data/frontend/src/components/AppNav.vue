<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { authService } from '@/services/api'

const route = useRoute()

const navItems = [
  { path: '/', name: 'Dashboard', icon: '📊' },
  { path: '/missions', name: 'Misiones', icon: '🎯' },
  { path: '/agents', name: 'Agentes', icon: '🤖' },
  { path: '/tasks', name: 'Tareas', icon: '✓' },
  { path: '/activity', name: 'Actividad', icon: '📡' },
  { path: '/providers', name: 'Providers', icon: '⚙️' },
  { path: '/admin', name: 'Admin', icon: '🛠️' }
]

const isActive = (path: string) => {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}

// Usuario logueado
const userName = computed(() => {
  try {
    const user = JSON.parse(localStorage.getItem('hq_user') || '{}')
    return user.name || user.email || 'Usuario'
  } catch {
    return 'Usuario'
  }
})

// ── Cambiar contraseña ──
const showPasswordModal = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const newPasswordConfirm = ref('')
const changingPassword = ref(false)
const passwordMessage = ref<string | null>(null)

async function changePassword() {
  if (newPassword.value !== newPasswordConfirm.value) {
    passwordMessage.value = '❌ Las contraseñas no coinciden'
    return
  }
  if (newPassword.value.length < 8) {
    passwordMessage.value = '❌ Mínimo 8 caracteres'
    return
  }
  changingPassword.value = true
  passwordMessage.value = null
  try {
    await authService.changePassword(currentPassword.value, newPassword.value)
    passwordMessage.value = '✅ Contraseña actualizada'
    setTimeout(() => {
      showPasswordModal.value = false
      currentPassword.value = ''
      newPassword.value = ''
      newPasswordConfirm.value = ''
      passwordMessage.value = null
    }, 1500)
  } catch (err: any) {
    passwordMessage.value = `❌ ${err.response?.data?.error || err.message}`
  } finally {
    changingPassword.value = false
  }
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
            class="px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
            :class="isActive(item.path) ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'"
          >
            <span>{{ item.icon }}</span>
            <span class="hidden lg:inline">{{ item.name }}</span>
          </RouterLink>
        </div>

        <!-- User menu -->
        <div class="flex items-center gap-3">
          <span class="text-sm text-slate-400 hidden md:inline">{{ userName }}</span>
          <button
            @click="showPasswordModal = true"
            class="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition"
            title="Cambiar contraseña"
          >
            🔑
          </button>
          <button
            @click="authService.logout()"
            class="px-3 py-1.5 bg-red-600/80 hover:bg-red-600 text-white text-xs font-medium rounded-lg transition"
          >
            Salir
          </button>
        </div>
      </div>
    </div>

    <!-- Modal: Cambiar contraseña -->
    <div v-if="showPasswordModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-slate-700/60">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-lg font-semibold text-white">🔑 Cambiar contraseña</h2>
          <button @click="showPasswordModal = false" class="text-slate-400 hover:text-white">✕</button>
        </div>

        <form @submit.prevent="changePassword()" class="space-y-4">
          <div>
            <label class="block text-slate-400 text-sm mb-1.5">Contraseña actual</label>
            <input v-model="currentPassword" type="password" required class="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-xl text-white" />
          </div>
          <div>
            <label class="block text-slate-400 text-sm mb-1.5">Nueva contraseña</label>
            <input v-model="newPassword" type="password" required minlength="8" class="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-xl text-white" placeholder="Mínimo 8 caracteres" />
          </div>
          <div>
            <label class="block text-slate-400 text-sm mb-1.5">Confirmar nueva contraseña</label>
            <input v-model="newPasswordConfirm" type="password" required minlength="8" class="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-xl text-white" />
          </div>

          <div v-if="passwordMessage" class="p-3 rounded-xl text-sm" :class="passwordMessage.startsWith('✅') ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'">
            {{ passwordMessage }}
          </div>

          <div class="flex gap-3 pt-2">
            <button type="button" @click="showPasswordModal = false" class="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-medium transition">Cancelar</button>
            <button type="submit" :disabled="changingPassword" class="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition">
              {{ changingPassword ? 'Guardando…' : 'Guardar' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </nav>
</template>
