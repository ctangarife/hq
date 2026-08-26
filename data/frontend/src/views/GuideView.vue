<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

const steps = [
  {
    icon: '✉️',
    title: 'Recibís una invitación',
    description: 'Te llega un email de HQ con un botón para aceptar la invitación al workspace de tu equipo o negocio.',
    detail: 'El email viene de noreply@ctangarife.com con asunto "Te invitaron a..."',
  },
  {
    icon: '🔐',
    title: 'Creás tu cuenta',
    description: 'Definís tu nombre y contraseña (mínimo 8 caracteres). Tu email ya viene fijado por la invitación.',
    detail: 'No necesitás instalar nada — todo funciona en el navegador.',
  },
  {
    icon: '✨',
    title: 'Creás tu primera misión',
    description: 'En "Misiones" → "Nueva Misión" escribís tu idea en una línea y hacés click en "✨ Enriquecer". La IA la convierte en un brief profesional completo.',
    detail: 'Ejemplo: "3 posts para Instagram de mi cafetería" → brief con audiencia, tono, entregables y calendario.',
    link: '/missions',
    linkLabel: 'Ir a Misiones',
  },
  {
    icon: '🤖',
    title: 'Los agentes trabajan',
    description: 'HQ asigna automáticamente especialistas: un Writer para el contenido, un Researcher para investigar, un Designer para los prompts de imagen. Cada uno usa el modelo de IA que mejor le corresponde.',
    detail: 'Puedes verlos trabajar en tiempo real en la vista "Actividad" — un mapa isométrico donde los agentes se mueven mientras ejecutan tareas.',
    link: '/activity',
    linkLabel: 'Ver Actividad',
  },
  {
    icon: '📄',
    title: 'Descargás tu entregable',
    description: 'Cuando la misión termina, hacés click en "Consolidar" y HQ genera un PDF pulido con todo el contenido: posts listos para publicar, guiones visuales, calendario editorial.',
    detail: 'El PDF incluye instrucciones de publicación y marcadores [DATO: ...] donde necesitás completar información específica de tu negocio.',
  },
  {
    icon: '👥',
    title: 'Invitás a tu equipo',
    description: 'Si sos propietario o admin del workspace, podés invitar a más personas desde "Admin" → "Miembros". Cada persona recibe un email y entra con su propia cuenta.',
    detail: 'Roles disponibles: Propietario, Admin, Miembro y Lector.',
    link: '/admin',
    linkLabel: 'Ir a Admin',
  },
]

const tips = [
  { icon: '💡', text: 'Mientras más específico sea tu brief, mejor será el resultado. Nombres de productos, precios y barrios reales hacen la diferencia.' },
  { icon: '🔑', text: 'Podés cambiar tu contraseña cuando quieras con el botón 🔑 en la barra superior.' },
  { icon: '🎨', text: 'Los prompts de imagen están listos para pegar en herramientas como Gemini, Flux o Midjourney.' },
  { icon: '⏱️', text: 'Una misión típica tarda entre 2 y 5 minutos. Podés navegar libremente mientras trabaja.' },
]
</script>

<template>
  <div class="p-6 max-w-4xl mx-auto">
    <header class="text-center mb-12">
      <span class="text-5xl">🦞</span>
      <h1 class="text-3xl font-bold text-white mt-4">Cómo usar HQ</h1>
      <p class="text-slate-400 mt-3 text-lg">
        De una idea a un entregable completo en minutos.
      </p>
    </header>

    <!-- Steps -->
    <div class="space-y-8">
      <div
        v-for="(step, i) in steps"
        :key="i"
        class="flex gap-6 group"
      >
        <!-- Number + icon -->
        <div class="flex flex-col items-center">
          <div
            class="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold shrink-0 transition-all"
            :class="i === 0 ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 group-hover:bg-blue-600 group-hover:text-white'"
          >
            {{ step.icon }}
          </div>
          <!-- Connector line -->
          <div v-if="i < steps.length - 1" class="w-px h-full bg-slate-700/50 mt-2"></div>
        </div>

        <!-- Content -->
        <div class="pb-8">
          <div class="flex items-baseline gap-3">
            <span class="text-slate-600 font-mono text-sm">{{ String(i + 1).padStart(2, '0') }}</span>
            <h2 class="text-xl font-semibold text-white">{{ step.title }}</h2>
          </div>
          <p class="text-slate-300 mt-2 leading-relaxed">{{ step.description }}</p>
          <p class="text-slate-500 text-sm mt-2 italic">{{ step.detail }}</p>
          <button
            v-if="step.link"
            @click="router.push(step.link)"
            class="mt-3 inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-sm font-medium transition"
          >
            {{ step.linkLabel }} →
          </button>
        </div>
      </div>
    </div>

    <!-- Tips -->
    <div class="mt-4 bg-slate-800/60 rounded-2xl p-6 border border-slate-700/50">
      <h3 class="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-4">💡 Tips</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div v-for="tip in tips" :key="tip.text" class="flex items-start gap-3">
          <span class="text-lg shrink-0">{{ tip.icon }}</span>
          <p class="text-slate-400 text-sm leading-relaxed">{{ tip.text }}</p>
        </div>
      </div>
    </div>

    <!-- CTA -->
    <div class="mt-8 text-center pb-8">
      <button
        @click="router.push('/missions')"
        class="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition text-lg"
      >
        Crear mi primera misión →
      </button>
    </div>
  </div>
</template>
