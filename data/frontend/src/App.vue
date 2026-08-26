<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppNav from '@/components/AppNav.vue'

const route = useRoute()

// Ocultar nav en páginas de auth (login, aceptar invitación)
const showNav = computed(() => {
  const authPages = ['/login', '/accept-invitation']
  return !authPages.some(p => route.path.startsWith(p))
})
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-gray-100">
    <AppNav v-if="showNav" />
    <RouterView />
  </div>
</template>

<style scoped>
</style>
