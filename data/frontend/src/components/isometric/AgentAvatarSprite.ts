import { Container, Graphics, Sprite, Text, Texture, Ticker } from 'pixi.js'
import { loadStyle, avatarDataUriSync } from '@/composables/useAvatar'
import { getStyleForRole, getSeedForAgent } from '@/composables/useAgentAvatar'

/**
 * Estados del agente (misma interfaz que RobotSprite para no romper el mapa)
 */
export type RobotState = 'idle' | 'walking' | 'working' | 'error' | 'happy'

/**
 * Colores por rol (se mantienen para los anillos de estado y compatibilidad)
 */
export const AGENT_COLORS: Record<string, number> = {
  coder: 0x3B82F6,    // azul
  researcher: 0x8B5CF6, // púrpura
  planner: 0x10B981,  // verde
  reviewer: 0xF59E0B, // amarillo
  default: 0x6B7280  // gris
}

// Colores del anillo por estado
const STATE_RING_COLORS: Record<RobotState, number> = {
  idle: 0x64748B,      // slate
  walking: 0x38BDF8,   // sky
  working: 0x10B981,   // green (pulsa)
  error: 0xEF4444,     // red
  happy: 0xF59E0B,     // amber
}

// ── Cache de texturas de avatar (por estilo+seed, evita regenerar SVGs) ──
const textureCache = new Map<string, Texture>()
const texturePending = new Map<string, Promise<Texture>>()

/**
 * Rasterizar un data URI SVG a Texture de Pixi vía canvas 2D.
 * El tamaño de rasterización (128) es el doble del tamaño visual (64) para
 * que el avatar se vea nítido al escalar en el mapa.
 */
async function svgDataUriToTexture(dataUri: string, rasterSize = 128): Promise<Texture> {
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('avatar svg load failed'))
    img.src = dataUri
  })
  const canvas = document.createElement('canvas')
  canvas.width = rasterSize
  canvas.height = rasterSize
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, rasterSize, rasterSize)
  return Texture.from(canvas)
}

/**
 * Obtener (con cache) la textura del avatar DiceBear para un agente.
 * El estilo se elige por rol (squad_lead=avataaars, researcher=adventurer,
 * writer=pixel-art...) — mismo sistema que Papa por papa / AgentsView.
 */
export async function getAvatarTexture(role: string, agentName: string): Promise<Texture> {
  const style = getStyleForRole(role)
  const seed = getSeedForAgent({ name: agentName, role })
  const cacheKey = `${style}:${seed}`

  const cached = textureCache.get(cacheKey)
  if (cached) return cached

  const pending = texturePending.get(cacheKey)
  if (pending) return pending

  const promise = (async () => {
    const dicebearStyle = await loadStyle(style)
    const dataUri = avatarDataUriSync(dicebearStyle, seed, 128)
    const texture = await svgDataUriToTexture(dataUri)
    textureCache.set(cacheKey, texture)
    return texture
  })()

  texturePending.set(cacheKey, promise)
  try {
    return await promise
  } finally {
    texturePending.delete(cacheKey)
  }
}

/**
 * AgentAvatarSprite - Avatar DiceBear sobre el mapa isométrico.
 *
 * Reemplaza a RobotSprite con la MISMA interfaz pública (state, animateTo,
 * destroy) para que IsometricMap no cambie su lógica de orquestación.
 *
 * Composición (de atrás hacia adelante):
 *   - Sombra elíptica en el piso
 *   - Anillo de estado (color según state, pulsa cuando trabaja)
 *   - Avatar DiceBear como Sprite (~64px visual, rasterizado a 128)
 *   - Emoji de estado flotando arriba a la derecha
 *   - Nombre del agente debajo del anillo
 */
export class AgentAvatarSprite extends Container {
  private shadow: Graphics
  private ring: Graphics
  private spotlight: Graphics
  private avatar: Sprite | null = null
  private avatarPlaceholder: Graphics
  private emojiText: Text
  private nameText: Text

  private _state: RobotState = 'idle'
  private _name: string = ''
  private _role: string = ''

  private animTime: number = 0

  // Hover: spotlight + escala con easing hacia target
  private hoverAmount: number = 0
  private hoverTarget: number = 0

  // Burbuja de actividad (port del showSpeech del RobotSprite original)
  private bubble: Container | null = null
  private bubbleStart: number = 0
  private bubbleDuration: number = 0

  // Sistema de movimiento (igual que RobotSprite)
  private isMoving: boolean = false
  private movementStartTime: number = 0
  private movementDuration: number = 800
  private startX: number = 0
  private startY: number = 0
  private targetX: number = 0
  private targetY: number = 0
  private previousState: RobotState = 'idle'
  private onMovementComplete: (() => void) | null = null

  // Layout: el avatar se ancla con el piso en y=0, el sprite sube desde ahí
  private static readonly AVATAR_SIZE = 56

  constructor(name: string, role: string = '') {
    super()

    this._name = name
    this._role = role

    this.shadow = new Graphics()
    this.ring = new Graphics()
    this.spotlight = new Graphics()
    this.avatarPlaceholder = new Graphics()
    this.emojiText = new Text({
      text: '',
      style: { fontSize: 15, align: 'center' },
    })
    this.nameText = new Text({
      text: name,
      style: {
        fontSize: 11,
        fontWeight: '600',
        fill: 0xE2E8F0,
        align: 'center',
      },
    })

    this.buildShadow()
    this.buildRing()
    this.buildPlaceholder()

    // Spotlight de hover: luz cálida amplia bajo el avatar (alpha animada)
    this.spotlight.beginPath()
    this.spotlight.ellipse(0, 0, 42, 20)
    this.spotlight.fill({ color: 0xFFD98E, alpha: 0.22 })
    this.spotlight.alpha = 0

    this.addChild(this.spotlight)
    this.addChild(this.shadow)
    this.addChild(this.ring)
    this.addChild(this.avatarPlaceholder)
    this.addChild(this.emojiText)
    this.addChild(this.nameText)

    // Nombre centrado bajo el anillo
    this.nameText.anchor.set(0.5)
    this.nameText.y = 18

    // Hover: spotlight + escala sutil (feedback inmediato)
    this.on('pointerover', () => { this.hoverTarget = 1 })
    this.on('pointerout', () => { this.hoverTarget = 0 })

    // Cargar el avatar DiceBear asíncronamente (el placeholder se ve mientras)
    this.loadAvatar()

    this.startAnimation()
  }

  get state(): RobotState {
    return this._state
  }

  set state(value: RobotState) {
    this._state = value
    this.updateAppearance()
  }

  get role(): string {
    return this._role
  }

  /**
   * Cargar el avatar DiceBear por rol y reemplazar el placeholder.
   */
  private async loadAvatar(): Promise<void> {
    try {
      const texture = await getAvatarTexture(this._role, this._name)
      // El sprite puede haber sido destruido mientras cargaba
      if (this.destroyed) return

      const sprite = new Sprite(texture)
      const size = AgentAvatarSprite.AVATAR_SIZE
      sprite.width = size
      sprite.height = size
      sprite.anchor.set(0.5, 1) // base del avatar sobre el anillo
      sprite.y = 6

      if (this.avatarPlaceholder.parent) {
        this.removeChild(this.avatarPlaceholder)
      }

      this.avatar = sprite
      // El avatar queda debajo del emoji y el nombre en z-order
      this.addChildAt(sprite, 2)
    } catch (err) {
      // Sin avatar (error cargando estilo): el placeholder de color queda
      console.warn('[AgentAvatarSprite] avatar load failed, keeping placeholder:', err)
    }
  }

  private buildShadow(): void {
    const g = this.shadow
    g.clear()
    g.beginPath()
    g.ellipse(0, 4, 22, 9)
    g.fill({ color: 0x000000, alpha: 0.25 })
  }

  private buildRing(): void {
    const g = this.ring
    const color = STATE_RING_COLORS[this._state] ?? STATE_RING_COLORS.idle
    g.clear()
    // Anillo elíptico en el piso alrededor del avatar
    g.beginPath()
    g.ellipse(0, 4, 26, 11)
    g.stroke({ width: 2.5, color, alpha: 0.9 })
  }

  private buildPlaceholder(): void {
    // Círculo de color mientras el avatar carga (o si falla)
    const g = this.avatarPlaceholder
    const color = AGENT_COLORS[this._role] ?? AGENT_COLORS.default
    g.clear()
    g.beginPath()
    g.circle(0, -24, 18)
    g.fill({ color, alpha: 0.85 })
    g.beginPath()
    g.circle(0, -24, 18)
    g.stroke({ width: 2, color: 0x0F172A, alpha: 0.6 })
  }

  private updateAppearance(): void {
    let emoji = ''
    switch (this._state) {
      case 'idle': emoji = '😊'; break
      case 'walking': emoji = '🚶'; break
      case 'working': emoji = '⚡'; break
      case 'error': emoji = '❌'; break
      case 'happy': emoji = '✨'; break
    }
    this.emojiText.text = emoji
    this.emojiText.x = 20
    this.emojiText.y = -58
    this.buildRing()
  }

  /**
   * Animar movimiento hacia una posición (misma firma que RobotSprite).
   */
  animateTo(x: number, y: number, duration: number = 800, onComplete?: () => void): void {
    this.previousState = this._state
    this.startX = this.x
    this.startY = this.y
    this.targetX = x
    this.targetY = y
    this.movementDuration = duration
    this.movementStartTime = performance.now()
    this.onMovementComplete = onComplete || null

    this.isMoving = true
    this._state = 'walking'
    this.updateAppearance()
  }

  private startAnimation(): void {
    Ticker.shared.add(this.animate, this)
  }

  private animate(ticker: Ticker): void {
    this.animTime = ticker.lastTime / 1000

    // Easing del hover: spotlight fade + escala sutil hacia 1.07
    const dt = Math.min(ticker.deltaMS / 1000, 0.05)
    this.hoverAmount += (this.hoverTarget - this.hoverAmount) * Math.min(dt * 10, 1)
    this.spotlight.alpha = this.hoverAmount
    const hoverScale = 1 + this.hoverAmount * 0.07
    this.scale.set(hoverScale)
    this.nameText.style.fill = this.hoverAmount > 0.5 ? 0xFFFFFF : 0xE2E8F0

    // Burbuja: fade in → hold → fade out → autodestruir
    if (this.bubble) {
      const elapsed = performance.now() - this.bubbleStart
      const total = this.bubbleDuration
      let alpha = 1
      if (elapsed < 180) alpha = elapsed / 180
      else if (elapsed > total - 350) alpha = Math.max((total - elapsed) / 350, 0)
      this.bubble.alpha = alpha
      // Flotación sutil
      this.bubble.y = Math.sin(this.animTime * 2) * 2
      if (elapsed >= total) {
        this.removeChild(this.bubble)
        this.bubble.destroy({ children: true })
        this.bubble = null
      }
    }

    if (this.isMoving) {
      this.updateMovement()
    }

    switch (this._state) {
      case 'idle': this.animateIdle(); break
      case 'walking': this.animateWalking(); break
      case 'working': this.animateWorking(); break
      case 'error': this.animateError(); break
      case 'happy': this.animateHappy(); break
    }
  }

  /** Mover solo la parte "cuerpo" (avatar+emoji), sombra y nombre quedan en el piso. */
  private setBodyOffset(y: number): void {
    if (this.avatar) this.avatar.y = 6 + y
    this.emojiText.y = -58 + y
    if (this.avatarPlaceholder.parent) this.avatarPlaceholder.y = -26 + y
  }

  private updateMovement(): void {
    const elapsed = performance.now() - this.movementStartTime
    const progress = Math.min(elapsed / this.movementDuration, 1)
    const eased = this.easeOutCubic(progress)

    this.x = this.startX + (this.targetX - this.startX) * eased
    this.y = this.startY + (this.targetY - this.startY) * eased

    if (progress >= 1) {
      this.isMoving = false
      this.x = this.targetX
      this.y = this.targetY
      this._state = this.previousState
      this.updateAppearance()

      if (this.onMovementComplete) {
        const cb = this.onMovementComplete
        this.onMovementComplete = null
        cb()
      }
    }
  }

  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3)
  }

  private animateIdle(): void {
    // Respiración sutil
    this.setBodyOffset(Math.sin(this.animTime * 2) * 2)
  }

  private animateWalking(): void {
    // Saltito al caminar
    this.setBodyOffset(-Math.abs(Math.sin(this.animTime * 8)) * 4)
  }

  private animateWorking(): void {
    // Vibración fina + anillo pulsante
    this.setBodyOffset(Math.sin(this.animTime * 6) * 1)
    const scale = 1 + Math.sin(this.animTime * 5) * 0.12
    this.ring.scale.set(scale)
    this.emojiText.scale.set(1 + Math.sin(this.animTime * 8) * 0.2)
  }

  private animateError(): void {
    if (!this.isMoving) {
      const shake = (Math.random() - 0.5) * 4
      this.x = this.targetX + shake
    }
  }

  private animateHappy(): void {
    // Brinquito alegre
    this.setBodyOffset(-Math.abs(Math.sin(this.animTime * 10)) * 7)
    this.emojiText.scale.set(1 + Math.sin(this.animTime * 15) * 0.3)
  }

  /**
   * Burbuja de actividad flotante (port del showSpeech de RobotSprite):
   * aparece, dura `duration` ms y se desvanece. Fade in 180ms / out 350ms.
   * Nunca permanente — lección de nameplates MMO (mínimo elemento flotante).
   */
  showBubble(text: string, duration: number = 2000): void {
    if (this.bubble) {
      this.removeChild(this.bubble)
      this.bubble.destroy({ children: true })
      this.bubble = null
    }

    const bubble = new Container()
    const label = new Text({
      text,
      style: {
        fontSize: 11,
        fontWeight: '500',
        fill: 0xE2E8F0,
        wordWrap: true,
        wordWrapWidth: 140,
        align: 'center',
      },
    })

    const pad = 9
    const w = label.width + pad * 2
    const h = label.height + pad
    const bg = new Graphics()
    bg.beginPath()
    bg.roundRect(-w / 2, -74 - h, w, h, 8)
    bg.fill({ color: 0x0F1424, alpha: 0.92 })
    bg.beginPath()
    bg.roundRect(-w / 2, -74 - h, w, h, 8)
    bg.stroke({ width: 1, color: 0x94A3B8, alpha: 0.4 })
    // Colita hacia el avatar
    bg.beginPath()
    bg.moveTo(-4, -74)
    bg.lineTo(4, -74)
    bg.lineTo(0, -68)
    bg.closePath()
    bg.fill({ color: 0x0F1424, alpha: 0.92 })

    label.x = -label.width / 2
    label.y = -74 - h + (h - label.height) / 2

    bubble.addChild(bg)
    bubble.addChild(label)
    bubble.alpha = 0
    this.addChild(bubble)

    this.bubble = bubble
    this.bubbleStart = performance.now()
    this.bubbleDuration = duration
  }

  destroy(): void {
    Ticker.shared.remove(this.animate, this)
    if (this.bubble) {
      this.bubble = null
    }
    super.destroy()
  }
}
