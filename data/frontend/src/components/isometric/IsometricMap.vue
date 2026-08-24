<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { Application, Container, Graphics, Text, FillGradient, Ticker } from 'pixi.js'
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
  zoneHover: [payload: { zoneId: string; name: string; screenX: number; screenY: number }]
  zoneLeave: []
}>()

const canvasContainer = ref<HTMLDivElement>()
let app: Application | null = null
let mapContainer: Container | null = null
let floorContainer: Container | null = null
let furnitureContainer: Container | null = null
const robotSprites = new Map<string, AgentAvatarSprite>()

// Vida ambiental: overlays de zona (respiración), hover actual y scheduler zZz
const zoneOverlays = new Map<string, Graphics>()
let hoveredZoneId: string | null = null
let breatheTime = 0
let zzzTimer = 0

/**
 * Tick ambiental (uno solo para todo el mapa):
 * - Zonas activas respiran (pulso alpha 3s SOLO con agentes; quieta si vacía
 *   — abundancia honesta estilo Animal Crossing)
 * - Scheduler zZz: un agente idle del lounge emite "zZz" cada ~8s
 */
function ambientTick(ticker: Ticker) {
  breatheTime = ticker.lastTime / 1000

  for (const [zoneId, overlay] of zoneOverlays) {
    // Solo las zonas de trabajo respiran (lounge = descanso, quieta)
    if (zoneId !== 'work-area' && zoneId !== 'work-control') continue
    if (hoveredZoneId === zoneId) {
      overlay.alpha = 1
      continue
    }
    const hasAgents = getAgentsInZone(zoneId).length > 0
    if (hasAgents) {
      // Ciclo respiración: 3s, rango sutil 0.10–0.80 del overlay (fill 0.14)
      overlay.alpha = 0.45 + Math.sin(breatheTime * ((Math.PI * 2) / 3)) * 0.35
    } else {
      overlay.alpha = 0
    }
  }

  // zZz scheduler
  zzzTimer += ticker.deltaMS
  if (zzzTimer >= 8000) {
    zzzTimer = 0
    emitZzz()
  }
}

function emitZzz() {
  const loungers = props.agents.filter(a => getAgentZone(a) === 'lounge')
  if (loungers.length === 0) return
  const pick = loungers[Math.floor(Math.random() * loungers.length)]
  robotSprites.get(pick._id)?.showBubble('zZz 💤', 2400)
}

// Zonas del mapa HQ - colores armonizados con la paleta del bar nocturno
// (ciruela/esmeralda/latón — matchean los anillos de estado y la decoración)
const zones: Zone[] = [
  {
    id: 'work-control',
    name: '🎯 Work Control',
    x: 0,
    y: -100,
    width: 220,
    height: 100,
    color: 0xB98AC4  // Ciruela — agentes esperando iniciar tarea
  },
  {
    id: 'work-area',
    name: '⚡ Work Area',
    x: -150,
    y: 50,
    width: 180,
    height: 100,
    color: 0x2ECC8F  // Esmeralda — agentes ejecutando (matchea anillo working)
  },
  {
    id: 'lounge',
    name: '☕ Lounge',
    x: 150,
    y: 50,
    width: 160,
    height: 100,
    color: 0xD9A441  // Latón — coherente con la decoración dorada del lounge
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

/**
 * Ripple expansivo desde un punto (feedback de click en zona).
 * Círculo isométrico que crece y se desvanece, auto-destruyéndose.
 */
function spawnRipple(x: number, y: number, color: number) {
  if (!mapContainer) return
  const ripple = new Graphics()
  ripple.x = x
  ripple.y = y
  mapContainer.addChild(ripple)

  const start = performance.now()
  const duration = 550

  const tick = () => {
    const t = Math.min((performance.now() - start) / duration, 1)
    const eased = 1 - Math.pow(1 - t, 2)
    const radius = 8 + eased * 46
    const alpha = (1 - t) * 0.55

    ripple.clear()
    ripple.beginPath()
    ripple.ellipse(0, 0, radius, radius * 0.45)
    ripple.stroke({ width: 2, color, alpha })

    if (t >= 1) {
      Ticker.shared.remove(tick)
      ripple.destroy()
    }
  }

  Ticker.shared.add(tick)
}

/**
 * Chispas de celebración (400ms — regla juice 300-400ms, máx 8 partículas):
 * burst radial verde/oro con gravedad suave. Disparado al completar tareas.
 */
function spawnParticles(x: number, y: number) {
  if (!mapContainer) return
  const burst = new Container()
  burst.x = x
  burst.y = y - 24
  mapContainer.addChild(burst)

  const colors = [0x2ECC8F, 0xD9A441, 0xE8C894]
  const parts: Array<{ g: Graphics; vx: number; vy: number }> = []
  for (let i = 0; i < 8; i++) {
    const g = new Graphics()
    g.beginPath()
    g.circle(0, 0, 1.5 + Math.random() * 1.5)
    g.fill({ color: colors[i % colors.length], alpha: 0.9 })
    const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.5
    const speed = 35 + Math.random() * 45
    burst.addChild(g)
    parts.push({ g, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed * 0.6 - 35 })
  }

  const start = performance.now()
  const duration = 400

  const tick = () => {
    const t = Math.min((performance.now() - start) / duration, 1)
    const dt = 1 / 60
    for (const p of parts) {
      p.vy += 130 * dt // gravedad
      p.g.x += p.vx * dt
      p.g.y += p.vy * dt
      p.g.alpha = (1 - t) * 0.9
    }
    if (t >= 1) {
      Ticker.shared.remove(tick)
      burst.destroy({ children: true })
    }
  }

  Ticker.shared.add(tick)
}

/**
 * API expuesta para el padre (ActivityView): vida dirigida por eventos SSE.
 */
function celebrate() {
  // Chispas sobre un agente que trabaja (random) o el centro del Work Area
  const workers = getAgentsInZone('work-area')
  if (workers.length > 0) {
    const w = workers[Math.floor(Math.random() * workers.length)]
    const s = robotSprites.get(w._id)
    if (s) {
      spawnParticles(s.x, s.y)
      return
    }
  }
  const zone = zones.find(z => z.id === 'work-area')
  if (zone) spawnParticles(zone.x, zone.y)
}

function showAgentBubble(agentId: string, text: string) {
  robotSprites.get(agentId)?.showBubble(text, 2000)
}

defineExpose({ celebrate, showAgentBubble })

function drawZones() {  if (!mapContainer) return

  // Se repueblan en cada redraw (los Graphics se recrean)
  zoneOverlays.clear()

  zones.forEach(zone => {
    const g = new Graphics()
    g.x = zone.x
    g.y = zone.y
    g.cursor = 'pointer'

    const hw = zone.width / 2
    const hh = zone.height / 2

    // Halo exterior muy tenue (profundidad sin gritar)
    g.beginPath()
    g.moveTo(0, -hh - 6)
    g.lineTo(hw + 10, 0)
    g.lineTo(0, hh + 6)
    g.lineTo(-hw - 10, 0)
    g.closePath()
    g.fill({ color: zone.color, alpha: 0.04 })

    // Relleno principal — sutil, deja ver el parquet
    g.beginPath()
    g.moveTo(0, -hh)
    g.lineTo(hw, 0)
    g.lineTo(0, hh)
    g.lineTo(-hw, 0)
    g.closePath()
    g.fill({ color: zone.color, alpha: 0.08 })

    // Núcleo interior apenas más presente (luz cenital)
    g.beginPath()
    g.moveTo(0, -hh + 10)
    g.lineTo(hw - 16, 0)
    g.lineTo(0, hh - 10)
    g.lineTo(-hw + 16, 0)
    g.closePath()
    g.fill({ color: zone.color, alpha: 0.05 })

    // Borde fino discreto + trazo punteado interior
    g.beginPath()
    g.moveTo(0, -hh)
    g.lineTo(hw, 0)
    g.lineTo(0, hh)
    g.lineTo(-hw, 0)
    g.closePath()
    g.stroke({ width: 1, color: zone.color, alpha: 0.35 })

    // Bisel 3D muy sutil (antes era un bloque de color fuerte)
    g.beginPath()
    g.moveTo(-hw, 0)
    g.lineTo(-hw, 4)
    g.lineTo(0, hh + 4)
    g.lineTo(0, hh)
    g.closePath()
    g.fill({ color: zone.color, alpha: 0.12 })

    // Overlay de hover: se ilumina la zona (fade in/out via alpha del overlay)
    const hoverOverlay = new Graphics()
    hoverOverlay.beginPath()
    hoverOverlay.moveTo(0, -hh)
    hoverOverlay.lineTo(hw, 0)
    hoverOverlay.lineTo(0, hh)
    hoverOverlay.lineTo(-hw, 0)
    hoverOverlay.closePath()
    hoverOverlay.fill({ color: zone.color, alpha: 0.14 })
    hoverOverlay.alpha = 0
    g.addChild(hoverOverlay)
    zoneOverlays.set(zone.id, hoverOverlay)

    // Etiqueta como chip elegante: pill oscuro translúcido + punto de color
    const label = new Text({
      text: zone.name,
      style: {
        fontSize: 11,
        fontWeight: '600',
        letterSpacing: 1,
        fill: 0xE2E8F0,
        align: 'center',
      }
    })

    const chipPadX = 10
    const chipW = label.width + chipPadX * 2 + 8 // +8 por el punto de color
    const chipH = 18
    const chip = new Graphics()
    chip.beginPath()
    chip.roundRect(-chipW / 2, -hh - 30, chipW, chipH, 9)
    chip.fill({ color: 0x0F1424, alpha: 0.72 })
    chip.beginPath()
    chip.roundRect(-chipW / 2, -hh - 30, chipW, chipH, 9)
    chip.stroke({ width: 1, color: zone.color, alpha: 0.45 })
    // Punto de color de la zona
    chip.beginPath()
    chip.circle(-chipW / 2 + chipPadX, -hh - 30 + chipH / 2, 2.5)
    chip.fill({ color: zone.color, alpha: 1 })
    chip.addChild(label)
    label.x = -chipW / 2 + chipPadX + 8
    label.y = -hh - 30 + chipH / 2 - label.height / 2
    g.addChild(chip)

    // Contador de agentes (discreto, dentro de la zona)
    const agentCount = getAgentsInZone(zone.id).length
    if (agentCount > 0) {
      const countLabel = new Text({
        text: `${agentCount}`,
        style: {
          fontSize: 13,
          fontWeight: '700',
          fill: zone.color,
          align: 'center',
        }
      })
      countLabel.x = -countLabel.width / 2
      countLabel.y = 10
      g.addChild(countLabel)
    }

    // Interacción: hover ilumina + tooltip, click emite + ripple
    g.eventMode = 'static'
    g.on('pointerover', (e: any) => {
      hoveredZoneId = zone.id
      hoverOverlay.alpha = 1
      const p = e.global
      emit('zoneHover', {
        zoneId: zone.id,
        name: zone.name,
        screenX: p.x,
        screenY: p.y,
      })
    })
    g.on('pointerout', () => {
      if (hoveredZoneId === zone.id) hoveredZoneId = null
      hoverOverlay.alpha = 0
      emit('zoneLeave')
    })
    g.on('pointermove', (e: any) => {
      const p = e.global
      emit('zoneHover', {
        zoneId: zone.id,
        name: zone.name,
        screenX: p.x,
        screenY: p.y,
      })
    })
    g.on('pointerdown', (e: any) => {
      // Ripple expansivo desde el punto de click
      if (mapContainer && app) {
        const local = mapContainer.toLocal(e.global)
        spawnRipple(local.x, local.y, zone.color)
      }
      emit('zoneClick', zone)
    })

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
  // Vida ambiental: respiración de zonas + scheduler zZz
  Ticker.shared.add(ambientTick)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  Ticker.shared.remove(ambientTick)

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
