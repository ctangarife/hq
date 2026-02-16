<template>
  <div class="logs-viewer" :class="containerClass">
    <div class="logs-header">
      <div class="logs-title">
        <h3>Agent Logs</h3>
        <span v-if="agentName" class="agent-name">{{ agentName }}</span>
        <span v-if="containerId" class="container-id">{{ containerId.slice(0, 12) }}...</span>
      </div>
      <div class="logs-actions">
        <button @click="toggleFullscreen" class="btn-icon" title="Toggle Fullscreen">
          ⛶
        </button>
        <button @click="$emit('close')" class="btn-icon" title="Close">X</button>
      </div>
    </div>

    <div class="logs-toolbar">
      <div class="toolbar-group">
        <label class="filter-label">Filter:</label>
        <select v-model="selectedFilter" class="filter-select">
          <option value="all">All</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
          <option value="debug">Debug</option>
        </select>
      </div>

      <div class="toolbar-group">
        <input v-model="searchQuery" type="text" placeholder="Search logs..." class="search-input" />
        <span v-if="filteredLogs.length !== logs.length" class="match-count">
          {{ filteredLogs.length }}/{{ logs.length }}
        </span>
      </div>

      <div class="toolbar-group">
        <label class="checkbox-label">
          <input type="checkbox" v-model="autoScroll" />
          Auto-scroll
        </label>
        <label class="checkbox-label">
          <input type="checkbox" v-model="isPaused" />
          Pause
        </label>
      </div>

      <div class="toolbar-group toolbar-group--right">
        <button @click="clearLogs" class="btn btn-secondary" title="Clear logs">Clear</button>
        <button @click="downloadLogs" class="btn btn-secondary" title="Download logs">Download</button>
      </div>
    </div>

    <div v-if="connectionStatus !== 'connected'" :class="statusClass" class="connection-status">
      <span v-if="connectionStatus === 'connecting'">Connecting to log stream...</span>
      <span v-if="connectionStatus === 'disconnected'">Disconnected from log stream</span>
      <span v-if="connectionStatus === 'error'">Error connecting to log stream</span>
    </div>

    <div class="logs-container" ref="logsContainer">
      <div v-if="filteredLogs.length === 0" class="logs-empty">
        <span v-if="logs.length === 0">Waiting for logs...</span>
        <span v-else>No logs match the current filter</span>
      </div>

      <div v-for="(log, index) in filteredLogs" :key="index" :class="getLogLineClass(log.level)">
        <span class="log-timestamp">{{ formatTimestamp(log.timestamp) }}</span>
        <span class="log-level">{{ log.level.toUpperCase() }}</span>
        <span class="log-message" v-html="highlightSearch(log.message)"></span>
      </div>
    </div>

    <div class="logs-footer">
      <span class="log-count">{{ logs.length }} total logs</span>
      <span v-if="logs.length > 0" class="last-update">
        Last update: {{ formatTimestamp(lastTimestamp) }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { agentsService } from '../services/api'

interface LogLine {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
}

interface Props {
  agentId: string
  agentName?: string
  containerId?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
}>()

const logs = ref<LogLine[]>([])
const selectedFilter = ref<string>('all')
const searchQuery = ref('')
const autoScroll = ref(true)
const isPaused = ref(false)
const isFullscreen = ref(false)
const connectionStatus = ref<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting')
const lastTimestamp = ref<string>(new Date().toISOString())
const logsContainer = ref<HTMLElement>()

let eventSource: EventSource | null = null

const containerClass = computed(() => {
  return isFullscreen.value ? 'logs-viewer logs-viewer--fullscreen' : 'logs-viewer'
})

const statusClass = computed(() => {
  return 'status-' + connectionStatus.value
})

const filteredLogs = computed(() => {
  let result = logs.value

  if (selectedFilter.value !== 'all') {
    result = result.filter(log => log.level === selectedFilter.value)
  }

  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(log =>
      log.message.toLowerCase().includes(query) ||
      log.timestamp.toLowerCase().includes(query)
    )
  }

  return result
})

function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch {
    return timestamp
  }
}

function highlightSearch(message: string): string {
  if (!searchQuery.value.trim()) return message
  const regex = new RegExp('(' + searchQuery.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi')
  return message.replace(regex, '<mark>$1</mark>')
}

function getLogLineClass(level: string): string {
  return 'log-line log-' + level
}

function scrollToBottom() {
  if (autoScroll.value && logsContainer.value) {
    nextTick(() => {
      if (logsContainer.value) {
        logsContainer.value.scrollTop = logsContainer.value.scrollHeight
      }
    })
  }
}

function clearLogs() {
  logs.value = []
}

function downloadLogs() {
  const lines = logs.value.map(log =>
    '[' + log.timestamp + '] [' + log.level.toUpperCase() + '] ' + log.message
  )
  const content = lines.join('\n')

  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const filename = 'agent-' + (props.agentName || props.agentId) + '-' + new Date().toISOString() + '.log'
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
}

function connectToLogStream() {
  connectionStatus.value = 'connecting'

  try {
    eventSource = agentsService.streamLogs(props.agentId)

    eventSource.onopen = () => {
      connectionStatus.value = 'connected'
    }

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)

      if (data.type === 'connected') {
        connectionStatus.value = 'connected'
        return
      }

      if (data.type === 'log' && !isPaused.value) {
        logs.value.push(data.data)
        lastTimestamp.value = data.data.timestamp

        if (logs.value.length > 1000) {
          logs.value = logs.value.slice(-1000)
        }

        scrollToBottom()
      }
    }

    eventSource.onerror = () => {
      connectionStatus.value = 'error'
    }
  } catch (error) {
    console.error('Error connecting to log stream:', error)
    connectionStatus.value = 'error'
  }
}

function disconnectFromLogStream() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
  connectionStatus.value = 'disconnected'
}

onMounted(() => {
  agentsService.getLogs(props.agentId, 100).then(response => {
    logs.value = response.data.logs || []
    if (logs.value.length > 0) {
      lastTimestamp.value = logs.value[logs.value.length - 1].timestamp
    }
    scrollToBottom()
  }).catch(error => {
    console.error('Error loading logs:', error)
  })

  connectToLogStream()
})

onUnmounted(() => {
  disconnectFromLogStream()
})

let reconnectInterval: ReturnType<typeof setInterval> | null = null

watch(connectionStatus, (status) => {
  if (status === 'error' || status === 'disconnected') {
    if (!reconnectInterval) {
      reconnectInterval = setInterval(() => {
        disconnectFromLogStream()
        connectToLogStream()
      }, 5000)
    }
  } else {
    if (reconnectInterval) {
      clearInterval(reconnectInterval)
      reconnectInterval = null
    }
  }
})
</script>

<style scoped>
.logs-viewer {
  display: flex;
  flex-direction: column;
  background: #1a1a2e;
  border-radius: 8px;
  overflow: hidden;
  max-height: 600px;
}

.logs-viewer--fullscreen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 100vh;
  z-index: 9999;
  border-radius: 0;
}

.logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #16213e;
  border-bottom: 1px solid #0f3460;
}

.logs-title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logs-title h3 {
  margin: 0;
  font-size: 16px;
  color: #e94560;
}

.agent-name {
  color: #fff;
  font-weight: 600;
}

.container-id {
  color: #6c757d;
  font-family: monospace;
  font-size: 12px;
}

.logs-actions {
  display: flex;
  gap: 8px;
}

.btn-icon {
  background: transparent;
  border: none;
  color: #6c757d;
  cursor: pointer;
  padding: 4px 8px;
  font-size: 18px;
  border-radius: 4px;
  transition: all 0.2s;
}

.btn-icon:hover {
  background: #0f3460;
  color: #fff;
}

.logs-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 16px;
  background: #0f3460;
  border-bottom: 1px solid #1a1a2e;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-group--right {
  margin-left: auto;
}

.filter-label,
.checkbox-label {
  color: #e94560;
  font-size: 13px;
  user-select: none;
}

.filter-select,
.search-input {
  background: #1a1a2e;
  border: 1px solid #0f3460;
  color: #fff;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 13px;
}

.filter-select:focus,
.search-input:focus {
  outline: none;
  border-color: #e94560;
}

.search-input {
  width: 200px;
}

.match-count {
  color: #6c757d;
  font-size: 12px;
}

.btn {
  background: #1a1a2e;
  border: 1px solid #0f3460;
  color: #fff;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.btn:hover {
  background: #0f3460;
}

.connection-status {
  padding: 8px 16px;
  text-align: center;
  font-size: 13px;
}

.status-connecting {
  background: #0f3460;
  color: #ffc107;
}

.status-connected {
  display: none;
}

.status-disconnected,
.status-error {
  background: #1a1a2e;
  color: #e94560;
}

.logs-container {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
}

.logs-container::-webkit-scrollbar {
  width: 8px;
}

.logs-container::-webkit-scrollbar-track {
  background: #1a1a2e;
}

.logs-container::-webkit-scrollbar-thumb {
  background: #0f3460;
  border-radius: 4px;
}

.logs-container::-webkit-scrollbar-thumb:hover {
  background: #e94560;
}

.logs-empty {
  text-align: center;
  color: #6c757d;
  padding: 40px 20px;
}

.log-line {
  display: flex;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid #16213e;
}

.log-timestamp {
  color: #6c757d;
  min-width: 80px;
}

.log-level {
  min-width: 50px;
  font-weight: 600;
}

.log-info .log-level {
  color: #4caf50;
}

.log-warn .log-level {
  color: #ffc107;
}

.log-error .log-level {
  color: #e94560;
}

.log-debug .log-level {
  color: #6c757d;
}

.log-message {
  color: #e0e0e0;
  flex: 1;
  word-break: break-all;
}

.log-message :deep(mark) {
  background: #e94560;
  color: #fff;
  padding: 0 2px;
  border-radius: 2px;
}

.logs-footer {
  display: flex;
  justify-content: space-between;
  padding: 8px 16px;
  background: #16213e;
  border-top: 1px solid #0f3460;
  font-size: 12px;
  color: #6c757d;
}
</style>
