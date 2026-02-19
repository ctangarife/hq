<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'

interface Props {
  missionId: string
  token: string
}

const props = defineProps<Props>()

interface DAGNode {
  taskId: string
  title: string
  status: string
  dependencies: string[]
  level: number
  canExecute: boolean
  blockingReason?: string
}

interface DAGEdge {
  from: string
  to: string
  status: 'valid' | 'blocked' | 'completed'
}

interface DAGGraph {
  nodes: DAGNode[]
  edges: DAGEdge[]
  levels: number
  hasCycles: boolean
  cycles: string[][]
}

const dag = ref<DAGGraph | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const selectedNode = ref<DAGNode | null>(null)

// Stats
const stats = ref<any>(null)
const executableTasks = ref<any[]>([])
const blockedTasks = ref<any[]>([])

// Canvas dimensions
const canvasWidth = ref(800)
const canvasHeight = ref(500)
const nodeRadius = 25
const levelHeight = 120

const emit = defineEmits<{
  taskClick: [task: any]
}>()

// Load DAG data
const loadDAG = async () => {
  try {
    loading.value = true
    error.value = null

    // Load DAG, stats, executable and blocked tasks in parallel
    const [dagRes, statsRes, executableRes, blockedRes] = await Promise.all([
      fetch(`${import.meta.env.VITE_API_URL || '/api'}/tasks/mission/${props.missionId}/dag`, {
        headers: { 'Authorization': `Bearer ${props.token}` }
      }).then(r => r.json()),
      fetch(`${import.meta.env.VITE_API_URL || '/api'}/tasks/mission/${props.missionId}/dependencies/stats`, {
        headers: { 'Authorization': `Bearer ${props.token}` }
      }).then(r => r.json()),
      fetch(`${import.meta.env.VITE_API_URL || '/api'}/tasks/mission/${props.missionId}/dependencies/executable`, {
        headers: { 'Authorization': `Bearer ${props.token}` }
      }).then(r => r.json()),
      fetch(`${import.meta.env.VITE_API_URL || '/api'}/tasks/mission/${props.missionId}/dependencies/blocked`, {
        headers: { 'Authorization': `Bearer ${props.token}` }
      }).then(r => r.json())
    ])

    dag.value = dagRes
    stats.value = statsRes
    executableTasks.value = executableRes.tasks || []
    blockedTasks.value = blockedRes.blocked || []

    // Adjust canvas height based on levels
    canvasHeight.value = Math.max(400, ((dag.value?.levels || 0) * levelHeight) + 100)
  } catch (err: any) {
    error.value = err.message || 'Error loading dependency graph'
    console.error('Error loading DAG:', err)
  } finally {
    loading.value = false
  }
}

// Node positions
const nodePositions = computed(() => {
  if (!dag.value) return new Map()

  const positions = new Map<string, { x: number; y: number }>()
  const nodesByLevel = new Map<number, DAGNode[]>()

  // Group nodes by level
  for (const node of dag.value.nodes) {
    if (!nodesByLevel.has(node.level)) {
      nodesByLevel.set(node.level, [])
    }
    nodesByLevel.get(node.level)!.push(node)
  }

  // Calculate positions
  const levelWidth = canvasWidth.value / (dag.value.levels + 1)

  for (const [level, levelNodes] of nodesByLevel.entries()) {
    const nodeCount = levelNodes.length
    const verticalSpacing = canvasHeight.value / (nodeCount + 1)

    levelNodes.forEach((node, index) => {
      const x = (level + 1) * levelWidth - levelWidth / 2
      const y = (index + 1) * verticalSpacing
      positions.set(node.taskId, { x, y })
    })
  }

  return positions
})

// Draw edges
const drawEdges = (ctx: CanvasRenderingContext2D) => {
  if (!dag.value) return

  const positions = nodePositions.value

  ctx.lineWidth = 2

  for (const edge of dag.value.edges) {
    const from = positions.get(edge.from)
    const to = positions.get(edge.to)

    if (from && to) {
      // Set color based on status
      switch (edge.status) {
        case 'completed':
          ctx.strokeStyle = '#22c55e'  // green
          break
        case 'blocked':
          ctx.strokeStyle = '#ef4444'  // red
          break
        default:
          ctx.strokeStyle = '#6b7280'  // gray
      }

      // Draw curved line
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)

      // Bezier curve for smoother look
      const midX = (from.x + to.x) / 2
      ctx.bezierCurveTo(midX, from.y, midX, to.y, to.x, to.y)

      ctx.stroke()

      // Draw arrow head
      const angle = Math.atan2(to.y - from.y, to.x - from.x)
      const arrowLength = 10
      ctx.beginPath()
      ctx.moveTo(to.x, to.y)
      ctx.lineTo(
        to.x - arrowLength * Math.cos(angle - Math.PI / 6),
        to.y - arrowLength * Math.sin(angle - Math.PI / 6)
      )
      ctx.moveTo(to.x, to.y)
      ctx.lineTo(
        to.x - arrowLength * Math.cos(angle + Math.PI / 6),
        to.y - arrowLength * Math.sin(angle + Math.PI / 6)
      )
      ctx.stroke()
    }
  }
}

// Draw nodes
const drawNodes = (ctx: CanvasRenderingContext2D) => {
  if (!dag.value) return

  const positions = nodePositions.value

  for (const node of dag.value.nodes) {
    const pos = positions.get(node.taskId)
    if (!pos) continue

    // Set color based on status
    let fillColor = '#6b7280'  // gray (pending)
    let strokeColor = '#9ca3af'

    switch (node.status) {
      case 'completed':
        fillColor = '#22c55e'  // green
        strokeColor = '#16a34a'
        break
      case 'in_progress':
        fillColor = '#3b82f6'  // blue
        strokeColor = '#2563eb'
        break
      case 'failed':
        fillColor = '#ef4444'  // red
        strokeColor = '#dc2626'
        break
      case 'blocked':
        fillColor = '#f59e0b'  // orange
        strokeColor = '#d97706'
        break
    }

    // Highlight if selected
    if (selectedNode.value?.taskId === node.taskId) {
      strokeColor = '#fbbf24'  // yellow
      ctx.lineWidth = 4
    } else {
      ctx.lineWidth = 2
    }

    // Draw circle
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, nodeRadius, 0, Math.PI * 2)
    ctx.fillStyle = fillColor
    ctx.fill()
    ctx.strokeStyle = strokeColor
    ctx.stroke()

    // Draw title
    ctx.fillStyle = '#fff'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // Truncate title if too long
    const title = node.title.length > 15 ? node.title.substring(0, 12) + '...' : node.title
    ctx.fillText(title, pos.x, pos.y)

    // Draw status icon
    const icon = node.status === 'completed' ? '✓' :
                  node.status === 'in_progress' ? '⟳' :
                  node.status === 'failed' ? '✗' :
                  node.canExecute ? '●' : '⊘'

    ctx.fillStyle = '#fff'
    ctx.font = 'bold 12px sans-serif'
    ctx.fillText(icon, pos.x, pos.y - nodeRadius - 8)
  }
}

// Draw DAG
const drawDAG = () => {
  const canvas = document.getElementById('dag-canvas') as HTMLCanvasElement
  if (!canvas) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Clear canvas
  ctx.clearRect(0, 0, canvasWidth.value, canvasHeight.value)

  // Draw edges first (so nodes appear on top)
  drawEdges(ctx)

  // Draw nodes
  drawNodes(ctx)
}

// Handle click on canvas
const handleCanvasClick = (event: MouseEvent) => {
  const canvas = event.target as HTMLCanvasElement
  const rect = canvas.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top

  const positions = nodePositions.value

  // Find clicked node
  for (const node of dag.value?.nodes || []) {
    const pos = positions.get(node.taskId)
    if (pos) {
      const distance = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2)
      if (distance <= nodeRadius) {
        selectedNode.value = node
        emit('taskClick', node)
        drawDAG()  // Redraw to show selection
        break
      }
    }
  }
}

onMounted(() => {
  loadDAG()

  // Setup canvas event listener
  const canvas = document.getElementById('dag-canvas')
  if (canvas) {
    canvas.addEventListener('click', handleCanvasClick)
  }
})

// Reload when missionId changes
watch(() => props.missionId, () => {
  loadDAG()
})
</script>

<template>
  <div class="task-dependency-graph">
    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-8">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
      <span class="ml-3 text-gray-400">Cargando grafo de dependencias...</span>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="bg-red-900/30 border border-red-800 rounded-lg p-4">
      <p class="text-red-400">{{ error }}</p>
    </div>

    <!-- DAG Content -->
    <div v-else-if="dag">
      <!-- Header Stats -->
      <div class="grid grid-cols-4 gap-3 mb-4 text-sm">
        <div class="bg-gray-800 rounded-lg p-3 border border-gray-700">
          <div class="text-gray-400 text-xs">Total Tareas</div>
          <div class="text-xl font-bold text-white">{{ stats?.totalTasks || 0 }}</div>
        </div>
        <div class="bg-gray-800 rounded-lg p-3 border border-gray-700">
          <div class="text-gray-400 text-xs">Con Dependencias</div>
          <div class="text-xl font-bold text-white">{{ stats?.tasksWithDependencies || 0 }}</div>
        </div>
        <div class="bg-green-900/30 rounded-lg p-3 border border-green-800">
          <div class="text-green-400 text-xs">Listas para Ejecutar</div>
          <div class="text-xl font-bold text-green-400">{{ executableTasks.length }}</div>
        </div>
        <div class="bg-orange-900/30 rounded-lg p-3 border border-orange-800">
          <div class="text-orange-400 text-xs">Bloqueadas</div>
          <div class="text-xl font-bold text-orange-400">{{ blockedTasks.length }}</div>
        </div>
      </div>

      <!-- Cycle Warning -->
      <div v-if="dag.hasCycles" class="bg-red-900/30 border border-red-800 rounded-lg p-3 mb-4">
        <div class="flex items-center gap-2 text-red-400">
          <span>⚠️</span>
          <span class="font-medium">Dependencias Circulares Detectadas</span>
        </div>
        <div class="mt-2 text-sm text-red-300">
          <div v-for="(cycle, index) in dag.cycles" :key="index" class="flex flex-wrap gap-1">
            <span v-for="taskId in cycle" :key="taskId" class="px-2 py-1 bg-red-900/50 rounded">
              {{ dag.nodes.find(n => n.taskId === taskId)?.title?.substring(0, 15) || taskId }}
            </span>
          </div>
        </div>
      </div>

      <!-- Canvas -->
      <div class="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
        <canvas
          id="dag-canvas"
          :width="canvasWidth"
          :height="canvasHeight"
          class="cursor-pointer"
        ></canvas>
      </div>

      <!-- Legend -->
      <div class="mt-3 flex items-center gap-4 text-xs text-gray-400">
        <div class="flex items-center gap-1">
          <span class="w-3 h-3 rounded-full bg-green-500"></span>
          <span>Completada</span>
        </div>
        <div class="flex items-center gap-1">
          <span class="w-3 h-3 rounded-full bg-blue-500"></span>
          <span>En Progreso</span>
        </div>
        <div class="flex items-center gap-1">
          <span class="w-3 h-3 rounded-full bg-gray-500"></span>
          <span>Pendiente</span>
        </div>
        <div class="flex items-center gap-1">
          <span class="w-3 h-3 rounded-full bg-orange-500"></span>
          <span>Bloqueada</span>
        </div>
        <div class="flex items-center gap-1">
          <span class="w-3 h-3 rounded-full bg-red-500"></span>
          <span>Fallida</span>
        </div>
      </div>

      <!-- Selected Node Info -->
      <div v-if="selectedNode" class="mt-4 bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h4 class="text-white font-medium mb-2">Tarea Seleccionada</h4>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span class="text-gray-400">Título:</span>
            <span class="text-white ml-2">{{ selectedNode.title }}</span>
          </div>
          <div>
            <span class="text-gray-400">Estado:</span>
            <span class="ml-2" :class="{
              'text-green-400': selectedNode.status === 'completed',
              'text-blue-400': selectedNode.status === 'in_progress',
              'text-gray-400': selectedNode.status === 'pending',
              'text-red-400': selectedNode.status === 'failed'
            }">{{ selectedNode.status }}</span>
          </div>
          <div>
            <span class="text-gray-400">Nivel:</span>
            <span class="text-white ml-2">{{ selectedNode.level }}</span>
          </div>
          <div>
            <span class="text-gray-400">Puede Ejecutar:</span>
            <span class="ml-2" :class="{
              'text-green-400': selectedNode.canExecute,
              'text-red-400': !selectedNode.canExecute
            }">{{ selectedNode.canExecute ? 'Sí' : 'No' }}</span>
          </div>
        </div>
        <div v-if="!selectedNode.canExecute" class="mt-2 text-xs text-orange-400">
          {{ selectedNode.blockingReason }}
        </div>
        <div v-if="selectedNode.dependencies.length > 0" class="mt-2">
          <span class="text-gray-400 text-xs">Depende de:</span>
          <div class="flex flex-wrap gap-1 mt-1">
            <span
              v-for="depId in selectedNode.dependencies"
              :key="depId"
              class="px-2 py-1 bg-gray-700 rounded text-xs text-gray-300"
            >
              {{ dag?.nodes.find(n => n.taskId === depId)?.title?.substring(0, 20) || depId }}
            </span>
          </div>
        </div>
      </div>

      <!-- Refresh Button -->
      <button
        @click="loadDAG"
        class="mt-3 w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition text-sm"
      >
        🔄 Actualizar Grafo
      </button>
    </div>
  </div>
</template>

<style scoped>
.task-dependency-graph {
  @apply relative;
}

canvas {
  display: block;
}
</style>
