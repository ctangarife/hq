<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'

interface Props {
  taskId: string
  token: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  complete: [output: any]
  error: [error: string]
}>()

const partialOutput = ref('')
const status = ref<'connecting' | 'connected' | 'completed' | 'error'>('connecting')
const errorMessage = ref('')
const eventSource = ref<EventSource | null>(null)

const outputLines = computed(() => {
  if (!partialOutput.value) return []
  return partialOutput.value.split('\n').filter(line => line.trim())
})

const isStreaming = computed(() => status.value === 'connected')

const connectToStream = () => {
  status.value = 'connecting'

  const url = `${import.meta.env.VITE_API_URL || '/api'}/tasks/${props.taskId}/stream`
  const token = props.token

  // Create EventSource with authorization
  const source = new EventSource(`${url}?token=${token}`)
  eventSource.value = source

  source.onopen = () => {
    console.log('SSE connected')
    status.value = 'connected'
  }

  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)

      switch (data.type) {
        case 'state':
          if (data.partialOutput) {
            partialOutput.value = data.partialOutput
          }
          if (data.status === 'completed') {
            status.value = 'completed'
            emit('complete', data.output)
          }
          if (data.status === 'failed') {
            status.value = 'error'
            errorMessage.value = data.error || 'Task failed'
            emit('error', errorMessage.value)
          }
          break

        case 'partial_output':
          if (data.data.partialOutput) {
            partialOutput.value = data.data.partialOutput
          }
          break

        case 'done':
          status.value = 'completed'
          partialOutput.value = data.output || ''
          emit('complete', data.output)
          break
      }
    } catch (error) {
      console.error('Error parsing SSE data:', error)
    }
  }

  source.onerror = (error) => {
    console.error('SSE error:', error)
    status.value = 'error'
    errorMessage.value = 'Connection lost'
    source.close()
  }
}

const disconnect = () => {
  if (eventSource.value) {
    eventSource.value.close()
    eventSource.value = null
  }
}

onMounted(() => {
  connectToStream()
})

onUnmounted(() => {
  disconnect()
})

// Expose disconnect method
defineExpose({
  disconnect,
  reconnect: connectToStream
})
</script>

<template>
  <div class="task-output-stream">
    <!-- Status indicator -->
    <div class="flex items-center gap-2 mb-2 text-xs">
      <span v-if="status === 'connecting'" class="text-yellow-400">
        ⏳ Conectando...
      </span>
      <span v-else-if="status === 'connected'" class="text-green-400 flex items-center gap-1">
        <span class="animate-pulse">🔴</span>
        <span>Live</span>
      </span>
      <span v-else-if="status === 'completed'" class="text-blue-400">
        ✅ Completado
      </span>
      <span v-else-if="status === 'error'" class="text-red-400">
        ❌ {{ errorMessage || 'Error' }}
      </span>
    </div>

    <!-- Output display -->
    <div class="bg-gray-900 rounded-lg p-3 font-mono text-sm max-h-[300px] overflow-y-auto">
      <div v-if="!partialOutput && status === 'connecting'" class="text-gray-500 italic">
        Esperando output del agente...
      </div>

      <div v-else-if="!partialOutput && status === 'connected'" class="text-gray-500 italic">
        El agente está trabajando...
      </div>

      <div v-else class="space-y-1">
        <div
          v-for="(line, index) in outputLines"
          :key="index"
          class="text-gray-300 whitespace-pre-wrap break-words"
          :class="{ 'animate-pulse': index === outputLines.length - 1 && isStreaming }"
        >
          {{ line }}
        </div>
      </div>

      <!-- Cursor for streaming effect -->
      <div v-if="isStreaming && partialOutput" class="inline-block w-2 h-4 bg-green-400 animate-pulse ml-1"></div>
    </div>
  </div>
</template>

<style scoped>
.task-output-stream {
  @apply relative;
}

/* Custom scrollbar */
.bg-gray-900.rounded-lg {
  scrollbar-width: thin;
  scrollbar-color: #4B5563 #1F2937;
}

.bg-gray-900.rounded-lg::-webkit-scrollbar {
  width: 6px;
}

.bg-gray-900.rounded-lg::-webkit-scrollbar-track {
  background: #1F2937;
  border-radius: 3px;
}

.bg-gray-900.rounded-lg::-webkit-scrollbar-thumb {
  background: #4B5563;
  border-radius: 3px;
}

.bg-gray-900.rounded-lg::-webkit-scrollbar-thumb:hover {
  background: #6B7280;
}
</style>
