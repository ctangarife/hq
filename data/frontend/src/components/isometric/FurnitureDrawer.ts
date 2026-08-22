import { Graphics } from 'pixi.js'

/**
 * Paleta del bar nocturno premium — coherente con el fondo azul noche del
 * mapa (gradiente) y los avatares DiceBear coloridos. Madera nogal, latón,
 * vidrio traslúcido y acentos de neón.
 */
export const BAR_COLORS = {
  // Suelo: parquet nogal oscuro con brillo cálido
  floor: 0x5D4157,          // Nogal vino
  floorAccent: 0x4A3348,    // Nogal profundo
  floorLine: 0x3A2740,      // Separación
  floorGloss: 0x7A5A6E,     // Reflejo suave

  // Barra: nogal + latón
  barTop: 0xC9A06B,         // Tapa nogal miel
  barTopEdge: 0xE8C894,     // Canto iluminado de la tapa
  barFront: 0x3E2B3A,       // Frente nogal oscuro
  barSide: 0x513A4C,        // Lados
  brass: 0xD9A441,          // Latón/oro para cantos y detalles
  barStool: 0x6B4A63,       // Taburete ciruela

  // Mesas
  tableTop: 0xB98D62,       // Madera miel
  tableLeg: 0x3A2A38,       // Patas oscuras
  tableEdge: 0xE8C894,      // Borde iluminado

  // Sillas / sofás (terracota sofisticada)
  chairSeat: 0x8A5A6B,      // Rosa vino
  chairBack: 0x5E3A4A,      // Respaldo
  sofaBase: 0x7A4658,       // Vino
  sofaCushion: 0xA66A78,    // Cojín
  sofaArm: 0x5E3646,        // Brazos

  // Botellas: vidrio traslúcido tipo gema
  bottleGreen: 0x2ECC8F,
  bottleAmber: 0xF5A623,
  bottleBlue: 0x4FC3F7,
  bottleMagenta: 0xE857A8,
  bottleCork: 0x8B5A2B,

  // Iluminación
  lampBase: 0x2A2233,       // Metal oscuro
  lampShade: 0xE8C894,      // Pantalla cálida
  lampGlow: 0xFFD98E,       // Glow cálido
  neon: 0x4FE3FF,           // Neón cyan

  // Plantas
  plantPot: 0xA05050,       // Terracota
  plantGreen: 0x2E8B6B,     // Hojas
  plantGreenLight: 0x5BC98F // Hojas claras
}

/**
 * FurnitureDrawer - Muebles isométricos del bar nocturno.
 * Misma API pública que la versión anterior (IsometricMap no cambia):
 * drawWoodFloor, drawBarScene, drawTable, drawChair, drawSofa, drawBar,
 * drawBarStool, drawBottle, drawLamp, drawPlant, drawDesk, drawCoffeeTable.
 */
export class FurnitureDrawer {
  private graphics: Graphics

  constructor(graphics: Graphics) {
    this.graphics = graphics
  }

  /**
   * Piso: parquet de rombos isométricos alternados con brillo sutil.
   * (Antes eran rects axis-aligned que no respetaban la perspectiva iso.)
   */
  drawWoodFloor(width: number, height: number): void {
    const g = this.graphics
    const cell = 46
    const half = cell / 2

    for (let row = -height / 2; row < height / 2; row += half) {
      for (let col = -width / 2 - cell; col < width / 2 + cell; col += cell) {
        const x = col + ((Math.round(row / half) % 2 === 0) ? 0 : half)
        const y = row
        const isEven = (Math.round((x + width) / cell) + Math.round(y / half)) % 2 === 0

        // Rombo iso
        g.beginPath()
        g.moveTo(x, y - half / 2)
        g.lineTo(x + cell / 2, y)
        g.lineTo(x, y + half / 2)
        g.lineTo(x - cell / 2, y)
        g.closePath()
        g.fill({ color: isEven ? BAR_COLORS.floor : BAR_COLORS.floorAccent, alpha: 0.85 })

        g.beginPath()
        g.moveTo(x, y - half / 2)
        g.lineTo(x + cell / 2, y)
        g.lineTo(x, y + half / 2)
        g.lineTo(x - cell / 2, y)
        g.closePath()
        g.stroke({ width: 0.5, color: BAR_COLORS.floorLine, alpha: 0.35 })

        // Brillo espejado sutil hacia la barra (luz cálida del fondo)
        if (isEven) {
          g.beginPath()
          g.moveTo(x, y - half / 2 + 2)
          g.lineTo(x + cell / 2 - 3, y)
          g.lineTo(x, y + 2)
          g.lineTo(x - cell / 2 + 3, y)
          g.closePath()
          g.fill({ color: BAR_COLORS.floorGloss, alpha: 0.06 })
        }
      }
    }
  }

  /**
   * Mesa redonda alta (cocktail): tapa con borde iluminado y pie central.
   */
  drawTable(x: number, y: number, size: number = 32): void {
    const g = this.graphics
    const halfSize = size / 2

    // Sombra
    g.beginPath()
    g.ellipse(x, y + 12, size * 0.65, size * 0.28)
    g.fill({ color: 0x000000, alpha: 0.25 })

    // Pie central
    g.beginPath()
    g.moveTo(x, y + 2)
    g.lineTo(x, y + 10)
    g.stroke({ width: 3, color: BAR_COLORS.tableLeg, alpha: 0.9 })
    g.beginPath()
    g.ellipse(x, y + 11, 6, 2.5)
    g.fill({ color: BAR_COLORS.brass, alpha: 0.7 })

    // Tapa (rombo)
    g.beginPath()
    g.moveTo(x, y - halfSize)
    g.lineTo(x + halfSize, y)
    g.lineTo(x, y + halfSize)
    g.lineTo(x - halfSize, y)
    g.closePath()
    g.fill({ color: BAR_COLORS.tableTop, alpha: 0.95 })

    // Canto iluminado (latón)
    g.beginPath()
    g.moveTo(x, y - halfSize)
    g.lineTo(x + halfSize, y)
    g.lineTo(x, y + halfSize)
    g.lineTo(x - halfSize, y)
    g.closePath()
    g.stroke({ width: 1.5, color: BAR_COLORS.tableEdge, alpha: 0.8 })

    // Grosor
    const t = 4
    g.beginPath()
    g.moveTo(x - halfSize, y)
    g.lineTo(x - halfSize, y + t)
    g.lineTo(x, y + halfSize + t)
    g.lineTo(x, y + halfSize)
    g.closePath()
    g.fill({ color: BAR_COLORS.tableLeg, alpha: 0.55 })
    g.beginPath()
    g.moveTo(x + halfSize, y)
    g.lineTo(x + halfSize, y + t)
    g.lineTo(x, y + halfSize + t)
    g.lineTo(x, y + halfSize)
    g.closePath()
    g.fill({ color: BAR_COLORS.tableLeg, alpha: 0.35 })
  }

  /**
   * Silla con respaldo alto y patas de latón.
   */
  drawChair(x: number, y: number): void {
    const g = this.graphics
    const size = 17

    g.beginPath()
    g.ellipse(x, y + 8, size * 0.55, size * 0.22)
    g.fill({ color: 0x000000, alpha: 0.2 })

    // Asiento
    g.beginPath()
    g.moveTo(x, y - size / 2)
    g.lineTo(x + size / 2, y)
    g.lineTo(x, y + size / 2)
    g.lineTo(x - size / 2, y)
    g.closePath()
    g.fill({ color: BAR_COLORS.chairSeat, alpha: 0.95 })

    // Respaldo
    const backY = y - size / 2 - 9
    g.beginPath()
    g.moveTo(x, backY - 7)
    g.lineTo(x + 6, backY)
    g.lineTo(x, backY + 7)
    g.lineTo(x - 6, backY)
    g.closePath()
    g.fill({ color: BAR_COLORS.chairBack, alpha: 0.9 })
    g.beginPath()
    g.moveTo(x, backY - 5)
    g.lineTo(x + 4, backY)
    g.lineTo(x, backY + 5)
    g.lineTo(x - 4, backY)
    g.closePath()
    g.stroke({ width: 1, color: BAR_COLORS.brass, alpha: 0.5 })

    // Patas
    g.beginPath()
    g.moveTo(x - 6, y + 4)
    g.lineTo(x - 6, y + 9)
    g.stroke({ width: 1.5, color: BAR_COLORS.lampBase, alpha: 0.9 })
    g.beginPath()
    g.moveTo(x + 6, y + 4)
    g.lineTo(x + 6, y + 9)
    g.stroke({ width: 1.5, color: BAR_COLORS.lampBase, alpha: 0.9 })
  }

  /**
   * Sofá con cojines mullidos y borde iluminado.
   */
  drawSofa(x: number, y: number, width: number = 60): void {
    const g = this.graphics
    const depth = 26

    g.beginPath()
    g.ellipse(x, y + 12, width * 0.7, depth * 0.32)
    g.fill({ color: 0x000000, alpha: 0.22 })

    // Base
    g.beginPath()
    g.moveTo(x, y - depth / 2)
    g.lineTo(x + width / 2, y)
    g.lineTo(x, y + depth / 2)
    g.lineTo(x - width / 2, y)
    g.closePath()
    g.fill({ color: BAR_COLORS.sofaBase, alpha: 0.95 })

    // Cojines
    const cw = width / 2.6
    g.beginPath()
    g.moveTo(x - cw, y - depth / 4)
    g.lineTo(x - cw / 2, y)
    g.lineTo(x - cw, y + depth / 4)
    g.lineTo(x - cw * 1.5, y)
    g.closePath()
    g.fill({ color: BAR_COLORS.sofaCushion, alpha: 0.75 })
    g.beginPath()
    g.moveTo(x + cw, y - depth / 4)
    g.lineTo(x + cw * 1.5, y)
    g.lineTo(x + cw, y + depth / 4)
    g.lineTo(x + cw / 2, y)
    g.closePath()
    g.fill({ color: BAR_COLORS.sofaCushion, alpha: 0.75 })

    // Respaldo con toque de luz
    g.beginPath()
    g.moveTo(x, y - depth / 2)
    g.lineTo(x + width / 2, y)
    g.lineTo(x, y + depth / 2)
    g.lineTo(x - width / 2, y)
    g.closePath()
    g.stroke({ width: 2.5, color: BAR_COLORS.sofaArm, alpha: 0.7 })

    // Brazos
    g.beginPath()
    g.ellipse(x - width / 2 + 5, y, 8, 4)
    g.fill({ color: BAR_COLORS.sofaArm, alpha: 0.9 })
    g.beginPath()
    g.ellipse(x + width / 2 - 5, y, 8, 4)
    g.fill({ color: BAR_COLORS.sofaArm, alpha: 0.9 })
  }

  /**
   * Barra principal: frente panelado con latón, tapa con canto iluminado
   * y copas sobre el mostrador.
   */
  drawBar(x: number, y: number, length: number = 200): void {
    const g = this.graphics
    const height = 34
    const thickness = 14

    // Sombra amplia
    g.beginPath()
    g.ellipse(x, y + height + 6, length * 0.62, 16)
    g.fill({ color: 0x000000, alpha: 0.3 })

    // Glow cálido bajo la barra (luz del backbar)
    g.beginPath()
    g.ellipse(x, y + height / 2 + 8, length * 0.45, 10)
    g.fill({ color: BAR_COLORS.lampGlow, alpha: 0.06 })

    // Frente panelado
    g.beginPath()
    g.moveTo(x - length / 2, y + height / 2)
    g.lineTo(x - length / 2, y + height / 2 + thickness)
    g.lineTo(x + length / 2, y + height / 2 + thickness)
    g.lineTo(x + length / 2, y + height / 2)
    g.closePath()
    g.fill({ color: BAR_COLORS.barFront, alpha: 0.97 })

    // Paneles del frente con línea de latón
    const panels = 6
    for (let i = 0; i < panels; i++) {
      const px = x - length / 2 + (length / panels) * (i + 0.5)
      const pw = length / panels / 2
      g.beginPath()
      g.moveTo(px - pw, y + height / 2 + 2)
      g.lineTo(px + pw, y + height / 2 + 2)
      g.lineTo(px + pw, y + height / 2 + thickness - 2)
      g.lineTo(px - pw, y + height / 2 + thickness - 2)
      g.closePath()
      g.stroke({ width: 1, color: BAR_COLORS.brass, alpha: 0.35 })
    }

    // Tapa
    g.beginPath()
    g.moveTo(x, y - height / 2)
    g.lineTo(x + length / 2, y)
    g.lineTo(x, y + height / 2)
    g.lineTo(x - length / 2, y)
    g.closePath()
    g.fill({ color: BAR_COLORS.barTop, alpha: 0.97 })

    // Canto iluminado de la tapa
    g.beginPath()
    g.moveTo(x, y - height / 2)
    g.lineTo(x + length / 2, y)
    g.lineTo(x, y + height / 2)
    g.lineTo(x - length / 2, y)
    g.closePath()
    g.stroke({ width: 2, color: BAR_COLORS.barTopEdge, alpha: 0.9 })

    // Reflejo en la tapa
    g.beginPath()
    g.moveTo(x - length * 0.18, y - height * 0.16)
    g.lineTo(x + length * 0.1, y - height * 0.02)
    g.lineTo(x - length * 0.05, y + height * 0.1)
    g.lineTo(x - length * 0.3, y - height * 0.02)
    g.closePath()
    g.fill({ color: 0xFFFFFF, alpha: 0.05 })

    // Grosor
    g.beginPath()
    g.moveTo(x - length / 2, y)
    g.lineTo(x - length / 2, y + thickness)
    g.lineTo(x, y + height / 2 + thickness)
    g.lineTo(x, y + height / 2)
    g.closePath()
    g.fill({ color: BAR_COLORS.barSide, alpha: 0.55 })
    g.beginPath()
    g.moveTo(x + length / 2, y)
    g.lineTo(x + length / 2, y + thickness)
    g.lineTo(x, y + height / 2 + thickness)
    g.lineTo(x, y + height / 2)
    g.closePath()
    g.fill({ color: BAR_COLORS.barSide, alpha: 0.35 })

    // Copas sobre la barra (triangulitos con brillo)
    for (let i = 0; i < 3; i++) {
      const cx = x - length * 0.22 + i * (length * 0.2)
      const cy = y - 4
      g.beginPath()
      g.moveTo(cx, cy - 7)
      g.lineTo(cx + 4, cy - 1)
      g.lineTo(cx, cy + 2)
      g.lineTo(cx - 4, cy - 1)
      g.closePath()
      g.fill({ color: 0xF5E9DC, alpha: 0.55 })
      g.beginPath()
      g.moveTo(cx, cy + 2)
      g.lineTo(cx, cy + 5)
      g.stroke({ width: 1, color: BAR_COLORS.brass, alpha: 0.7 })
    }
  }

  /**
   * Taburete alto con base de latón.
   */
  drawBarStool(x: number, y: number): void {
    const g = this.graphics
    const size = 15

    g.beginPath()
    g.ellipse(x, y + 12, size * 0.6, size * 0.25)
    g.fill({ color: 0x000000, alpha: 0.2 })

    // Pie con aro de latón
    g.beginPath()
    g.moveTo(x, y + 3)
    g.lineTo(x, y + 10)
    g.stroke({ width: 2.5, color: BAR_COLORS.lampBase, alpha: 0.9 })
    g.beginPath()
    g.ellipse(x, y + 10, 6, 2.5)
    g.fill({ color: BAR_COLORS.brass, alpha: 0.6 })

    // Asiento
    g.beginPath()
    g.moveTo(x, y - size / 2)
    g.lineTo(x + size / 2, y)
    g.lineTo(x, y + size / 2)
    g.lineTo(x - size / 2, y)
    g.closePath()
    g.fill({ color: BAR_COLORS.barStool, alpha: 0.95 })

    g.beginPath()
    g.moveTo(x, y - size / 2)
    g.lineTo(x + size / 2, y)
    g.lineTo(x, y + size / 2)
    g.lineTo(x - size / 2, y)
    g.closePath()
    g.stroke({ width: 1, color: BAR_COLORS.brass, alpha: 0.45 })
  }

  /**
   * Botella de vidrio traslúcido (gema) con brillo.
   */
  drawBottle(x: number, y: number, color: number = BAR_COLORS.bottleGreen): void {
    const g = this.graphics
    const bw = 8
    const bh = 20

    g.beginPath()
    g.ellipse(x, y + bh / 2 + 2, bw * 0.7, 3)
    g.fill({ color: 0x000000, alpha: 0.15 })

    // Cuerpo traslúcido
    g.beginPath()
    g.moveTo(x, y - bh / 2)
    g.lineTo(x + bw / 2, y)
    g.lineTo(x, y + bh / 2)
    g.lineTo(x - bw / 2, y)
    g.closePath()
    g.fill({ color, alpha: 0.55 })

    // Cuello
    const neckY = y - bh / 2 - 4
    g.beginPath()
    g.moveTo(x, neckY - 3)
    g.lineTo(x + 2.5, neckY)
    g.lineTo(x, neckY + 3)
    g.lineTo(x - 2.5, neckY)
    g.closePath()
    g.fill({ color, alpha: 0.55 })

    // Corcho
    g.beginPath()
    g.moveTo(x, neckY - 3)
    g.lineTo(x + 2.5, neckY)
    g.lineTo(x, neckY + 3)
    g.lineTo(x - 2.5, neckY)
    g.closePath()
    g.fill({ color: BAR_COLORS.bottleCork, alpha: 0.9 })

    // Brillo vertical
    g.beginPath()
    g.moveTo(x + 1, y - 5)
    g.lineTo(x + 3, y)
    g.lineTo(x + 1, y + 5)
    g.lineTo(x - 1, y)
    g.closePath()
    g.fill({ color: 0xFFFFFF, alpha: 0.22 })
  }

  /**
   * Lámpara de escritorio con glow cálido.
   */
  drawLamp(x: number, y: number): void {
    const g = this.graphics

    g.beginPath()
    g.arc(x, y - 5, 20, Math.PI, 0)
    g.fill({ color: BAR_COLORS.lampGlow, alpha: 0.12 })

    g.beginPath()
    g.ellipse(x, y + 5, 10, 4)
    g.fill({ color: BAR_COLORS.lampBase, alpha: 0.95 })
    g.beginPath()
    g.ellipse(x, y + 5, 6, 2.5)
    g.fill({ color: BAR_COLORS.brass, alpha: 0.5 })

    g.beginPath()
    g.moveTo(x, y + 3)
    g.lineTo(x, y - 15)
    g.stroke({ width: 2, color: BAR_COLORS.lampBase, alpha: 0.9 })

    g.beginPath()
    g.moveTo(x, y - 25)
    g.lineTo(x + 10, y - 15)
    g.lineTo(x, y - 10)
    g.lineTo(x - 10, y - 15)
    g.closePath()
    g.fill({ color: BAR_COLORS.lampShade, alpha: 0.97 })

    g.beginPath()
    g.moveTo(x, y - 25)
    g.lineTo(x + 10, y - 15)
    g.lineTo(x, y - 10)
    g.lineTo(x - 10, y - 15)
    g.closePath()
    g.stroke({ width: 1, color: BAR_COLORS.brass, alpha: 0.6 })
  }

  /**
   * Planta frondosa en maceta terracota.
   */
  drawPlant(x: number, y: number): void {
    const g = this.graphics

    g.beginPath()
    g.ellipse(x, y + 8, 12, 5)
    g.fill({ color: 0x000000, alpha: 0.2 })

    g.beginPath()
    g.moveTo(x - 8, y - 3)
    g.lineTo(x - 6, y + 5)
    g.lineTo(x + 6, y + 5)
    g.lineTo(x + 8, y - 3)
    g.closePath()
    g.fill({ color: BAR_COLORS.plantPot, alpha: 0.95 })
    g.beginPath()
    g.moveTo(x - 8, y - 3)
    g.lineTo(x - 6, y + 5)
    g.lineTo(x + 6, y + 5)
    g.lineTo(x + 8, y - 3)
    g.closePath()
    g.stroke({ width: 1, color: 0x7A3A3A, alpha: 0.5 })

    const stems: Array<[number, number]> = [[-4, -13], [2, -11], [0, -16], [-1, -10], [4, -14]]
    for (const [dx, dy] of stems) {
      g.beginPath()
      g.moveTo(x, y - 3)
      g.lineTo(x + dx, y + dy)
      g.stroke({ width: 1.5, color: BAR_COLORS.plantGreen, alpha: 0.7 })
    }

    const leaves: Array<[number, number, number]> = [
      [-5, -13, BAR_COLORS.plantGreen],
      [2, -11, BAR_COLORS.plantGreenLight],
      [0, -16, BAR_COLORS.plantGreen],
      [5, -14, BAR_COLORS.plantGreenLight],
      [-2, -10, BAR_COLORS.plantGreenLight],
    ]
    for (const [dx, dy, color] of leaves) {
      g.beginPath()
      g.moveTo(x + dx, y + dy - 3)
      g.lineTo(x + dx + 4, y + dy)
      g.lineTo(x + dx, y + dy + 3)
      g.lineTo(x + dx - 4, y + dy)
      g.closePath()
      g.fill({ color, alpha: 0.9 })
    }
  }

  /**
   * Escritorio de trabajo con Monitor (Work Area).
   */
  drawDesk(x: number, y: number, width: number = 75): void {
    const g = this.graphics
    const depth = 40

    g.beginPath()
    g.ellipse(x, y + depth / 2 + 8, width * 0.7, depth * 0.3)
    g.fill({ color: 0x000000, alpha: 0.22 })

    const legOffset = width / 2.5
    const legDepth = depth / 2.5
    g.beginPath()
    g.moveTo(x - legOffset, y + legDepth)
    g.lineTo(x - legOffset, y + legDepth + 10)
    g.stroke({ width: 3, color: BAR_COLORS.tableLeg, alpha: 0.85 })
    g.beginPath()
    g.moveTo(x + legOffset, y + legDepth)
    g.lineTo(x + legOffset, y + legDepth + 10)
    g.stroke({ width: 3, color: BAR_COLORS.tableLeg, alpha: 0.85 })

    g.beginPath()
    g.moveTo(x, y - depth / 2)
    g.lineTo(x + width / 2, y)
    g.lineTo(x, y + depth / 2)
    g.lineTo(x - width / 2, y)
    g.closePath()
    g.fill({ color: BAR_COLORS.tableTop, alpha: 0.95 })
    g.beginPath()
    g.moveTo(x, y - depth / 2)
    g.lineTo(x + width / 2, y)
    g.lineTo(x, y + depth / 2)
    g.lineTo(x - width / 2, y)
    g.closePath()
    g.stroke({ width: 1.5, color: BAR_COLORS.tableEdge, alpha: 0.7 })

    const t = 5
    g.beginPath()
    g.moveTo(x - width / 2, y)
    g.lineTo(x - width / 2, y + t)
    g.lineTo(x, y + depth / 2 + t)
    g.lineTo(x, y + depth / 2)
    g.closePath()
    g.fill({ color: BAR_COLORS.tableLeg, alpha: 0.45 })
    g.beginPath()
    g.moveTo(x + width / 2, y)
    g.lineTo(x + width / 2, y + t)
    g.lineTo(x, y + depth / 2 + t)
    g.lineTo(x, y + depth / 2)
    g.closePath()
    g.fill({ color: BAR_COLORS.tableLeg, alpha: 0.28 })

    // Monitor: base + panel con pantalla encendida (glow cyan sutil)
    g.beginPath()
    g.ellipse(x, y - 6, 7, 3)
    g.fill({ color: BAR_COLORS.lampBase, alpha: 0.9 })
    g.beginPath()
    g.moveTo(x, y - 24)
    g.lineTo(x + 13, y - 17)
    g.lineTo(x, y - 10)
    g.lineTo(x - 13, y - 17)
    g.closePath()
    g.fill({ color: BAR_COLORS.lampBase, alpha: 0.95 })
    g.beginPath()
    g.moveTo(x, y - 21)
    g.lineTo(x + 10, y - 16.5)
    g.lineTo(x, y - 12)
    g.lineTo(x - 10, y - 16.5)
    g.closePath()
    g.fill({ color: BAR_COLORS.neon, alpha: 0.28 })
  }

  /**
   * Mesa de centro para el lounge.
   */
  drawCoffeeTable(x: number, y: number): void {
    const g = this.graphics
    const size = 30

    g.beginPath()
    g.ellipse(x, y + 12, size * 0.65, size * 0.28)
    g.fill({ color: 0x000000, alpha: 0.18 })

    g.beginPath()
    g.moveTo(x, y - size / 2)
    g.lineTo(x + size / 2, y)
    g.lineTo(x, y + size / 2)
    g.lineTo(x - size / 2, y)
    g.closePath()
    g.fill({ color: BAR_COLORS.tableLeg, alpha: 0.9 })

    g.beginPath()
    g.moveTo(x, y - size / 2 - 2)
    g.lineTo(x + size / 2 - 2, y - 1)
    g.lineTo(x, y + size / 2 - 2)
    g.lineTo(x - size / 2 + 2, y - 1)
    g.closePath()
    g.fill({ color: BAR_COLORS.tableTop, alpha: 0.95 })

    g.beginPath()
    g.moveTo(x, y - size / 2 - 2)
    g.lineTo(x + size / 2 - 2, y - 1)
    g.lineTo(x, y + size / 2 - 2)
    g.lineTo(x - size / 2 + 2, y - 1)
    g.closePath()
    g.stroke({ width: 1, color: BAR_COLORS.tableEdge, alpha: 0.6 })

    // Taza humeante sobre la mesa
    g.beginPath()
    g.ellipse(x, y - 4, 4, 2)
    g.fill({ color: 0xF5E9DC, alpha: 0.8 })
    g.beginPath()
    g.moveTo(x - 1, y - 8)
    g.quadraticCurveTo(x + 1, y - 10, x - 1, y - 12)
    g.stroke({ width: 1, color: 0xFFFFFF, alpha: 0.25 })
  }

  // ===================================================================
  // Elementos nuevos del bar nocturno
  // ===================================================================

  /**
   * Backbar: pared trasera con estantes iluminados llenos de botellas.
   */
  drawBackbar(x: number, y: number, width: number = 210): void {
    const g = this.graphics

    // Panel de pared (rombo alargado oscuro)
    const ph = 60
    g.beginPath()
    g.moveTo(x, y - ph / 2)
    g.lineTo(x + width / 2, y)
    g.lineTo(x, y + ph / 2)
    g.lineTo(x - width / 2, y)
    g.closePath()
    g.fill({ color: 0x2A1F33, alpha: 0.9 })

    // Glow ambiental detrás de los estantes
    g.beginPath()
    g.moveTo(x, y - ph / 2 + 8)
    g.lineTo(x + width / 2 - 14, y)
    g.lineTo(x, y + ph / 2 - 8)
    g.lineTo(x - width / 2 + 14, y)
    g.closePath()
    g.fill({ color: BAR_COLORS.lampGlow, alpha: 0.07 })

    // Tres estantes
    const bottleColors = [
      BAR_COLORS.bottleGreen, BAR_COLORS.bottleAmber, BAR_COLORS.bottleBlue,
      BAR_COLORS.bottleMagenta, BAR_COLORS.bottleGreen, BAR_COLORS.bottleBlue,
    ]
    for (let shelf = 0; shelf < 3; shelf++) {
      const sy = y - 16 + shelf * 14

      // Estante (línea de madera con canto de latón)
      g.beginPath()
      g.moveTo(x - width / 2 + 22, sy + 5)
      g.lineTo(x, sy + 16)
      g.lineTo(x + width / 2 - 22, sy + 5)
      g.stroke({ width: 2.5, color: BAR_COLORS.barSide, alpha: 0.95 })
      g.beginPath()
      g.moveTo(x - width / 2 + 22, sy + 5)
      g.lineTo(x, sy + 16)
      g.lineTo(x + width / 2 - 22, sy + 5)
      g.stroke({ width: 0.8, color: BAR_COLORS.brass, alpha: 0.5 })

      // Botellas sobre el estante (mini versión traslúcida)
      const nBottles = 7
      for (let i = 0; i < nBottles; i++) {
        const t = (i + 0.5) / nBottles
        const bx = x - width / 2 + 28 + t * (width - 56)
        const by = sy + 4 + t * 8 // seguir la línea iso
        const color = bottleColors[(i + shelf) % bottleColors.length]
        g.beginPath()
        g.moveTo(bx, by - 9)
        g.lineTo(bx + 3, by - 4)
        g.lineTo(bx, by + 1)
        g.lineTo(bx - 3, by - 4)
        g.closePath()
        g.fill({ color, alpha: 0.6 })
      }
    }
  }

  /**
   * Letrero de neón "HQ" en la pared: halo cyan con doble trazo.
   */
  drawNeonSign(x: number, y: number): void {
    const g = this.graphics

    // Halo amplio
    g.beginPath()
    g.ellipse(x, y, 30, 16)
    g.fill({ color: BAR_COLORS.neon, alpha: 0.08 })
    g.beginPath()
    g.ellipse(x, y, 22, 12)
    g.fill({ color: BAR_COLORS.neon, alpha: 0.12 })

    // Marco del letrero
    g.beginPath()
    g.moveTo(x, y - 14)
    g.lineTo(x + 30, y)
    g.lineTo(x, y + 14)
    g.lineTo(x - 30, y)
    g.closePath()
    g.stroke({ width: 1.5, color: BAR_COLORS.neon, alpha: 0.85 })

    // "HQ" — trazos simples tipo neón
    const s = 1.1
    // H (dos verticales + puente)
    g.beginPath()
    g.moveTo(x - 12 * s, y - 6)
    g.lineTo(x - 12 * s, y + 6)
    g.moveTo(x - 6 * s, y - 6)
    g.lineTo(x - 6 * s, y + 6)
    g.moveTo(x - 12 * s, y)
    g.lineTo(x - 6 * s, y)
    g.stroke({ width: 1.8, color: 0xFFFFFF, alpha: 0.95 })
    // Q (círculo + rabito)
    g.beginPath()
    g.ellipse(x + 7 * s, y, 6 * s, 5 * s)
    g.stroke({ width: 1.8, color: 0xFFFFFF, alpha: 0.95 })
    g.beginPath()
    g.moveTo(x + 10 * s, y + 3)
    g.lineTo(x + 13 * s, y + 6)
    g.stroke({ width: 1.8, color: 0xFFFFFF, alpha: 0.95 })
  }

  /**
   * Lámpara colgante (pendant): cable + pantalla con glow cálido.
   */
  drawPendantLamp(x: number, y: number, cableLength: number = 26): void {
    const g = this.graphics

    // Cable
    g.beginPath()
    g.moveTo(x, y - cableLength)
    g.lineTo(x, y - 8)
    g.stroke({ width: 1, color: 0x1A1420, alpha: 0.8 })

    // Glow cónico hacia abajo
    g.beginPath()
    g.moveTo(x - 4, y - 6)
    g.lineTo(x + 16, y + 14)
    g.lineTo(x - 16, y + 14)
    g.closePath()
    g.fill({ color: BAR_COLORS.lampGlow, alpha: 0.1 })

    // Pantalla (semicírculo)
    g.beginPath()
    g.arc(x, y - 6, 8, Math.PI, 0)
    g.closePath()
    g.fill({ color: BAR_COLORS.lampBase, alpha: 0.95 })

    // Borde de latón + bombilla
    g.beginPath()
    g.moveTo(x - 8, y - 6)
    g.lineTo(x + 8, y - 6)
    g.stroke({ width: 1.2, color: BAR_COLORS.brass, alpha: 0.7 })
    g.beginPath()
    g.circle(x, y - 4, 2.5)
    g.fill({ color: BAR_COLORS.lampGlow, alpha: 0.95 })
  }

  /**
   * Tapete del lounge: rombo con borde y trama.
   */
  drawRug(x: number, y: number, width: number = 130, depth: number = 60): void {
    const g = this.graphics

    g.beginPath()
    g.moveTo(x, y - depth / 2)
    g.lineTo(x + width / 2, y)
    g.lineTo(x, y + depth / 2)
    g.lineTo(x - width / 2, y)
    g.closePath()
    g.fill({ color: 0x4A3348, alpha: 0.75 })

    g.beginPath()
    g.moveTo(x, y - depth / 2 + 6)
    g.lineTo(x + width / 2 - 12, y)
    g.lineTo(x, y + depth / 2 - 6)
    g.lineTo(x - width / 2 + 12, y)
    g.closePath()
    g.stroke({ width: 1.5, color: BAR_COLORS.brass, alpha: 0.3 })

    // Trama interior sutil
    for (let i = 1; i < 4; i++) {
      const t = i / 4
      g.beginPath()
      g.moveTo(x - (width / 2) * (1 - t), y - (depth / 2) * t)
      g.lineTo(x + (width / 2) * (1 - t), y + (depth / 2) * t)
      g.stroke({ width: 0.5, color: 0x3A2740, alpha: 0.5 })
    }
  }

  /**
   * Escena completa del bar nocturno.
   */
  drawBarScene(): void {
    // ── Fondo: backbar con estanterías + letrero neón ──
    this.drawBackbar(0, -215, 230)
    this.drawNeonSign(0, -245)

    // Barra principal
    this.drawBar(0, -160, 200)

    // Lámparas pendant sobre la barra
    this.drawPendantLamp(-65, -195, 30)
    this.drawPendantLamp(0, -195, 34)
    this.drawPendantLamp(65, -195, 30)

    // Taburetes
    this.drawBarStool(-75, -128)
    this.drawBarStool(-25, -128)
    this.drawBarStool(25, -128)
    this.drawBarStool(75, -128)

    // Botellas sobre la barra (más variadas)
    this.drawBottle(-38, -172, BAR_COLORS.bottleGreen)
    this.drawBottle(-22, -172, BAR_COLORS.bottleMagenta)
    this.drawBottle(-6, -172, BAR_COLORS.bottleAmber)
    this.drawBottle(10, -172, BAR_COLORS.bottleBlue)
    this.drawBottle(26, -172, BAR_COLORS.bottleGreen)

    // ── Zona Work Control: mesas de espera ──
    this.drawTable(-140, -80, 30)
    this.drawChair(-118, -74)
    this.drawTable(-185, -60, 30)
    this.drawChair(-200, -54)
    this.drawTable(-100, -50, 30)
    this.drawChair(-84, -55)

    // ── Zona Work Area: escritorio con monitor ──
    this.drawDesk(-80, 35, 78)
    this.drawLamp(-45, 22)

    // ── Zona Lounge: tapete + sofás + mesa + plantas ──
    this.drawRug(175, 55, 140, 64)
    this.drawSofa(140, 25, 55)
    this.drawSofa(210, 58, 55)
    this.drawCoffeeTable(175, 62)
    this.drawPlant(238, 18)
    this.drawPlant(120, 70)
  }
}
