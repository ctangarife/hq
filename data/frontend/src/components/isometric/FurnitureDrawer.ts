import { Graphics } from 'pixi.js'

/**
 * Paleta de colores para el estilo de bar Habbo Hotel
 * Colores cálidos y naturales para ambiente acogedor
 */
export const BAR_COLORS = {
  // Suelo/Piso
  floor: 0x8B7355,          // Marrón tierra
  floorAccent: 0x6B5344,    // Marrón más oscuro (patrón)
  floorLine: 0x4A3728,      // Líneas de separación

  // Barra
  barTop: 0xD4A574,         // Madera clara
  barFront: 0x8B6914,       // Madera oscura
  barSide: 0x6B5344,        // Lado de la barra
  barStool: 0x5C4033,       // Caoba oscuro

  // Mesas
  tableTop: 0xC4A484,       // Madera clara
  tableLeg: 0x4A3728,       // Madera oscura
  tableEdge: 0x8B6914,      // Borde de mesa

  // Sillas
  chairSeat: 0x5C4033,      // Asiento de silla
  chairBack: 0x4A3728,      // Respaldo

  // Sofás
  sofaBase: 0x8B4513,       // SaddleBrown
  sofaCushion: 0xCD853F,    // Perú
  sofaArm: 0x654321,        // Brazo de sofá

  // Decoración
  bottleGreen: 0x2E8B57,    // Botellas verdes
  bottleAmber: 0xFFBF00,    // Botellas ámbar
  bottleBlue: 0x4169E1,     // Botellas azules
  bottleCork: 0x8B4513,     // Corcho

  // Lámpara
  lampBase: 0x2F2F2F,       // Base metálica
  lampShade: 0xF5DEB3,      // Pantalla crema
  lampGlow: 0xFFE4B5,       // Luz cálida

  // Planta
  plantPot: 0x8B4513,       // Maceta terracota
  plantGreen: 0x228B22,     // Hojas verdes
  plantGreenLight: 0x32CD32 // Hojas claras
}

/**
 * FurnitureDrawer - Utilidad para dibujar muebles isométricos estilo Habbo Hotel
 * Todos los dibujos usan Graphics API de Pixi.js para máximo rendimiento
 */
export class FurnitureDrawer {
  private graphics: Graphics

  constructor(graphics: Graphics) {
    this.graphics = graphics
  }

  /**
   * Dibujar piso de madera con patrón de tablones
   */
  drawWoodFloor(width: number, height: number): void {
    const g = this.graphics
    const plankWidth = 40
    const plankHeight = 20

    // Dibujar tablones en patrón de ajedrez
    for (let y = -height / 2; y < height / 2; y += plankHeight) {
      for (let x = -width / 2; x < width / 2; x += plankWidth) {
        const isEven = (Math.floor((x + width / 2) / plankWidth) +
                       Math.floor((y + height / 2) / plankHeight)) % 2 === 0

        g.beginPath()
        g.rect(x, y, plankWidth, plankHeight)
        g.fill({
          color: isEven ? BAR_COLORS.floor : BAR_COLORS.floorAccent,
          alpha: 0.6
        })

        // Líneas de separación entre tablones
        g.beginPath()
        g.rect(x, y, plankWidth, plankHeight)
        g.stroke({ width: 0.5, color: BAR_COLORS.floorLine, alpha: 0.3 })
      }
    }
  }

  /**
   * Dibujar mesa isométrica
   */
  drawTable(x: number, y: number, size: number = 35): void {
    const g = this.graphics
    const halfSize = size / 2

    // Sombra de la mesa
    g.beginPath()
    g.ellipse(x, y + 15, size * 0.6, size * 0.25)
    g.fill({ color: 0x000000, alpha: 0.15 })

    // Patas de la mesa (4 líneas simples)
    g.beginPath()
    g.moveTo(x - halfSize * 0.7, y + 5)
    g.lineTo(x - halfSize * 0.7, y + 12)
    g.stroke({ width: 2, color: BAR_COLORS.tableLeg, alpha: 0.8 })

    g.beginPath()
    g.moveTo(x + halfSize * 0.7, y + 5)
    g.lineTo(x + halfSize * 0.7, y + 12)
    g.stroke({ width: 2, color: BAR_COLORS.tableLeg, alpha: 0.8 })

    // Superficie de la mesa (rombo isométrico)
    g.beginPath()
    g.moveTo(x, y - halfSize)
    g.lineTo(x + halfSize, y)
    g.lineTo(x, y + halfSize)
    g.lineTo(x - halfSize, y)
    g.closePath()
    g.fill({ color: BAR_COLORS.tableTop, alpha: 0.95 })

    // Borde de la mesa
    g.beginPath()
    g.moveTo(x, y - halfSize)
    g.lineTo(x + halfSize, y)
    g.lineTo(x, y + halfSize)
    g.lineTo(x - halfSize, y)
    g.closePath()
    g.stroke({ width: 1.5, color: BAR_COLORS.tableEdge, alpha: 0.7 })

    // Grosor 3D (borde inferior)
    const thickness = 4
    g.beginPath()
    g.moveTo(x - halfSize, y)
    g.lineTo(x - halfSize, y + thickness)
    g.lineTo(x, y + halfSize + thickness)
    g.lineTo(x, y + halfSize)
    g.closePath()
    g.fill({ color: BAR_COLORS.tableLeg, alpha: 0.5 })

    g.beginPath()
    g.moveTo(x + halfSize, y)
    g.lineTo(x + halfSize, y + thickness)
    g.lineTo(x, y + halfSize + thickness)
    g.lineTo(x, y + halfSize)
    g.closePath()
    g.fill({ color: BAR_COLORS.tableLeg, alpha: 0.3 })
  }

  /**
   * Dibujar silla simple
   */
  drawChair(x: number, y: number): void {
    const g = this.graphics
    const size = 18

    // Sombra
    g.beginPath()
    g.ellipse(x, y + 8, size * 0.5, size * 0.2)
    g.fill({ color: 0x000000, alpha: 0.1 })

    // Asiento (rombo pequeño)
    g.beginPath()
    g.moveTo(x, y - size / 2)
    g.lineTo(x + size / 2, y)
    g.lineTo(x, y + size / 2)
    g.lineTo(x - size / 2, y)
    g.closePath()
    g.fill({ color: BAR_COLORS.chairSeat, alpha: 0.9 })

    // Respaldo (rombo pequeño arriba)
    const backY = y - size / 2 - 8
    g.beginPath()
    g.moveTo(x, backY - 6)
    g.lineTo(x + 5, backY)
    g.lineTo(x, backY + 6)
    g.lineTo(x - 5, backY)
    g.closePath()
    g.fill({ color: BAR_COLORS.chairBack, alpha: 0.85 })

    // Patas
    g.beginPath()
    g.moveTo(x - 6, y + 4)
    g.lineTo(x - 6, y + 10)
    g.stroke({ width: 1.5, color: BAR_COLORS.chairBack, alpha: 0.6 })

    g.beginPath()
    g.moveTo(x + 6, y + 4)
    g.lineTo(x + 6, y + 10)
    g.stroke({ width: 1.5, color: BAR_COLORS.chairBack, alpha: 0.6 })
  }

  /**
   * Dibujar sofá
   */
  drawSofa(x: number, y: number, width: number = 60): void {
    const g = this.graphics
    const depth = 25

    // Sombra del sofá
    g.beginPath()
    g.ellipse(x, y + 10, width * 0.7, depth * 0.3)
    g.fill({ color: 0x000000, alpha: 0.15 })

    // Base del sofá (rombo alargado)
    g.beginPath()
    g.moveTo(x, y - depth / 2)
    g.lineTo(x + width / 2, y)
    g.lineTo(x, y + depth / 2)
    g.lineTo(x - width / 2, y)
    g.closePath()
    g.fill({ color: BAR_COLORS.sofaBase, alpha: 0.95 })

    // Cojines (2 rombos más claros)
    const cushionWidth = width / 2.5

    // Cojín izquierdo
    g.beginPath()
    g.moveTo(x - cushionWidth, y - depth / 4)
    g.lineTo(x - cushionWidth / 2, y)
    g.lineTo(x - cushionWidth, y + depth / 4)
    g.lineTo(x - cushionWidth * 1.5, y)
    g.closePath()
    g.fill({ color: BAR_COLORS.sofaCushion, alpha: 0.7 })

    // Cojín derecho
    g.beginPath()
    g.moveTo(x + cushionWidth, y - depth / 4)
    g.lineTo(x + cushionWidth * 1.5, y)
    g.lineTo(x + cushionWidth, y + depth / 4)
    g.lineTo(x + cushionWidth / 2, y)
    g.closePath()
    g.fill({ color: BAR_COLORS.sofaCushion, alpha: 0.7 })

    // Respaldo (borde superior)
    g.beginPath()
    g.moveTo(x, y - depth / 2)
    g.lineTo(x + width / 2, y)
    g.lineTo(x, y + depth / 2)
    g.lineTo(x - width / 2, y)
    g.closePath()
    g.stroke({ width: 3, color: BAR_COLORS.sofaArm, alpha: 0.6 })

    // Brazos
    g.beginPath()
    g.ellipse(x - width / 2 + 5, y, 8, 4)
    g.fill({ color: BAR_COLORS.sofaArm, alpha: 0.8 })

    g.beginPath()
    g.ellipse(x + width / 2 - 5, y, 8, 4)
    g.fill({ color: BAR_COLORS.sofaArm, alpha: 0.8 })
  }

  /**
   * Dibujar barra con taburetes
   */
  drawBar(x: number, y: number, length: number = 180): void {
    const g = this.graphics
    const height = 30
    const thickness = 12

    // Sombra de la barra
    g.beginPath()
    g.ellipse(x, y + height + 5, length * 0.6, 15)
    g.fill({ color: 0x000000, alpha: 0.2 })

    // Frente de la barra (rectángulo vertical)
    g.beginPath()
    g.moveTo(x - length / 2, y + height / 2)
    g.lineTo(x - length / 2, y + height / 2 + thickness)
    g.lineTo(x + length / 2, y + height / 2 + thickness)
    g.lineTo(x + length / 2, y + height / 2)
    g.closePath()
    g.fill({ color: BAR_COLORS.barFront, alpha: 0.95 })

    // Detalle de madera en el frente
    for (let i = 0; i < 5; i++) {
      const lineX = x - length / 2 + (length / 5) * i + 10
      g.beginPath()
      g.moveTo(lineX, y + height / 2 + 2)
      g.lineTo(lineX, y + height / 2 + thickness - 2)
      g.stroke({ width: 1, color: 0x4A3728, alpha: 0.3 })
    }

    // Superficie de la barra (rombo alargado)
    g.beginPath()
    g.moveTo(x, y - height / 2)
    g.lineTo(x + length / 2, y)
    g.lineTo(x, y + height / 2)
    g.lineTo(x - length / 2, y)
    g.closePath()
    g.fill({ color: BAR_COLORS.barTop, alpha: 0.95 })

    // Borde de la barra
    g.beginPath()
    g.moveTo(x, y - height / 2)
    g.lineTo(x + length / 2, y)
    g.lineTo(x, y + height / 2)
    g.lineTo(x - length / 2, y)
    g.closePath()
    g.stroke({ width: 2, color: BAR_COLORS.barSide, alpha: 0.7 })

    // Grosor lateral
    g.beginPath()
    g.moveTo(x - length / 2, y)
    g.lineTo(x - length / 2, y + thickness)
    g.lineTo(x, y + height / 2 + thickness)
    g.lineTo(x, y + height / 2)
    g.closePath()
    g.fill({ color: BAR_COLORS.barSide, alpha: 0.5 })

    g.beginPath()
    g.moveTo(x + length / 2, y)
    g.lineTo(x + length / 2, y + thickness)
    g.lineTo(x, y + height / 2 + thickness)
    g.lineTo(x, y + height / 2)
    g.closePath()
    g.fill({ color: BAR_COLORS.barSide, alpha: 0.3 })
  }

  /**
   * Dibujar taburete de barra
   */
  drawBarStool(x: number, y: number): void {
    const g = this.graphics
    const size = 15

    // Sombra
    g.beginPath()
    g.ellipse(x, y + 12, size * 0.6, size * 0.25)
    g.fill({ color: 0x000000, alpha: 0.15 })

    // Pata central
    g.beginPath()
    g.moveTo(x, y + 3)
    g.lineTo(x, y + 10)
    g.stroke({ width: 3, color: BAR_COLORS.barStool, alpha: 0.8 })

    // Base del taburete (rombo pequeño)
    g.beginPath()
    g.moveTo(x, y - size / 2)
    g.lineTo(x + size / 2, y)
    g.lineTo(x, y + size / 2)
    g.lineTo(x - size / 2, y)
    g.closePath()
    g.fill({ color: BAR_COLORS.barStool, alpha: 0.95 })

    // Borde
    g.beginPath()
    g.moveTo(x, y - size / 2)
    g.lineTo(x + size / 2, y)
    g.lineTo(x, y + size / 2)
    g.lineTo(x - size / 2, y)
    g.closePath()
    g.stroke({ width: 1, color: 0x3D2B1F, alpha: 0.6 })
  }

  /**
   * Dibujar botella decorativa
   */
  drawBottle(x: number, y: number, color: number = BAR_COLORS.bottleGreen): void {
    const g = this.graphics
    const bottleWidth = 8
    const bottleHeight = 20

    // Sombra
    g.beginPath()
    g.ellipse(x, y + bottleHeight / 2 + 2, bottleWidth * 0.7, 3)
    g.fill({ color: 0x000000, alpha: 0.1 })

    // Cuerpo de la botella (rombo alargado)
    g.beginPath()
    g.moveTo(x, y - bottleHeight / 2)
    g.lineTo(x + bottleWidth / 2, y)
    g.lineTo(x, y + bottleHeight / 2)
    g.lineTo(x - bottleWidth / 2, y)
    g.closePath()
    g.fill({ color: color, alpha: 0.85 })

    // Cuello
    const neckY = y - bottleHeight / 2 - 4
    g.beginPath()
    g.moveTo(x, neckY - 3)
    g.lineTo(x + 2.5, neckY)
    g.lineTo(x, neckY + 3)
    g.lineTo(x - 2.5, neckY)
    g.closePath()
    g.fill({ color: color, alpha: 0.85 })

    // Corcho
    g.beginPath()
    g.moveTo(x, neckY - 3)
    g.lineTo(x + 2.5, neckY)
    g.lineTo(x, neckY + 3)
    g.lineTo(x - 2.5, neckY)
    g.closePath()
    g.fill({ color: BAR_COLORS.bottleCork, alpha: 0.9 })

    // Brillo en la botella
    g.beginPath()
    g.moveTo(x + 1, y - 5)
    g.lineTo(x + 3, y)
    g.lineTo(x + 1, y + 5)
    g.lineTo(x - 1, y)
    g.closePath()
    g.fill({ color: 0xFFFFFF, alpha: 0.15 })
  }

  /**
   * Dibujar lámpara de escritorio
   */
  drawLamp(x: number, y: number): void {
    const g = this.graphics

    // Glow de luz (semicírculo transparente)
    g.beginPath()
    g.arc(x, y - 5, 20, Math.PI, 0)
    g.fill({ color: BAR_COLORS.lampGlow, alpha: 0.15 })

    // Base de la lámpara
    g.beginPath()
    g.ellipse(x, y + 5, 10, 4)
    g.fill({ color: BAR_COLORS.lampBase, alpha: 0.9 })

    // Brazo
    g.beginPath()
    g.moveTo(x, y + 3)
    g.lineTo(x, y - 15)
    g.stroke({ width: 2, color: BAR_COLORS.lampBase, alpha: 0.8 })

    // Pantalla de la lámpara (trapezoide isométrico)
    g.beginPath()
    g.moveTo(x, y - 25)
    g.lineTo(x + 10, y - 15)
    g.lineTo(x, y - 10)
    g.lineTo(x - 10, y - 15)
    g.closePath()
    g.fill({ color: BAR_COLORS.lampShade, alpha: 0.95 })

    // Borde de la pantalla
    g.beginPath()
    g.moveTo(x, y - 25)
    g.lineTo(x + 10, y - 15)
    g.lineTo(x, y - 10)
    g.lineTo(x - 10, y - 15)
    g.closePath()
    g.stroke({ width: 1, color: 0xC0B090, alpha: 0.5 })
  }

  /**
   * Dibujar planta en maceta
   */
  drawPlant(x: number, y: number): void {
    const g = this.graphics

    // Sombra de la maceta
    g.beginPath()
    g.ellipse(x, y + 8, 12, 5)
    g.fill({ color: 0x000000, alpha: 0.15 })

    // Maceta (rombo truncado)
    g.beginPath()
    g.moveTo(x - 8, y - 3)
    g.lineTo(x - 6, y + 5)
    g.lineTo(x + 6, y + 5)
    g.lineTo(x + 8, y - 3)
    g.closePath()
    g.fill({ color: BAR_COLORS.plantPot, alpha: 0.95 })

    // Borde de la maceta
    g.beginPath()
    g.moveTo(x - 8, y - 3)
    g.lineTo(x - 6, y + 5)
    g.lineTo(x + 6, y + 5)
    g.lineTo(x + 8, y - 3)
    g.closePath()
    g.stroke({ width: 1, color: 0x6B4423, alpha: 0.5 })

    // Tallos (líneas simples)
    g.beginPath()
    g.moveTo(x, y - 3)
    g.lineTo(x - 3, y - 12)
    g.stroke({ width: 1.5, color: BAR_COLORS.plantGreen, alpha: 0.7 })

    g.beginPath()
    g.moveTo(x, y - 3)
    g.lineTo(x + 2, y - 10)
    g.stroke({ width: 1.5, color: BAR_COLORS.plantGreen, alpha: 0.7 })

    g.beginPath()
    g.moveTo(x, y - 3)
    g.lineTo(x, y - 14)
    g.stroke({ width: 1.5, color: BAR_COLORS.plantGreen, alpha: 0.7 })

    // Hojas (rombos verdes de diferentes tamaños)
    // Hoja 1
    g.beginPath()
    g.moveTo(x - 3, y - 12)
    g.lineTo(x + 1, y - 10)
    g.lineTo(x - 3, y - 8)
    g.lineTo(x - 7, y - 10)
    g.closePath()
    g.fill({ color: BAR_COLORS.plantGreen, alpha: 0.85 })

    // Hoja 2
    g.beginPath()
    g.moveTo(x + 2, y - 10)
    g.lineTo(x + 5, y - 8)
    g.lineTo(x + 2, y - 6)
    g.lineTo(x - 1, y - 8)
    g.closePath()
    g.fill({ color: BAR_COLORS.plantGreenLight, alpha: 0.85 })

    // Hoja 3 (superior)
    g.beginPath()
    g.moveTo(x, y - 14)
    g.lineTo(x + 4, y - 11)
    g.lineTo(x, y - 8)
    g.lineTo(x - 4, y - 11)
    g.closePath()
    g.fill({ color: BAR_COLORS.plantGreen, alpha: 0.85 })
  }

  /**
   * Dibujar escritorio grande
   */
  drawDesk(x: number, y: number, width: number = 70): void {
    const g = this.graphics
    const depth = 40

    // Sombra
    g.beginPath()
    g.ellipse(x, y + depth / 2 + 8, width * 0.7, depth * 0.3)
    g.fill({ color: 0x000000, alpha: 0.15 })

    // Patas (esquinas)
    const legOffset = width / 2.5
    const legDepth = depth / 2.5

    g.beginPath()
    g.moveTo(x - legOffset, y + legDepth)
    g.lineTo(x - legOffset, y + legDepth + 10)
    g.stroke({ width: 3, color: BAR_COLORS.tableLeg, alpha: 0.7 })

    g.beginPath()
    g.moveTo(x + legOffset, y + legDepth)
    g.lineTo(x + legOffset, y + legDepth + 10)
    g.stroke({ width: 3, color: BAR_COLORS.tableLeg, alpha: 0.7 })

    // Superficie del escritorio
    g.beginPath()
    g.moveTo(x, y - depth / 2)
    g.lineTo(x + width / 2, y)
    g.lineTo(x, y + depth / 2)
    g.lineTo(x - width / 2, y)
    g.closePath()
    g.fill({ color: BAR_COLORS.tableTop, alpha: 0.95 })

    // Borde
    g.beginPath()
    g.moveTo(x, y - depth / 2)
    g.lineTo(x + width / 2, y)
    g.lineTo(x, y + depth / 2)
    g.lineTo(x - width / 2, y)
    g.closePath()
    g.stroke({ width: 2, color: BAR_COLORS.tableEdge, alpha: 0.6 })

    // Grosor
    const thickness = 5
    g.beginPath()
    g.moveTo(x - width / 2, y)
    g.lineTo(x - width / 2, y + thickness)
    g.lineTo(x, y + depth / 2 + thickness)
    g.lineTo(x, y + depth / 2)
    g.closePath()
    g.fill({ color: BAR_COLORS.tableLeg, alpha: 0.4 })

    g.beginPath()
    g.moveTo(x + width / 2, y)
    g.lineTo(x + width / 2, y + thickness)
    g.lineTo(x, y + depth / 2 + thickness)
    g.lineTo(x, y + depth / 2)
    g.closePath()
    g.fill({ color: BAR_COLORS.tableLeg, alpha: 0.2 })
  }

  /**
   * Dibujar mesa de centro (para lounge)
   */
  drawCoffeeTable(x: number, y: number): void {
    const g = this.graphics
    const size = 30

    // Sombra
    g.beginPath()
    g.ellipse(x, y + 12, size * 0.6, size * 0.25)
    g.fill({ color: 0x000000, alpha: 0.12 })

    // Base de la mesa (rombo)
    g.beginPath()
    g.moveTo(x, y - size / 2)
    g.lineTo(x + size / 2, y)
    g.lineTo(x, y + size / 2)
    g.lineTo(x - size / 2, y)
    g.closePath()
    g.fill({ color: 0x4A3728, alpha: 0.9 })

    // Superficie
    g.beginPath()
    g.moveTo(x, y - size / 2 - 2)
    g.lineTo(x + size / 2 - 2, y - 1)
    g.lineTo(x, y + size / 2 - 2)
    g.lineTo(x - size / 2 + 2, y - 1)
    g.closePath()
    g.fill({ color: 0xC4A484, alpha: 0.95 })

    // Borde
    g.beginPath()
    g.moveTo(x, y - size / 2 - 2)
    g.lineTo(x + size / 2 - 2, y - 1)
    g.lineTo(x, y + size / 2 - 2)
    g.lineTo(x - size / 2 + 2, y - 1)
    g.closePath()
    g.stroke({ width: 1, color: BAR_COLORS.tableEdge, alpha: 0.5 })
  }

  /**
   * Dibujar todos los muebles del bar según el layout
   */
  drawBarScene(): void {
    // Zona Work Control: Mesas de espera
    this.drawTable(-140, -80, 30)
    this.drawChair(-120, -75)
    this.drawTable(-180, -60, 30)
    this.drawChair(-195, -55)
    this.drawTable(-100, -50, 30)
    this.drawChair(-85, -55)

    // Zona Work Area: Escritorio de trabajo
    this.drawDesk(-80, 30, 75)
    this.drawLamp(-50, 20)

    // Barra Central (fondo)
    this.drawBar(0, -160, 200)

    // Taburetes de la barra
    this.drawBarStool(-70, -130)
    this.drawBarStool(-20, -130)
    this.drawBarStool(30, -130)
    this.drawBarStool(80, -130)

    // Botellas sobre la barra
    this.drawBottle(-30, -170, BAR_COLORS.bottleGreen)
    this.drawBottle(-10, -170, BAR_COLORS.bottleAmber)
    this.drawBottle(10, -170, BAR_COLORS.bottleBlue)
    this.drawBottle(30, -170, BAR_COLORS.bottleGreen)

    // Zona Lounge: Sofás
    this.drawSofa(140, 20, 55)
    this.drawSofa(200, 50, 55)

    // Mesa de centro
    this.drawCoffeeTable(170, 60)

    // Planta decorativa
    this.drawPlant(230, 20)
  }
}
