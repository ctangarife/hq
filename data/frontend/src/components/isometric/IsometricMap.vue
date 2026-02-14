<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { Application, Container, Graphics, Text } from 'pixi.js'
import { RobotSprite, AGENT_COLORS } from './RobotSprite'

interface Agent {
  _id: string
  name: string
  role?: string
  status: string
  containerId?: string
  color?: string
}

interface Task {
  _id: string
  assignedTo?: string
  status: string
  missionId: string
}

interface Zone {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  color: number
}

const props = defineProps<{
  agents: Agent[]
  tasks?: Task[]
}>()

const emit = defineEmits<{
  agentClick: [agent: Agent]
  zoneClick: [zone: Zone]
}>()

const canvasContainer = ref<HTMLDivElement>()
let app: Application | null = null
let mapContainer: Container | null = null
const robotSprites = new Map<string, RobotSprite>()

// Zonas del mapa HQ
const zones: Zone[] = [
  {
    id: 'mission-control',
    name: 'Mission Control',
    x: 0,
    y: -100,
    width: 200,
    height: 120,
    color: 0x1E40AF
  },
  {
    id: 'work-area',
    name: 'Work Area',
    x: -150,
    y: 50,
    width: 180,
    height: 100,
    color: 0x065F46
  },
  {
    id: 'lounge',
    name: 'Lounge',
    x: 150,
    y: 50,
    width: 160,
    height: 100,
    color: 0x7C2D12
  }
]

async function initPixi() {
  if (!canvasContainer.value) return

  app = new Application()
  await app.init({
    width: canvasContainer.value.clientWidth,
    height: canvasContainer.value.clientHeight,
    backgroundColor: 0x111827,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true
  })

  canvasContainer.value.appendChild(app.canvas)

  mapContainer = new Container()
  mapContainer.x = app.canvas.width / 2
  mapContainer.y = app.canvas.height / 2
  app.stage.addChild(mapContainer)

  drawZones()
  updateAgentSprites()

  mapContainer.scale.set(0.8)
}

function drawZones() {
  if (!mapContainer) return

  zones.forEach(zone => {
    const g = new Graphics()
    g.x = zone.x
    g.y = zone.y
    g.cursor = 'pointer'

    const hw = zone.width / 2
    const hh = zone.height / 2

    // Fondo
    g.beginPath()
    g.moveTo(0, -hh)
    g.lineTo(hw, 0)
    g.lineTo(0, hh)
    g.lineTo(-hw, 0)
    g.closePath()
    g.fill({ color: zone.color, alpha: 0.3 })

    // Borde
    g.beginPath()
    g.moveTo(0, -hh)
    g.lineTo(hw, 0)
    g.lineTo(0, hh)
    g.lineTo(-hw, 0)
    g.closePath()
    g.stroke({ width: 2, color: zone.color, alpha: 0.8 })

    // Grosor 3D
    const thickness = 8
    g.beginPath()
    g.moveTo(-hw, 0)
    g.lineTo(-hw, thickness)
    g.lineTo(0, hh + thickness)
    g.lineTo(0, hh)
    g.closePath()
    g.fill({ color: zone.color, alpha: 0.5 })

    // Etiqueta
    const label = new Text({
      text: zone.name,
      style: {
        fontSize: 14,
        fill: 0xFFFFFF,
        align: 'center'
      }
    })
    label.x = -label.width / 2
    label.y = -10
    g.addChild(label)

    // Click
    g.eventMode = 'static'
    g.on('pointerdown', () => emit('zoneClick', zone))

    if (mapContainer) {
      mapContainer.addChild(g)
    }
  })
}

function getAgentColor(agent: Agent): number {
  const roleColors: Record<string, number> = {
    coder: AGENT_COLORS.coder,
    developer: AGENT_COLORS.coder,
    researcher: AGENT_COLORS.researcher,
    planner: AGENT_COLORS.planner,
    reviewer: AGENT_COLORS.reviewer,
    manager: AGENT_COLORS.planner
  }
  return roleColors[agent.role?.toLowerCase() || ''] || AGENT_COLORS.default
}

function getAgentPosition(agent: Agent): { x: number; y: number } {
  const lounge = zones.find(z => z.id === 'lounge')!
  const workArea = zones.find(z => z.id === 'work-area')!

  const hasActiveTasks = props.tasks && props.tasks.some(
    t => t.assignedTo === agent.containerId && (t.status === 'pending' || t.status === 'in_progress')
  )

  if (agent.status === 'offline' || agent.status === 'inactive' || !agent.containerId || !hasActiveTasks) {
    const hash = agent._id.split('').reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0)
    const offsetX = (hash % 60) - 30
    const offsetY = ((hash >> 8) % 30) - 15
    return { x: lounge.x + offsetX, y: lounge.y + offsetY }
  }

  const hash = agent._id.split('').reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0)
  const offsetX = (hash % 80) - 40
  const offsetY = ((hash >> 8) % 40) - 20
  return { x: workArea.x + offsetX, y: workArea.y + offsetY }
}

function getRobotState(agent: Agent): 'idle' | 'walking' | 'working' | 'error' | 'happy' {
  if (agent.status === 'failed' || agent.status === 'error') return 'error'
  if (agent.status === 'offline') return 'idle'
  if (agent.status === 'active') return 'working'
  return 'idle'
}

function updateAgentSprites() {
  if (!mapContainer) return

  const currentAgentIds = new Set(props.agents.map(a => a._id))
  for (const [agentId, sprite] of robotSprites.entries()) {
    if (!currentAgentIds.has(agentId)) {
      mapContainer.removeChild(sprite)
      sprite.destroy()
      robotSprites.delete(agentId)
    }
  }

  props.agents.forEach(agent => {
    let sprite = robotSprites.get(agent._id)

    if (!sprite) {
      const color = getAgentColor(agent)
      sprite = new RobotSprite(agent.name, color)
      sprite.eventMode = 'static'
      sprite.on('pointerdown', () => emit('agentClick', agent))

      const pos = getAgentPosition(agent)
      sprite.x = pos.x
      sprite.y = pos.y

      if (mapContainer) {
        mapContainer.addChild(sprite)
      }
      robotSprites.set(agent._id, sprite)
    } else {
      sprite.state = getRobotState(agent)
    }
  })
}

function handleResize() {
  if (!app || !canvasContainer.value) return

  app.renderer.resize(
    canvasContainer.value.clientWidth,
    canvasContainer.value.clientHeight
  )

  if (mapContainer) {
    mapContainer.x = app.canvas.width / 2
    mapContainer.y = app.canvas.height / 2
  }
}

watch(() => props.agents, () => {
  updateAgentSprites()
}, { deep: true })

onMounted(async () => {
  await initPixi()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)

  robotSprites.forEach(sprite => sprite.destroy())
  robotSprites.clear()

  if (app) {
    app.destroy(true)
    app = null
  }
})
</script>

<template>
  <div ref="canvasContainer" class="isometric-map"></div>
</template>

<style scoped>
.isometric-map {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.isometric-map :deep(canvas) {
  display: block;
}
</style>
