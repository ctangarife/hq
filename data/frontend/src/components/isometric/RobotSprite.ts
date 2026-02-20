import { Container, Graphics, Text, Ticker } from 'pixi.js'

/**
 * Estados del robot
 */
export type RobotState = 'idle' | 'walking' | 'working' | 'error' | 'happy'

/**
 * Colores por rol/capacidad
 */
export const AGENT_COLORS: Record<string, number> = {
  coder: 0x3B82F6,    // azul
  researcher: 0x8B5CF6, // púrpura
  planner: 0x10B981,  // verde
  reviewer: 0xF59E0B, // amarillo
  default: 0x6B7280  // gris
}

/**
 * RobotSprite - Robot isométrico renderizado con Pixi.js v8
 */
export class RobotSprite extends Container {
  private headGraphics: Graphics
  private bodyGraphics: Graphics
  private shadowGraphics: Graphics
  private emojiText: Text
  private speechBubble: Container | null = null

  private _state: RobotState = 'idle'
  private _color: number = AGENT_COLORS.default

  // Animación
  private animTime: number = 0

  // Sistema de movimiento
  private isMoving: boolean = false
  private movementStartTime: number = 0
  private movementDuration: number = 800 // ms
  private startX: number = 0
  private startY: number = 0
  private targetX: number = 0
  private targetY: number = 0
  private previousState: RobotState = 'idle'
  private onMovementComplete: (() => void) | null = null

  constructor(_name: string, color: string | number = AGENT_COLORS.default) {
    super()

    this._color = typeof color === 'string' ? parseInt(color.replace('#', '0x')) : color

    // Crear gráficos
    this.shadowGraphics = new Graphics()
    this.bodyGraphics = new Graphics()
    this.headGraphics = new Graphics()
    this.emojiText = new Text({
      text: '',
      style: {
        fontSize: 16,
        align: 'center'
      }
    })

    // Construir robot
    this.buildShadow()
    this.buildBody()
    this.buildHead()

    // Agregar hijos en orden correcto (z-index)
    this.addChild(this.shadowGraphics)
    this.addChild(this.bodyGraphics)
    this.addChild(this.headGraphics)
    this.addChild(this.emojiText)

    // Iniciar loop de animación
    this.startAnimation()
  }

  get state(): RobotState {
    return this._state
  }

  set state(value: RobotState) {
    this._state = value
    this.updateAppearance()
  }

  get color(): number {
    return this._color
  }

  set color(value: number) {
    this._color = value
    this.buildHead() // Redibujar cabeza con nuevo color
  }

  /**
   * Animar movimiento hacia una posición
   * @param x - Posición X destino
   * @param y - Posición Y destino
   * @param duration - Duración del movimiento en ms (default: 800)
   * @param onComplete - Callback cuando termina el movimiento
   */
  animateTo(x: number, y: number, duration: number = 800, onComplete?: () => void): void {
    // Guardar estado actual y posición inicial
    this.previousState = this._state
    this.startX = this.x
    this.startY = this.y
    this.targetX = x
    this.targetY = y
    this.movementDuration = duration
    this.movementStartTime = performance.now()
    this.onMovementComplete = onComplete || null

    // Activar movimiento y estado walking
    this.isMoving = true
    this._state = 'walking'
    this.updateAppearance()
  }

  /**
   * Construir sombra isométrica
   */
  private buildShadow(): void {
    const g = this.shadowGraphics
    g.clear()
    g.beginPath()
    g.ellipse(0, 45, 20, 10)
    g.fill({ color: 0x000000, alpha: 0.2 })
  }

  /**
   * Construir cuerpo simple
   */
  private buildBody(): void {
    const g = this.bodyGraphics
    g.clear()

    const bodyWidth = 16
    const bodyHeight = 24

    g.beginPath()
    g.rect(-bodyWidth / 2, 20, bodyWidth, bodyHeight)
    g.fill({ color: 0x374151, alpha: 1 }) // gray-700
  }

  /**
   * Construir cabeza isométrica (cubo)
   */
  private buildHead(): void {
    const g = this.headGraphics
    g.clear()

    const headSize = 24
    const halfSize = headSize / 2

    // Colores para efecto 3D
    const topColor = this.lightenColor(this._color, 40)
    const leftColor = this._color
    const rightColor = this.darkenColor(this._color, 20)

    // Cara superior (top) - forma rombo isométrico
    g.beginPath()
    g.moveTo(0, -halfSize)
    g.lineTo(halfSize, 0)
    g.lineTo(0, halfSize)
    g.lineTo(-halfSize, 0)
    g.closePath()
    g.fill({ color: topColor })

    // Cara izquierda (lado visible 1)
    g.beginPath()
    g.moveTo(-halfSize, 0)
    g.lineTo(0, halfSize)
    g.lineTo(0, halfSize + headSize * 0.6)
    g.lineTo(-halfSize, halfSize + headSize * 0.3)
    g.closePath()
    g.fill({ color: leftColor })

    // Cara derecha (lado visible 2)
    g.beginPath()
    g.moveTo(halfSize, 0)
    g.lineTo(0, halfSize)
    g.lineTo(0, halfSize + headSize * 0.6)
    g.lineTo(halfSize, halfSize + headSize * 0.3)
    g.closePath()
    g.fill({ color: rightColor })

    // Ojos
    g.beginPath()
    g.ellipse(-5, 2, 3, 4)
    g.fill({ color: 0xFFFFFF })
    g.beginPath()
    g.ellipse(5, 2, 3, 4)
    g.fill({ color: 0xFFFFFF })

    // Pupilas
    g.beginPath()
    g.ellipse(-5, 2, 1.5, 2)
    g.fill({ color: 0x000000 })
    g.beginPath()
    g.ellipse(5, 2, 1.5, 2)
    g.fill({ color: 0x000000 })
  }

  /**
   * Actualizar apariencia según estado
   */
  private updateAppearance(): void {
    let emoji = ''

    switch (this._state) {
      case 'idle':
        emoji = '😊'
        break
      case 'walking':
        emoji = '🚶'
        break
      case 'working':
        emoji = '⚡'
        break
      case 'error':
        emoji = '❌'
        break
      case 'happy':
        emoji = '✨'
        break
    }

    this.emojiText.text = emoji
    this.emojiText.x = 12
    this.emojiText.y = -25
  }

  /**
   * Mostrar speech bubble temporal
   */
  showSpeech(text: string, duration: number = 3000): void {
    if (this.speechBubble) {
      this.removeChild(this.speechBubble)
    }

    const bubble = new Container()
    const bg = new Graphics()
    const textObj = new Text({
      text,
      style: {
        fontSize: 12,
        fill: 0xFFFFFF,
        wordWrap: true,
        wordWrapWidth: 120,
        align: 'center'
      }
    })

    bg.beginPath()
    bg.roundRect(-60, -40, 120, 30, 4)
    bg.fill({ color: 0x1F2937, alpha: 0.95 })

    bg.beginPath()
    bg.moveTo(-5, -10)
    bg.lineTo(5, -10)
    bg.lineTo(0, -4)
    bg.closePath()
    bg.fill({ color: 0x1F2937, alpha: 0.95 })

    bubble.addChild(bg)
    bubble.addChild(textObj)
    textObj.x = -textObj.width / 2
    textObj.y = -32

    this.addChild(bubble)
    this.speechBubble = bubble

    setTimeout(() => {
      if (this.speechBubble === bubble) {
        this.removeChild(bubble)
        this.speechBubble = null
      }
    }, duration)
  }

  private startAnimation(): void {
    const ticker = Ticker.shared
    ticker.add(this.animate.bind(this))
  }

  private animate(ticker: Ticker): void {
    this.animTime = ticker.lastTime / 1000

    // Manejar movimiento animado
    if (this.isMoving) {
      this.updateMovement()
    }

    switch (this._state) {
      case 'idle':
        this.animateIdle()
        break
      case 'walking':
        this.animateWalking()
        break
      case 'working':
        this.animateWorking()
        break
      case 'error':
        this.animateError()
        break
      case 'happy':
        this.animateHappy()
        break
    }
  }

  /**
   * Actualizar posición durante el movimiento
   */
  private updateMovement(): void {
    const currentTime = performance.now()
    const elapsed = currentTime - this.movementStartTime
    const progress = Math.min(elapsed / this.movementDuration, 1)

    // Función de easing easeOutCubic para movimiento suave
    const easedProgress = this.easeOutCubic(progress)

    // Interpolar posición
    this.x = this.startX + (this.targetX - this.startX) * easedProgress
    this.y = this.startY + (this.targetY - this.startY) * easedProgress

    // Verificar si terminó el movimiento
    if (progress >= 1) {
      this.isMoving = false
      this.x = this.targetX
      this.y = this.targetY

      // Restaurar estado anterior
      this._state = this.previousState
      this.updateAppearance()

      // Ejecutar callback si existe
      if (this.onMovementComplete) {
        const callback = this.onMovementComplete
        this.onMovementComplete = null
        callback()
      }
    }
  }

  /**
   * Función de easing easeOutCubic
   * Empieza rápido y desacelera suavemente al final
   */
  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3)
  }

  private animateIdle(): void {
    const offset = Math.sin(this.animTime * 2) * 2
    this.headGraphics.y = offset
    this.bodyGraphics.y = offset
  }

  private animateWalking(): void {
    const offset = Math.abs(Math.sin(this.animTime * 8)) * 4
    this.headGraphics.y = offset
    this.bodyGraphics.y = offset
  }

  private animateWorking(): void {
    const offset = Math.sin(this.animTime * 6) * 1
    this.headGraphics.y = offset
    this.bodyGraphics.y = 0

    const scale = 1 + Math.sin(this.animTime * 8) * 0.2
    this.emojiText.scale.set(scale)
  }

  private animateError(): void {
    // Solo aplicar shake si no se está moviendo
    if (!this.isMoving) {
      const shake = (Math.random() - 0.5) * 4
      this.x = this.targetX + shake // Usar targetX como base
    }
  }

  private animateHappy(): void {
    const offset = Math.abs(Math.sin(this.animTime * 10)) * 8
    this.headGraphics.y = -offset
    this.bodyGraphics.y = -offset

    const scale = 1 + Math.sin(this.animTime * 15) * 0.3
    this.emojiText.scale.set(scale)
  }

  private darkenColor(hex: number, percent: number): number {
    const num = hex & 0xFFFFFF
    const r = Math.max(0, ((num >> 16) & 0xFF) - Math.round(2.55 * percent))
    const g = Math.max(0, ((num >> 8) & 0x00FF) - Math.round(2.55 * percent))
    const b = Math.max(0, (num & 0x0000FF) - Math.round(2.55 * percent))
    return (r << 16) | (g << 8) | b
  }

  private lightenColor(hex: number, percent: number): number {
    const num = hex & 0xFFFFFF
    const r = Math.min(255, ((num >> 16) & 0xFF) + Math.round(2.55 * percent))
    const g = Math.min(255, ((num >> 8) & 0x00FF) + Math.round(2.55 * percent))
    const b = Math.min(255, (num & 0x0000FF) + Math.round(2.55 * percent))
    return (r << 16) | (g << 8) | b
  }

  destroy(): void {
    const ticker = Ticker.shared
    ticker.remove(this.animate.bind(this))

    if (this.speechBubble) {
      this.removeChild(this.speechBubble)
      this.speechBubble = null
    }

    super.destroy()
  }
}
