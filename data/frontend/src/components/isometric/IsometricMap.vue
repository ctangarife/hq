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

// Zonas del mapa HQ - actualizadas para los tres estados de trabajo
const zones: Zone[] = [
  {
    id: 'work-control',
    name: '🎯 Work Control',
    x: 0,
    y: -100,
    width: 220,
    height: 100,
    color: 0x7C3AED  // Purple - agents waiting for task
  },
  {
    id: 'work-area',
    name: '⚡ Work Area',
    x: -150,
    y: 50,
    width: 180,
    height: 100,
    color: 0x059669  // Green - agents working
  },
  {
    id: 'lounge',
    name: '☕ Lounge',
    x: 150,
    y: 50,
    width: 160,
    height: 100,
    color: 0xB45309  // Orange/Amber - idle agents
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

    // Fondo con gradiente de alpha
    g.beginPath()
    g.moveTo(0, -hh)
    g.lineTo(hw, 0)
    g.lineTo(0, hh)
    g.lineTo(-hw, 0)
    g.closePath()
    g.fill({ color: zone.color, alpha: 0.25 })

    // Borde
    g.beginPath()
    g.moveTo(0, -hh)
    g.lineTo(hw, 0)
    g.lineTo(0, hh)
    g.lineTo(-hw, 0)
    g.closePath()
    g.stroke({ width: 2, color: zone.color, alpha: 0.9 })

    // Grosor 3D
    const thickness = 10
    g.beginPath()
    g.moveTo(-hw, 0)
    g.lineTo(-hw, thickness)
    g.lineTo(0, hh + thickness)
    g.lineTo(0, hh)
    g.closePath()
    g.fill({ color: zone.color, alpha: 0.6 })

    // Grosor lateral derecho
    g.beginPath()
    g.moveTo(0, hh)
    g.lineTo(0, hh + thickness)
    g.lineTo(hw, thickness)
    g.lineTo(hw, 0)
    g.closePath()
    g.fill({ color: zone.color, alpha: 0.4 })

    // Etiqueta con emoji
    const label = new Text({
      text: zone.name,
      style: {
        fontSize: 16,
        fontWeight: 'bold',
        fill: 0xFFFFFF,
        align: 'center'
      }
    })
    label.x = -label.width / 2
    label.y = -hh - 25
    g.addChild(label)

    // Contador de agentes en esta zona
    const agentCount = getAgentsInZone(zone.id).length
    if (agentCount > 0) {
      const countLabel = new Text({
        text: `${agentCount} agent${agentCount > 1 ? 's' : ''}`,
        style: {
          fontSize: 12,
          fill: 0xCCCCCC,
          align: 'center'
        }
      })
      countLabel.x = -countLabel.width / 2
      countLabel.y = 15
      g.addChild(countLabel)
    }

    // Click
    g.eventMode = 'static'
    g.on('pointerdown', () => emit('zoneClick', zone))

    if (mapContainer) {
      mapContainer.addChild(g)
    }
  })
}

function getAgentsInZone(zoneId: string): Agent[] {
  return props.agents.filter(agent => getAgentZone(agent) === zoneId)
}

function getAgentZone(agent: Agent): string {
  // Determinar en qué zona debería estar el agente
  if (!agent.containerId || agent.status === 'offline' || agent.status === 'inactive') {
    return 'lounge'
  }

  // Ver tareas asignadas a este agente
  const hasPendingTask = props.tasks && props.tasks.some(
    t => t.assignedTo === agent.containerId && t.status === 'pending'
  )

  const hasInProgressTask = props.tasks && props.tasks.some(
    t => t.assignedTo === agent.containerId && t.status === 'in_progress'
  )

  if (hasPendingTask) {
    return 'work-control'  // Tiene tarea asignada, esperando
  } else if (hasInProgressTask) {
    return 'work-area'  // Está trabajando
  } else {
    return 'lounge'  // Sin tareas
  }
}

function getAgentPosition(agent: Agent): { x: number; y: number } {
  const zoneId = getAgentZone(agent)
  const zone = zones.find(z => z.id === zoneId)!

  // Posición aleatoria pero consistente dentro de la zona
  const hash = agent._id.split('').reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0)

  // Ajustar el rango según el tamaño de la zona
  const rangeX = zone.width * 0.35  // 35% del ancho para márgenes
  const rangeY = zone.height * 0.35  // 35% del alto para márgenes

  const offsetX = (hash % 100 - 50) / 100 * rangeX
  const offsetY = ((hash >> 8) % 100 - 50) / 100 * rangeY

  return { x: zone.x + offsetX, y: zone.y + offsetY }
}

function getAgentColor(agent: Agent): number {
  const roleColors: Record<string, number> = {
    squad_lead: 0x8B5CF6,  // Purple for Squad Leads
    coder: AGENT_COLORS.coder,
    developer: AGENT_COLORS.coder,
    researcher: AGENT_COLORS.researcher,
    planner: AGENT_COLORS.planner,
    reviewer: AGENT_COLORS.reviewer,
    manager: AGENT_COLORS.planner
  }
  return roleColors[agent.role?.toLowerCase() || ''] || AGENT_COLORS.default
}

function getRobotState(agent: Agent): 'idle' | 'walking' | 'working' | 'error' | 'happy' {
  if (agent.status === 'failed' || agent.status === 'error') return 'error'
  if (agent.status === 'offline' || agent.status === 'inactive') return 'idle'

  const zone = getAgentZone(agent)
  if (zone === 'work-area') return 'working'  // Está trabajando
  if (zone === 'work-control') return 'happy'  // Feliz de tener tarea
  return 'idle'  // En lounge, esperando
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

  // Actualizar zonas para mostrar contadores
  drawZones()

  props.agents.forEach(agent => {
    let sprite = robotSprites.get(agent._id)
    const newPos = getAgentPosition(agent)

    if (!sprite) {
      const color = getAgentColor(agent)
      sprite = new RobotSprite(agent.name, color)
      sprite.eventMode = 'static'
      sprite.on('pointerdown', () => emit('agentClick', agent))

      sprite.x = newPos.x
      sprite.y = newPos.y

      if (mapContainer) {
        mapContainer.addChild(sprite)
      }
      robotSprites.set(agent._id, sprite)
    } else {
      // Animar hacia nueva posición
      sprite.x = newPos.x
      sprite.y = newPos.y
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

watch(() => [props.agents, props.tasks], () => {
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
