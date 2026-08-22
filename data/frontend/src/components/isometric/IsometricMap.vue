<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { Application, Container, Graphics, Text, FillGradient } from 'pixi.js'
import { AgentAvatarSprite } from './AgentAvatarSprite'
import { FurnitureDrawer } from './FurnitureDrawer'

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
let floorContainer: Container | null = null
let furnitureContainer: Container | null = null
const robotSprites = new Map<string, AgentAvatarSprite>()

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
    backgroundColor: 0x0B1220,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true
  })

  canvasContainer.value.appendChild(app.canvas)

  // Fondo ambiental: gradiente vertical sutil (cielo del bar) detrás del piso
  const bgGradient = new FillGradient(0, 0, 0, app.canvas.height)
  bgGradient.addColorStop(0, 0x111C33)   // arriba: azul noche
  bgGradient.addColorStop(0.65, 0x0D1526)
  bgGradient.addColorStop(1, 0x080D18)   // abajo: más oscuro (viñeta)
  const bg = new Graphics()
  bg.beginPath()
  bg.rect(0, 0, app.canvas.width, app.canvas.height)
  bg.fill(bgGradient)
  app.stage.addChild(bg)

  mapContainer = new Container()
  mapContainer.x = app.canvas.width / 2
  mapContainer.y = app.canvas.height / 2
  app.stage.addChild(mapContainer)

  // Create floor container (bottom layer - z-index 0)
  floorContainer = new Container()
  mapContainer.addChild(floorContainer)

  // Draw floor
  drawFloor()

  // Draw zones (on top of floor)
  drawZones()

  // Create furniture container (middle layer - z-index 1)
  furnitureContainer = new Container()
  mapContainer.addChild(furnitureContainer)

  // Draw furniture
  drawFurniture()

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

function drawFloor() {
  if (!floorContainer) return

  const floorWidth = 800
  const floorHeight = 600

  const g = new Graphics()
  const drawer = new FurnitureDrawer(g)

  // Draw wood floor centered
  drawer.drawWoodFloor(floorWidth, floorHeight)

  floorContainer.addChild(g)
}

function drawFurniture() {
  if (!furnitureContainer) return

  const g = new Graphics()
  const drawer = new FurnitureDrawer(g)

  // Draw the complete bar scene with all furniture
  drawer.drawBarScene()

  furnitureContainer.addChild(g)
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

// Distribuir los agentes de una zona en GRILLA determinista (slots ordenados
// con separación garantizada, centrados en la zona). Reemplaza al hash
// pseudo-aleatorio anterior que amontonaba avatares cuando coincidían slots.
function getAgentsInZonePositions(zoneId: string): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  const inZone = props.agents.filter(agent => getAgentZone(agent) === zoneId)
  const total = inZone.length
  if (total === 0) return positions

  const zone = zones.find(z => z.id === zoneId)!

  // Columnas: raíz del total, máx 4 por fila (más de 4 se apila en filas)
  const cols = Math.min(Math.max(Math.ceil(Math.sqrt(total)), 1), 4)
  const rows = Math.ceil(total / cols)

  // Separación dentro del 70% de la zona (15% de margen por lado)
  const spacingX = cols > 1 ? (zone.width * 0.7) / (cols - 1) : 0
  const spacingY = rows > 1 ? (zone.height * 0.7) / (rows - 1) : 0

  inZone.forEach((agent, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    positions.set(agent._id, {
      x: zone.x + (col - (cols - 1) / 2) * spacingX,
      y: zone.y + (row - (rows - 1) / 2) * spacingY,
    })
  })

  return positions
}

function getAgentPosition(agent: Agent): { x: number; y: number } {
  const zoneId = getAgentZone(agent)
  const positions = getAgentsInZonePositions(zoneId)
  return positions.get(agent._id) || { x: 0, y: 0 }
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
      sprite = new AgentAvatarSprite(agent.name, agent.role || '')
      sprite.eventMode = 'static'
      sprite.on('pointerdown', () => emit('agentClick', agent))

      sprite.x = newPos.x
      sprite.y = newPos.y
      sprite.state = getRobotState(agent)

      if (mapContainer) {
        mapContainer.addChild(sprite)
      }
      robotSprites.set(agent._id, sprite)
    } else {
      // Verificar si la posición cambió significativamente
      const dx = newPos.x - sprite.x
      const dy = newPos.y - sprite.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      // Si la distancia es mayor a 10px, animar el movimiento
      if (distance > 10) {
        const targetState = getRobotState(agent)
        const currentSprite = sprite // Capturar para uso en callback
        currentSprite.animateTo(
          newPos.x,
          newPos.y,
          800, // 800ms de duración
          () => {
            // Callback cuando termina el movimiento
            currentSprite.state = targetState
          }
        )
      } else {
        // Posición no cambió significativamente, solo actualizar estado
        sprite.state = getRobotState(agent)
      }
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

  if (floorContainer) {
    floorContainer.destroy()
    floorContainer = null
  }

  if (furnitureContainer) {
    furnitureContainer.destroy()
    furnitureContainer = null
  }

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
