<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { avatarDataUri, avatarDataUriSync, styleCache } from '@/composables/useAvatar'

const props = withDefaults(defineProps<{
  seed?: string
  size?: number
  styleKey?: string
  equipped?: Record<string, string>
}>(), {
  seed: 'papa',
  size: 64,
  styleKey: 'pixel-art',
  equipped: () => ({}),
})

const src = ref<string>('')

async function generate() {
  const cached = styleCache[props.styleKey]
  if (cached) {
    src.value = avatarDataUriSync(cached, props.seed, props.size, props.equipped)
    return
  }
  src.value = await avatarDataUri(props.seed, props.size, props.styleKey, props.equipped)
}

onMounted(generate)
watch(() => [props.seed, props.size, props.styleKey, props.equipped], generate, { deep: true })
</script>

<template>
  <img
    v-if="src"
    :src="src"
    :width="size"
    :height="size"
    :style="{ imageRendering: styleKey === 'pixel-art' ? 'pixelated' : 'auto' }"
    alt="Avatar"
    class="dicebear-avatar"
  />
  <div
    v-else
    class="avatar-placeholder"
    :style="{ width: size + 'px', height: size + 'px' }"
  />
</template>

<style scoped>
.dicebear-avatar {
  display: block;
  border-radius: 50%;
}

.avatar-placeholder {
  display: block;
  border-radius: 50%;
  background: var(--color-bg-input, #2a2a2a);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.8; }
}
</style>
