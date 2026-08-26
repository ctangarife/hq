<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()

// ── Login mode ──
const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

// ── Accept invitation mode ──
const invitationToken = ref('')
const invitationInfo = ref<{ workspaceName: string; role: string; invitedByName: string; email: string } | null>(null)
const name = ref('')
const registerPassword = ref('')
const registerPasswordConfirm = ref('')
const registerLoading = ref(false)
const registerError = ref<string | null>(null)
const mode = ref<'login' | 'register' | 'invitation-loading' | 'invitation-error'>('login')

const API_URL = import.meta.env.VITE_API_URL || '/api'

onMounted(async () => {
  const token = route.query.token as string
  if (token) {
    mode.value = 'invitation-loading'
    invitationToken.value = token
    try {
      const res = await fetch(`${API_URL}/auth/invitation/${token}`)
      if (res.ok) {
        const data = await res.json()
        invitationInfo.value = data
        email.value = data.email
        mode.value = 'register'
      } else {
        mode.value = 'invitation-error'
      }
    } catch {
      mode.value = 'invitation-error'
    }
  }
})

async function login() {
  loading.value = true
  error.value = null
  try {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value, password: password.value }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error')

    localStorage.setItem('hq_token', data.token)
    localStorage.setItem('hq_user', JSON.stringify(data.user))
    router.push('/')
  } catch (err: any) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function register() {
  registerLoading.value = true
  registerError.value = null

  if (registerPassword.value !== registerPasswordConfirm.value) {
    registerError.value = 'Las contraseñas no coinciden'
    registerLoading.value = false
    return
  }

  if (registerPassword.value.length < 8) {
    registerError.value = 'La contraseña debe tener al menos 8 caracteres'
    registerLoading.value = false
    return
  }

  try {
    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invitationToken: invitationToken.value,
        email: email.value,
        password: registerPassword.value,
        name: name.value,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error')

    localStorage.setItem('hq_token', data.token)
    localStorage.setItem('hq_user', JSON.stringify(data.user))
    router.push('/')
  } catch (err: any) {
    registerError.value = err.message
  } finally {
    registerLoading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-950 flex items-center justify-center p-4">
    <div class="w-full max-w-md">

      <!-- ── Invitation Loading ── -->
      <div v-if="mode === 'invitation-loading'" class="text-center py-12">
        <div class="inline-block w-8 h-8 border-2 border-slate-600 border-t-blue-400 rounded-full animate-spin"></div>
        <p class="text-slate-400 mt-4">Verificando invitación…</p>
      </div>

      <!-- ── Invitation Error ── -->
      <div v-else-if="mode === 'invitation-error'" class="text-center py-12">
        <span class="text-5xl">🚫</span>
        <h2 class="text-xl font-semibold text-white mt-4">Invitación inválida</h2>
        <p class="text-slate-400 mt-2 text-sm">
          La invitación expiró, fue revocada o ya fue utilizada.
          Pedí una nueva al administrador del workspace.
        </p>
        <router-link to="/login" class="inline-block mt-6 text-blue-400 hover:text-blue-300 text-sm">
          Ir a login →
        </router-link>
      </div>

      <!-- ── Register (con invitación) ── -->
      <div v-else-if="mode === 'register'" class="bg-slate-900 border border-slate-700/60 rounded-2xl p-8">
        <div class="text-center mb-8">
          <span class="text-4xl">🦞</span>
          <h1 class="text-2xl font-bold text-white mt-3">Únete a {{ invitationInfo?.workspaceName }}</h1>
          <p class="text-slate-400 text-sm mt-2">
            {{ invitationInfo?.invitedByName }} te invitó a colaborar en HQ
          </p>
        </div>

        <form @submit.prevent="register()" class="space-y-4">
          <div>
            <label class="block text-slate-400 text-sm mb-1.5">Nombre *</label>
            <input
              v-model="name"
              type="text"
              required
              class="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white"
              placeholder="Tu nombre"
            />
          </div>

          <div>
            <label class="block text-slate-400 text-sm mb-1.5">Email *</label>
            <input
              v-model="email"
              type="email"
              required
              disabled
              class="w-full px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-xl text-slate-400"
            />
            <p class="text-xs text-slate-500 mt-1">Fijado por la invitación</p>
          </div>

          <div>
            <label class="block text-slate-400 text-sm mb-1.5">Contraseña *</label>
            <input
              v-model="registerPassword"
              type="password"
              required
              minlength="8"
              class="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white"
              placeholder="Mínimo 8 caracteres"
            />
          </div>

          <div>
            <label class="block text-slate-400 text-sm mb-1.5">Confirmar contraseña *</label>
            <input
              v-model="registerPasswordConfirm"
              type="password"
              required
              minlength="8"
              class="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white"
              placeholder="Repetí tu contraseña"
            />
          </div>

          <div v-if="registerError" class="p-3 bg-red-900/30 border border-red-700/50 rounded-xl">
            <p class="text-red-400 text-sm">{{ registerError }}</p>
          </div>

          <button
            type="submit"
            :disabled="registerLoading"
            class="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition"
          >
            {{ registerLoading ? 'Creando cuenta…' : 'Crear cuenta y entrar' }}
          </button>
        </form>
      </div>

      <!-- ── Login ── -->
      <div v-else class="bg-slate-900 border border-slate-700/60 rounded-2xl p-8">
        <div class="text-center mb-8">
          <span class="text-4xl">🦞</span>
          <h1 class="text-2xl font-bold text-white mt-3">HQ</h1>
          <p class="text-slate-400 text-sm mt-1">Iniciá sesión en tu workspace</p>
        </div>

        <form @submit.prevent="login()" class="space-y-4">
          <div>
            <label class="block text-slate-400 text-sm mb-1.5">Email</label>
            <input
              v-model="email"
              type="email"
              required
              class="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white"
              placeholder="tu@email.com"
            />
          </div>

          <div>
            <label class="block text-slate-400 text-sm mb-1.5">Contraseña</label>
            <input
              v-model="password"
              type="password"
              required
              class="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white"
              placeholder="••••••••"
            />
          </div>

          <div v-if="error" class="p-3 bg-red-900/30 border border-red-700/50 rounded-xl">
            <p class="text-red-400 text-sm">{{ error }}</p>
          </div>

          <button
            type="submit"
            :disabled="loading"
            class="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition"
          >
            {{ loading ? 'Ingresando…' : 'Ingresar' }}
          </button>
        </form>

        <div class="mt-6 text-center">
          <router-link to="/" class="text-slate-500 hover:text-slate-400 text-xs">
            ← Volver al dashboard (acceso admin)
          </router-link>
        </div>
      </div>

    </div>
  </div>
</template>
