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

// ── Forgot password mode ──
const forgotEmail = ref('')
const forgotLoading = ref(false)
const forgotSent = ref(false)

// ── Reset password mode ──
const resetToken = ref('')
const newPassword = ref('')
const newPasswordConfirm = ref('')
const resetLoading = ref(false)
const resetError = ref<string | null>(null)
const resetDone = ref(false)

const mode = ref<'login' | 'register' | 'forgot' | 'reset' | 'invitation-loading' | 'invitation-error'>('login')

const API_URL = import.meta.env.VITE_API_URL || '/api'

onMounted(async () => {
  const token = route.query.token as string
  const isReset = route.path.includes('reset-password')

  if (isReset && token) {
    resetToken.value = token
    mode.value = 'reset'
  } else if (token) {
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

async function forgotPassword() {
  forgotLoading.value = true
  try {
    await fetch(`${API_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: forgotEmail.value }),
    })
    forgotSent.value = true
  } catch {
    forgotSent.value = true // mismo mensaje (no revelar si existe)
  } finally {
    forgotLoading.value = false
  }
}

async function resetPassword() {
  resetLoading.value = true
  resetError.value = null
  if (newPassword.value !== newPasswordConfirm.value) {
    resetError.value = 'Las contraseñas no coinciden'
    resetLoading.value = false
    return
  }
  if (newPassword.value.length < 8) {
    resetError.value = 'La contraseña debe tener al menos 8 caracteres'
    resetLoading.value = false
    return
  }
  try {
    const res = await fetch(`${API_URL}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken.value, newPassword: newPassword.value }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error')
    resetDone.value = true
  } catch (err: any) {
    resetError.value = err.message
  } finally {
    resetLoading.value = false
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
        <p class="text-slate-400 mt-2 text-sm">La invitación expiró, fue revocada o ya fue utilizada.</p>
        <router-link to="/login" class="inline-block mt-6 text-blue-400 hover:text-blue-300 text-sm">Ir a login →</router-link>
      </div>

      <!-- ── Register (con invitación) ── -->
      <div v-else-if="mode === 'register'" class="bg-slate-900 border border-slate-700/60 rounded-2xl p-8">
        <div class="text-center mb-8">
          <span class="text-4xl">🦞</span>
          <h1 class="text-2xl font-bold text-white mt-3">Únete a {{ invitationInfo?.workspaceName }}</h1>
          <p class="text-slate-400 text-sm mt-2">{{ invitationInfo?.invitedByName }} te invitó a colaborar en HQ</p>
        </div>
        <form @submit.prevent="register()" class="space-y-4">
          <div>
            <label class="block text-slate-400 text-sm mb-1.5">Nombre *</label>
            <input v-model="name" type="text" required class="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white" placeholder="Tu nombre" />
          </div>
          <div>
            <label class="block text-slate-400 text-sm mb-1.5">Email *</label>
            <input v-model="email" type="email" required disabled class="w-full px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-xl text-slate-400" />
            <p class="text-xs text-slate-500 mt-1">Fijado por la invitación</p>
          </div>
          <div>
            <label class="block text-slate-400 text-sm mb-1.5">Contraseña *</label>
            <input v-model="registerPassword" type="password" required minlength="8" class="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white" placeholder="Mínimo 8 caracteres" />
          </div>
          <div>
            <label class="block text-slate-400 text-sm mb-1.5">Confirmar contraseña *</label>
            <input v-model="registerPasswordConfirm" type="password" required minlength="8" class="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white" placeholder="Repetí tu contraseña" />
          </div>
          <div v-if="registerError" class="p-3 bg-red-900/30 border border-red-700/50 rounded-xl">
            <p class="text-red-400 text-sm">{{ registerError }}</p>
          </div>
          <button type="submit" :disabled="registerLoading" class="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition">
            {{ registerLoading ? 'Creando cuenta…' : 'Crear cuenta y entrar' }}
          </button>
        </form>
      </div>

      <!-- ── Forgot Password ── -->
      <div v-else-if="mode === 'forgot'" class="bg-slate-900 border border-slate-700/60 rounded-2xl p-8">
        <div class="text-center mb-8">
          <span class="text-4xl">🔑</span>
          <h1 class="text-2xl font-bold text-white mt-3">Recuperar contraseña</h1>
          <p class="text-slate-400 text-sm mt-2">Te enviaremos un link para crear una nueva</p>
        </div>

        <div v-if="!forgotSent" class="space-y-4">
          <div>
            <label class="block text-slate-400 text-sm mb-1.5">Email</label>
            <input v-model="forgotEmail" type="email" required class="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white" placeholder="tu@email.com" @keyup.enter="forgotPassword()" />
          </div>
          <button @click="forgotPassword()" :disabled="forgotLoading" class="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition">
            {{ forgotLoading ? 'Enviando…' : 'Enviar link de recuperación' }}
          </button>
        </div>

        <div v-else class="text-center py-4">
          <span class="text-4xl">📧</span>
          <p class="text-slate-300 mt-4 text-sm">Si el email existe, recibirás un link de recuperación en tu bandeja.</p>
        </div>

        <div class="mt-6 text-center">
          <button @click="mode = 'login'" class="text-slate-500 hover:text-slate-400 text-xs">← Volver a login</button>
        </div>
      </div>

      <!-- ── Reset Password ── -->
      <div v-else-if="mode === 'reset'" class="bg-slate-900 border border-slate-700/60 rounded-2xl p-8">
        <div class="text-center mb-8">
          <span class="text-4xl">🔐</span>
          <h1 class="text-2xl font-bold text-white mt-3">Nueva contraseña</h1>
          <p class="text-slate-400 text-sm mt-2">Creá tu nueva contraseña</p>
        </div>

        <div v-if="!resetDone" class="space-y-4">
          <div>
            <label class="block text-slate-400 text-sm mb-1.5">Nueva contraseña *</label>
            <input v-model="newPassword" type="password" required minlength="8" class="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white" placeholder="Mínimo 8 caracteres" />
          </div>
          <div>
            <label class="block text-slate-400 text-sm mb-1.5">Confirmar *</label>
            <input v-model="newPasswordConfirm" type="password" required minlength="8" class="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white" placeholder="Repetí la contraseña" @keyup.enter="resetPassword()" />
          </div>
          <div v-if="resetError" class="p-3 bg-red-900/30 border border-red-700/50 rounded-xl">
            <p class="text-red-400 text-sm">{{ resetError }}</p>
          </div>
          <button @click="resetPassword()" :disabled="resetLoading" class="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition">
            {{ resetLoading ? 'Guardando…' : 'Guardar nueva contraseña' }}
          </button>
        </div>

        <div v-else class="text-center py-4">
          <span class="text-4xl">✅</span>
          <p class="text-green-400 mt-4 text-sm font-medium">Contraseña actualizada</p>
          <button @click="mode = 'login'; router.push('/login')" class="mt-4 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition text-sm">
            Ir a login →
          </button>
        </div>
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
            <input v-model="email" type="email" required class="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white" placeholder="tu@email.com" />
          </div>
          <div>
            <label class="block text-slate-400 text-sm mb-1.5">Contraseña</label>
            <input v-model="password" type="password" required class="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white" placeholder="••••••••" />
          </div>
          <div v-if="error" class="p-3 bg-red-900/30 border border-red-700/50 rounded-xl">
            <p class="text-red-400 text-sm">{{ error }}</p>
          </div>
          <button type="submit" :disabled="loading" class="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition">
            {{ loading ? 'Ingresando…' : 'Ingresar' }}
          </button>
        </form>

        <div class="mt-4 text-center">
          <button @click="mode = 'forgot'" class="text-slate-500 hover:text-blue-400 text-xs transition">
            ¿Olvidaste tu contraseña?
          </button>
        </div>
      </div>

    </div>
  </div>
</template>
