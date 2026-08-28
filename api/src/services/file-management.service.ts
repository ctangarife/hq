import fs from 'fs/promises'
import path from 'path'
import { createReadStream, createWriteStream, readFileSync } from 'fs'
import crypto from 'crypto'
import { mkdirp } from 'mkdirp'
import PDFDocument from 'pdfkit'
import { marked } from 'marked'
import Task from '../models/Task'
import Mission from '../models/Mission'
import { litellmService } from './litellm.service.js'

const FILES_BASE_PATH = process.env.HQ_FILES_PATH || '/data/hq-files'

/**
 * Estructura de carpetas para misiones:
 *
 * /data/hq-files/
 * ├── missions/
 * │   ├── {mission_id}/
 * │   │   ├── metadata.json          # Info de la misión
 * │   │   ├── inputs/                # Archivos subidos por usuario
 * │   │   ├── tasks/
 * │   │   │   └── {task_id}/
 * │   │   │       ├── input.json     # Contexto dado al agente
 * │   │   │       ├── output.json    # Resultado estructurado
 * │   │   │       ├── output.md      # Output en markdown (si aplica)
 * │   │   │       ├── artifacts/     # Archivos generados por agente
 * │   │   │       └── logs/          # Logs de ejecución
 * │   │   └── outputs/               # Entregables finales consolidados
 * └── temp/                          # Archivos temporales (se limpian)
 */

export interface StoredFileInfo {
  id: string            // ID único del archivo
  originalName: string  // Nombre original del archivo
  mimeType: string      // Tipo MIME
  size: number          // Tamaño en bytes
  path: string          // Ruta completa dentro del volumen
  relativePath: string  // Ruta relativa para descargas
  checksum: string      // SHA-256 del contenido
  uploadedAt: Date      // Timestamp de subida
}

export interface MissionMetadata {
  missionId: string
  title: string
  createdAt: Date
  inputFiles: StoredFileInfo[]
  outputFiles: StoredFileInfo[]
  totalSize: number
}

export interface TaskOutput {
  taskId: string
  missionId: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  output?: any
  partialOutput?: any
  artifacts?: StoredFileInfo[]
  logs?: string[]
  startedAt?: Date
  completedAt?: Date
}

export class FileManagementService {
  private basePath: string

  constructor() {
    this.basePath = FILES_BASE_PATH
    this.initializeBaseStructure()
  }

  /**
   * Inicializar estructura base de carpetas
   */
  private async initializeBaseStructure(): Promise<void> {
    const dirs = [
      path.join(this.basePath, 'missions'),
      path.join(this.basePath, 'temp')
    ]

    for (const dir of dirs) {
      try {
        await mkdirp(dir)
      } catch (error) {
        console.error(`Error creating directory ${dir}:`, error)
      }
    }
  }

  /**
   * Crear estructura de carpetas para una misión
   */
  async createMissionStructure(missionId: string, title: string): Promise<void> {
    const missionPath = path.join(this.basePath, 'missions', missionId)
    const dirs = [
      path.join(missionPath, 'inputs'),
      path.join(missionPath, 'tasks'),
      path.join(missionPath, 'outputs')
    ]

    for (const dir of dirs) {
      await mkdirp(dir)
    }

    // Crear metadata.json
    const metadata: MissionMetadata = {
      missionId,
      title,
      createdAt: new Date(),
      inputFiles: [],
      outputFiles: [],
      totalSize: 0
    }

    await fs.writeFile(
      path.join(missionPath, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    )

    console.log(`✅ Mission structure created: ${missionId}`)
  }

  /**
   * Guardar archivo subido por usuario en la carpeta inputs de la misión
   */
  async saveInputFile(
    missionId: string,
    file: Buffer | Express.Multer.File,
    originalName: string,
    mimeType: string
  ): Promise<StoredFileInfo> {
    const missionPath = path.join(this.basePath, 'missions', missionId)
    const inputsPath = path.join(missionPath, 'inputs')

    // La misión puede no tener estructura aún (ej: se acaba de crear y el
    // usuario adjunta archivos desde el modal de creación) — garantizarla
    await mkdirp(inputsPath)

    // Generar ID único
    const fileId = crypto.randomBytes(16).toString('hex')
    const ext = path.extname(originalName)
    const filename = `${fileId}${ext}`
    const filePath = path.join(inputsPath, filename)

    // Obtener buffer
    const buffer = file instanceof Buffer ? file : file.buffer

    // Calcular checksum
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex')

    // Guardar archivo
    await fs.writeFile(filePath, buffer)

    const fileInfo: StoredFileInfo = {
      id: fileId,
      originalName,
      mimeType,
      size: buffer.length,
      path: filePath,
      relativePath: path.join('missions', missionId, 'inputs', filename).replace(/\\/g, '/'),
      checksum,
      uploadedAt: new Date()
    }

    // Actualizar metadata.json
    await this.updateMissionMetadata(missionId, (metadata) => {
      metadata.inputFiles.push(fileInfo)
      metadata.totalSize += buffer.length
    })

    console.log(`✅ Input file saved: ${originalName} (${buffer.length} bytes)`)
    return fileInfo
  }

  /**
   * Guardar output de tarea
   */
  async saveTaskOutput(taskId: string, missionId: string, output: TaskOutput): Promise<void> {
    const taskPath = path.join(this.basePath, 'missions', missionId, 'tasks', taskId)
    await mkdirp(taskPath)

    // Guardar output estructurado
    await fs.writeFile(
      path.join(taskPath, 'output.json'),
      JSON.stringify(output, null, 2)
    )

    // Si hay markdown, guardarlo también
    if (typeof output.output === 'string' && output.output.length < 100000) {
      await fs.writeFile(
        path.join(taskPath, 'output.md'),
        output.output
      )
    }

    console.log(`✅ Task output saved: ${taskId}`)
  }

  /**
   * Guardar artifact generado por agente (código, imágenes, etc.)
   */
  async saveTaskArtifact(
    taskId: string,
    missionId: string,
    filename: string,
    content: Buffer | string,
    mimeType: string
  ): Promise<StoredFileInfo> {
    const taskPath = path.join(this.basePath, 'missions', missionId, 'tasks', taskId)
    const artifactsPath = path.join(taskPath, 'artifacts')
    await mkdirp(artifactsPath)

    const filePath = path.join(artifactsPath, filename)

    // Convertir string a Buffer si es necesario
    const buffer = content instanceof Buffer ? content : Buffer.from(content)

    await fs.writeFile(filePath, buffer)

    const fileInfo: StoredFileInfo = {
      id: crypto.randomBytes(16).toString('hex'),
      originalName: filename,
      mimeType,
      size: buffer.length,
      path: filePath,
      relativePath: path.join('missions', missionId, 'tasks', taskId, 'artifacts', filename).replace(/\\/g, '/'),
      checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
      uploadedAt: new Date()
    }

    console.log(`✅ Artifact saved: ${filename} (${buffer.length} bytes)`)
    return fileInfo
  }

  /**
   * Actualizar partial output de una tarea (para streaming en tiempo real)
   */
  async updatePartialOutput(taskId: string, missionId: string, partialOutput: any): Promise<void> {
    const taskPath = path.join(this.basePath, 'missions', missionId, 'tasks', taskId)

    // Guardar partial_output.json
    await fs.writeFile(
      path.join(taskPath, 'partial_output.json'),
      JSON.stringify(partialOutput, null, 2)
    )
  }

  /**
   * Leer output de tarea
   */
  async getTaskOutput(taskId: string, missionId: string): Promise<TaskOutput | null> {
    const outputPath = path.join(this.basePath, 'missions', missionId, 'tasks', taskId, 'output.json')

    try {
      const content = await fs.readFile(outputPath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return null
    }
  }

  /**
   * Leer partial output de tarea
   */
  async getPartialOutput(taskId: string, missionId: string): Promise<any | null> {
    const partialPath = path.join(this.basePath, 'missions', missionId, 'tasks', taskId, 'partial_output.json')

    try {
      const content = await fs.readFile(partialPath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return null
    }
  }

  /**
   * Leer archivo de input
   */
  async getInputFile(missionId: string, filename: string): Promise<Buffer> {
    const filePath = path.join(this.basePath, 'missions', missionId, 'inputs', filename)
    return await fs.readFile(filePath)
  }

  async getOutputFile(missionId: string, filename: string): Promise<Buffer> {
    const filePath = path.join(this.basePath, 'missions', missionId, 'outputs', filename)
    return await fs.readFile(filePath)
  }

  /**
   * Leer metadata de misión
   */
  async getMissionMetadata(missionId: string): Promise<MissionMetadata | null> {
    const metadataPath = path.join(this.basePath, 'missions', missionId, 'metadata.json')

    try {
      const content = await fs.readFile(metadataPath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return null
    }
  }

  /**
   * Actualizar metadata de misión
   */
  private async updateMissionMetadata(
    missionId: string,
    updater: (metadata: MissionMetadata) => void
  ): Promise<void> {
    const metadataPath = path.join(this.basePath, 'missions', missionId, 'metadata.json')

    let metadata: MissionMetadata

    try {
      const content = await fs.readFile(metadataPath, 'utf-8')
      metadata = JSON.parse(content)
    } catch {
      // File doesn't exist, create new metadata
      metadata = {
        missionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        inputFiles: [],
        outputFiles: [],
        totalSize: 0
      } as MissionMetadata
    }

    updater(metadata)
    metadata.updatedAt = new Date().toISOString()

    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2))
  }

  /**
   * Generar PDF desde markdown
   * Convierte markdown a HTML y luego genera PDF con PDFKit
   */
  async generatePDF(markdown: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Crear documento PDF
        const doc = new PDFDocument({
          size: 'A4',
          margins: {
            top: 50,
            bottom: 50,
            left: 50,
            right: 50
          },
          bufferPages: true
        })

        // Pipe output a archivo
        const stream = createWriteStream(outputPath)
        doc.pipe(stream)

        // Configurar fuentes
        const fontSize = {
          title: 24,
          h1: 20,
          h2: 16,
          h3: 14,
          body: 11,
          code: 9
        }

        let yPosition = doc.y
        const pageHeight = doc.page.height
        const marginBottom = 50
        const lineHeight = 1.4

        // Función para verificar espacio y agregar nueva página si es necesario
        const checkPageBreak = (requiredSpace: number) => {
          if (yPosition + requiredSpace > pageHeight - marginBottom) {
            doc.addPage()
            yPosition = doc.y
          }
        }

        // Procesar línea por línea
        const lines = markdown.split('\n')
        let inCodeBlock = false
        let codeLines: string[] = []

        // El renderer no interpreta markdown inline: quitar marcadores de
        // negrita para que no aparezcan literales ('**Objetivo:**') en el PDF.
        // Los emojis se mapean a texto o se quitan: Helvetica (WinAnsi) no
        // tiene sus glifos y saldrían como basura ('&þ').
        const stripInlineMd = (s: string) => s
          .replace(/\*\*/g, '')
          .replace(/⚠️?/g, '[!]')
          .replace(/✅/g, '[OK]')
          .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, '')

        // ── Render de tablas markdown ──
        // Antes las filas se imprimían como texto crudo ('| Fuente | Estado |').
        // Ahora cada bloque de líneas que empiezan con '|' se dibuja como
        // tabla real: header con fondo, celdas con bordes y texto envuelto.
        const wrapCellText = (text: string, size: number, maxWidth: number): string[] => {
          doc.font('Helvetica').fontSize(size)
          const words = text.split(/\s+/).filter(Boolean)
          if (!words.length) return ['']
          const out: string[] = []
          let current = ''
          for (const w of words) {
            const candidate = current ? current + ' ' + w : w
            if (doc.widthOfString(candidate) <= maxWidth) {
              current = candidate
            } else {
              if (current) out.push(current)
              current = w
            }
          }
          if (current) out.push(current)
          return out
        }

        const renderMarkdownTable = (tableLines: string[]) => {
          const parseRow = (l: string): string[] =>
            l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())

          const isSeparator = (cells: string[]) =>
            cells.length > 0 && cells.every(c => c === '' || /^:?-{2,}:?$/.test(c))

          const rows = tableLines.map(parseRow).filter(r => !isSeparator(r))
          if (rows.length === 0) return

          const nCols = Math.max(...rows.map(r => r.length))
          rows.forEach(r => { while (r.length < nCols) r.push('') })

          const contentWidth = doc.page.width - 100 // márgenes 50+50
          const cellPadX = 5
          const cellPadY = 4
          const cellLineH = 11
          const headSize = 9.5
          const bodySize = 9

          // Ancho natural por columna (contenido más ancho), acotado al área útil
          const natural: number[] = []
          for (let c = 0; c < nCols; c++) {
            let w = 30
            for (let r = 0; r < rows.length; r++) {
              doc.font(r === 0 ? 'Helvetica-Bold' : 'Helvetica')
                .fontSize(r === 0 ? headSize : bodySize)
              w = Math.max(w, doc.widthOfString(stripInlineMd(rows[r][c])) + cellPadX * 2)
            }
            natural.push(Math.min(w, contentWidth * 0.6))
          }

          // Escalar proporcionalmente si excede el ancho disponible
          let widths = natural
          const total = natural.reduce((a, b) => a + b, 0)
          if (total > contentWidth) {
            const minW = Math.min(45, contentWidth / nCols)
            const scale = (contentWidth - minW * nCols) / (total - minW * nCols)
            widths = natural.map(w => Math.max(minW, w * scale))
            const used = widths.reduce((a, b) => a + b, 0)
            widths[nCols - 1] += contentWidth - used
          }

          const drawRow = (cells: string[], isHeader: boolean, rowIdx: number) => {
            const size = isHeader ? headSize : bodySize
            const cellLines = cells.map((c, i) =>
              wrapCellText(stripInlineMd(c), size, widths[i] - cellPadX * 2))
            const rowH = Math.max(...cellLines.map(ls => ls.length)) * cellLineH + cellPadY * 2

            if (yPosition + rowH > doc.page.height - marginBottom) {
              doc.addPage()
              yPosition = doc.y
              // Repetir el header tras el salto de página
              if (!isHeader) drawRow(rows[0], true, 0)
            }

            const x0 = 50
            const y0 = yPosition

            // Fondo: header sólido, filas pares con franja sutil
            if (isHeader) {
              doc.rect(x0, y0, contentWidth, rowH).fill('#dbe4f0')
            } else if (rowIdx % 2 === 1) {
              doc.rect(x0, y0, contentWidth, rowH).fill('#f4f6f9')
            }

            // Texto de celdas (antes que bordes para que estos queden encima)
            doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
              .fontSize(size)
              .fillColor(isHeader ? '#1f2937' : '#333333')
            let x = x0
            for (let i = 0; i < nCols; i++) {
              const linesToDraw = cellLines[i]
              let ty = y0 + cellPadY
              for (const tl of linesToDraw) {
                doc.text(tl, x + cellPadX, ty, { lineBreak: false })
                ty += cellLineH
              }
              x += widths[i]
            }

            // Bordes: perímetro + divisiones verticales + base
            doc.rect(x0, y0, contentWidth, rowH).lineWidth(0.7).strokeColor('#b9c4d2').stroke()
            x = x0
            for (let i = 0; i < nCols; i++) {
              doc.moveTo(x, y0).lineTo(x, y0 + rowH).stroke()
              x += widths[i]
            }

            yPosition = y0 + rowH
          }

          checkPageBreak(30)
          rows.forEach((cells, idx) => drawRow(cells, idx === 0, idx))
          yPosition += 10
        }

        for (let li = 0; li < lines.length; li++) {
          const line = stripInlineMd(lines[li].trimEnd())

          // Bloque de tabla markdown: consumir líneas consecutivas con '|'
          if (!inCodeBlock && line.trim().startsWith('|')) {
            const tableLines: string[] = []
            while (li < lines.length && lines[li].trim().startsWith('|')) {
              tableLines.push(lines[li])
              li++
            }
            li-- // compensar el li++ del for
            renderMarkdownTable(tableLines)
            continue
          }

          // Detectar bloques de código
          if (line.startsWith('```')) {
            if (inCodeBlock) {
              // Finalizar bloque de código
              inCodeBlock = false

              // Dibujar bloque de código
              checkPageBreak(20 + codeLines.length * 14)

              // Fondo gris para el bloque
              const codeWidth = doc.page.width - 100
              doc.rect(50, yPosition, codeWidth, codeLines.length * 14 + 10)
                .fillAndStroke('#f5f5f5', '#e0e0e0')

              yPosition += 5

              // Escribir líneas de código
              doc.font('Courier')
                .fontSize(fontSize.code)
                .fillColor('#333333')

              for (const codeLine of codeLines) {
                doc.text(codeLine, 55, yPosition, {
                  width: codeWidth - 10,
                  lineGap: 2
                })
                yPosition += 14
              }

              yPosition += 5
              codeLines = []
            } else {
              // Iniciar bloque de código
              inCodeBlock = true
            }
            continue
          }

          // Si estamos en un bloque de código, acumular líneas
          if (inCodeBlock) {
            codeLines.push(line)
            continue
          }

          // Procesar encabezados
          if (line.startsWith('# ')) {
            checkPageBreak(30)
            doc.font('Helvetica-Bold')
              .fontSize(fontSize.h1)
              .fillColor('#000000')
              .text(line.substring(2), 50, yPosition)
            yPosition = doc.y + 10
            continue
          }

          if (line.startsWith('## ')) {
            checkPageBreak(25)
            doc.font('Helvetica-Bold')
              .fontSize(fontSize.h2)
              .fillColor('#333333')
              .text(line.substring(3), 50, yPosition)
            yPosition = doc.y + 8
            continue
          }

          if (line.startsWith('### ')) {
            checkPageBreak(22)
            doc.font('Helvetica-Bold')
              .fontSize(fontSize.h3)
              .fillColor('#555555')
              .text(line.substring(4), 50, yPosition)
            yPosition = doc.y + 6
            continue
          }

          // Separador horizontal
          if (line.startsWith('---')) {
            checkPageBreak(20)
            doc.moveTo(50, yPosition)
              .lineTo(doc.page.width - 50, yPosition)
              .stroke('#cccccc')
            yPosition += 15
            continue
          }

          // Lista (items que empiezan con - o *)
          if (line.startsWith('- ') || line.startsWith('* ')) {
            checkPageBreak(18)
            doc.font('Helvetica')
              .fontSize(fontSize.body)
              .fillColor('#333333')
              .text('• ' + line.substring(2), 60, yPosition, {
                lineGap: 3
              })
            yPosition = doc.y + 5
            continue
          }

          // Línea vacía
          if (line === '') {
            yPosition += 8
            continue
          }

          // Texto normal
          if (line.length > 0) {
            checkPageBreak(20)
            doc.font('Helvetica')
              .fontSize(fontSize.body)
              .fillColor('#333333')
              .text(line, 50, yPosition, {
                lineGap: 4,
                align: 'left'
              })
            yPosition = doc.y + 5
          }
        }

        // Finalizar PDF
        doc.end()

        stream.on('finish', () => {
          console.log(`✅ PDF generated: ${outputPath}`)
          resolve()
        })

        stream.on('error', (err) => {
          reject(err)
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * Consolidar outputs de tareas en entregable final
   */
  /**
   * Pulir un entregable con LLM: limpia caracteres corruptos (emojis de Goose
   * fragmentados en UTF-8 roto — secuencias tipo 'Ø=Þ¨' que los regex no
   * pueden eliminar seguro) y humaniza el tono. REGLA DURA: no alterar
   * hechos, números, ofertas ni CTAs — solo edición, no creación.
   * Fallback: si el LLM falla, devuelve el original sanitizado.
   */
  private async polishDeliverable(content: string, missionTitle: string): Promise<string> {
    try {
      const polished = await litellmService.chatCompletion(
        [
          {
            role: 'system',
            content: `Eres un editor profesional que LIMPIA y HUMANIZA texto generado por IA para entregar a clientes.

TU TRABAJO ES EDITAR, NO CREAR. Reglas:

LIMPIEZA (elimina todo esto):
- Caracteres corruptos o basura UTF-8 (símbolos raros tipo 'Ø=Þ¨', '�', bytes sueltos)
- Output de herramientas internas: comandos bash/python, paths de filesystem (/tmp/, /workspace/), checkboxes de TODO (- [x]), separators de líneas (─────)
- Código ejecutable o bloques \`\`\`bash/\`\`\`python que no sean parte del entregable
- Texto meta sobre el proceso ("Voy a...", "Analizando...", "Plan de ejecución...")

HUMANIZACIÓN (mejora el tono):
- Natural, directo, como lo escribiría una persona real
- MANTÉN EXACTAMENTE los mismos hechos, números, precios, ofertas, placeholders [DATO: ...] y CTAs
- NO añadas información, ofertas ni emojis que no estén
- Conserva el idioma original (español)
- MANTÉN el formato markdown (títulos, negritas, listas)

Responde SOLO con el texto final limpio y pulido.`,
          },
          {
            role: 'user',
            content: `Contexto del proyecto: ${missionTitle}\n\nTexto a pulir:\n\n${content}`,
          },
        ],
        { temperature: 0.3, model: 'glm-5.2' },
      )
      // Validación mínima: el pulido no debe ser mucho más corto (alucinación)
      if (polished && polished.length > content.length * 0.5) {
        return polished.trim()
      }
      console.warn('[consolidate] polish too short, keeping original')
      return content
    } catch (err: any) {
      console.warn(`[consolidate] polish failed (${err.message}), keeping original`)
      return content
    }
  }

  /**
   * Sanitizador determinista de outputs de especialistas.
   *
   * Retro-fix para outputs ya guardados en BD (y red de seguridad para
   * futuros): limpia el ruido de sesión de Goose, repara los bytes basura
   * que el stream multiplexado de Docker deja al inicio de línea (que
   * rompían tablas 'I| fila' y títulos '$## 1.' del markdown) y deduplica
   * secciones que Goose re-emitió tras reintentos.
   */
  private sanitizeSpecialistOutput(content: string): string {
    let text = content
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
      .replace(/\uFFFD/g, '')
      // Placeholder editorial que goteó del prompt al entregable
      .replace(/\[EMOJI FIRMA\]\s*/g, '')

    const isNoise = (l: string) =>
      /^\(no output\)/.test(l) ||
      /^Command exited with code \d+/.test(l) ||
      /[▸▶]/.test(l) ||
      /(search_available|manage_extensions|list_extensions) extensionmanager/.test(l) ||
      /^\S?\s*(action|extension_name):\s/.test(l) ||
      /\bcode:\s*async function/.test(l) ||
      /\breturn \{/.test(l) ||
      /\basync function\b/.test(l) ||
      /encodeURIComponent|AbortSignal|await fetch/.test(l) ||
      /^\s*(const|let)\s+\w+\s*=/.test(l) ||
      /^\s*try \{\s*$/.test(l) ||
      /}\s*catch/.test(l) ||
      /^\s*\{\s*$/.test(l) ||
      /^[\s}]*\}[\s;]*$/.test(l) ||
      /^\S?- \[[x ]\]/.test(l) ||
      /^\[- \[[x ]\]/.test(l) ||
      /^─{10,}/.test(l) ||
      // Chatarra suelta: 1-3 chars de puntuación o letra/dígito aislados
      // (bytes de frames del stream que quedaron solos en una línea)
      (/^[\W_]{1,3}$/.test(l) && !/[—…]/.test(l)) ||
      /^[A-Za-z0-9]{1,2}$/.test(l)

    const repaired = text
      .split('\n')
      .map(raw => {
        let l = raw
          // Prefijo "content:" de tool-use (a veces con byte basura delante:
          // 'O    content: # Título…') — el entregable sigue en la misma línea
          .replace(/^\s*\S?\s{0,4}content:\s*/, '')
        // Byte basura del stream multiplexado pegado a sintaxis markdown
        l = l
          .replace(/^([^\s|])\|/, '|')          // 'I| fila' → '| fila'
          .replace(/^[^\s#](#{1,6} )/, '$1')     // '$## 1.'  → '## 1.'
          .replace(/^([^\s*])\*\*/, '**')        // ',**negrita**' → '**negrita**'
          .replace(/^[A-Za-z](\d+\.\s)/, '$1')   // 'h2. ítem' → '2. ítem'
        return l
      })
      .filter(l => !isNoise(l))

    // Deduplicación por "firma de reinicio": Goose re-emite la misma sección
    // tras reintentos (ej. la ficha completa apareció dos veces). Si una
    // línea ancla (heading o metadata en negrita) se repite en la segunda
    // mitad del documento, todo lo que sigue es el duplicado. Se corta en el
    // MENOR índice de repetición entre todas las anclas — cortar en la
    // primera que dispare dejaría pasar la intro de la copia duplicada.
    const anchorOf = (l: string) => {
      const t = l.trim()
      if (t.length < 15) return null
      if (/^#{1,3}\s/.test(t) || /^\*\*[^*]+\*\*/.test(t)) return t
      return null
    }
    const firstSeen = new Map<string, number>()
    let cutAt = -1
    for (let i = 0; i < repaired.length; i++) {
      const anchor = anchorOf(repaired[i])
      if (!anchor) continue
      const first = firstSeen.get(anchor)
      if (first === undefined) {
        firstSeen.set(anchor, i)
      } else if (first < repaired.length * 0.4 && i > repaired.length * 0.5) {
        if (cutAt === -1 || i < cutAt) cutAt = i
      }
    }
    if (cutAt > 0) repaired.splice(cutAt)

    return repaired.join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  async consolidateMissionOutputs(missionId: string): Promise<string> {
    const missionPath = path.join(this.basePath, 'missions', missionId)
    const tasksPath = path.join(missionPath, 'tasks')
    const outputsPath = path.join(missionPath, 'outputs')
    await mkdirp(outputsPath)

    // First, try to get task outputs from database
    // Excluir mission_analysis: es el plan interno del orquestador (JSON de
    // proceso), no un entregable del cliente — ocupaba un tercio del reporte
    // y enterraba el contenido real al ir primero.
    const tasksFromDb = await Task.find({
      missionId,
      status: 'completed',
      type: { $ne: 'mission_analysis' },
    })
      .select('title type output result description')
      .sort({ createdAt: 1 })

    // Header con el título REAL de la misión (antes: ID crudo) + brief
    const mission = await Mission.findById(missionId).select('title description objective').lean()
    let consolidatedMarkdown = `# ${mission?.title || `Misión ${missionId}`}\n\n`
    if (mission?.objective) {
      consolidatedMarkdown += `**Objetivo:** ${mission.objective}\n\n`
    }
    consolidatedMarkdown += `Generado: ${new Date().toISOString()}\n\n---\n\n`

    // Procesar tareas separadas por rol en el ENTREGABLE:
    //   1. Entregables (content_generation / custom con contenido) — lo que
    //      el cliente pidió, va PRIMERO.
    //   2. Anexos de investigación (web_search / data_analysis) — insumos
    //      internos, van al final como apéndice.
    // Antes el reporte se ordenaba por createdAt: la investigación abría el
    // documento y los entregables quedaban perdidos en el medio ("descarga
    // el proceso de pensamiento y no el entregable" — feedback real).
    const deliverables: Array<{ title: string; content: string }> = []
    const annexes: Array<{ title: string; content: string }> = []

    if (tasksFromDb.length > 0) {
      for (const task of tasksFromDb) {
        const taskTitle = task.title || task.type || 'Unknown Task'

        // Try to get content from output.result or output directly
        let content = ''
        if (task.output?.result) {
          if (typeof task.output.result === 'string') {
            content = task.output.result
          } else if (task.output.result?.result && typeof task.output.result.result === 'string') {
            content = task.output.result.result
          } else {
            content = JSON.stringify(task.output.result, null, 2)
          }
        } else if (task.output) {
          content = typeof task.output === 'string' ? task.output : JSON.stringify(task.output, null, 2)
        }

        if (!content && (task as any).partialOutput) {
          content = (task as any).partialOutput
        }

        // Descartar tareas sin entregable real (ej: revisión vacía de 9 chars)
        if (!content || content.trim().length < 50) continue

        // Sanitizar ruido de sesión de Goose, bytes basura del stream de
        // Docker (tablas/títulos rotos) y secciones duplicadas — ANTES del
        // polish para que el LLM reciba texto limpio
        content = this.sanitizeSpecialistOutput(content)

        // Extraer markdown si viene en code block
        let markdownContent = content
        const mdMatch = content.match(/```(?:markdown)?\s*([\s\S]*?)\s*```/)
        if (mdMatch) {
          markdownContent = mdMatch[1]
        }

        const isResearch = task.type === 'web_search' || task.type === 'data_analysis'
        if (isResearch) {
          annexes.push({ title: taskTitle, content: markdownContent })
        } else {
          // Título de ENTREGABLE, no de tarea: el cliente no lee "Redactar X"
          // — lee "X". (El documento es el producto, no el proceso.)
          const cleanTitle = taskTitle
            .replace(/^(Redactar|Crear|Escribir|Generar|Investigar)\s+/i, '')
            .replace(/\s*\(.*?\)\s*$/, '')
          deliverables.push({ title: cleanTitle, content: markdownContent })
        }
      }
    }

    // Pulir ENTREGABLES con LLM: limpia residuos técnicos (emojis fragmentados)
    // y humaniza el tono. Solo entregables — la investigación queda cruda
    // como insumo. Fallback al original si el polish falla.
    if (deliverables.length > 0) {
      const missionTitle = mission?.title || missionId
      for (const d of deliverables) {
        d.content = await this.polishDeliverable(d.content, missionTitle)
      }
    }

    // Componer: SOLO entregables en el documento. La investigación de
    // soporte NO va al PDF del cliente — es insumo interno (queda accesible
    // en las tareas). Un entregable con anexos de proceso dentro sigue
    // siendo "proceso de pensamiento con formato" (feedback real).
    if (deliverables.length > 0) {
      for (const d of deliverables) {
        consolidatedMarkdown += `## ${d.title}\n\n${d.content}\n\n---\n\n`
      }
    }

    // Nota al pie discreta si hubo investigación de soporte (sin incluirla)
    if (annexes.length > 0) {
      consolidatedMarkdown += `\n*Esta pieza fue producida con apoyo de investigación interna (${annexes.length} estudios de soporte disponibles a pedido).*\n`
    }

    // Also check for physical files in tasks directory (for backwards compatibility)
    let taskDirsFiltered: any[] = []
    try {
      const taskDirs = await fs.readdir(tasksPath, { withFileTypes: true })
      taskDirsFiltered = taskDirs.filter((d: any) => d.isDirectory())
    } catch (error) {
      // Tasks directory doesn't exist yet, create it
      await mkdirp(tasksPath)
      console.log(`📁 Created tasks directory for mission: ${missionId}`)
    }

    // Process physical files (if any exist)
    for (const taskDir of taskDirsFiltered) {
      const taskId = taskDir.name
      const outputPath = path.join(tasksPath, taskId, 'output.md')

      try {
        const content = await fs.readFile(outputPath, 'utf-8')
        consolidatedMarkdown += `## Task: ${taskId}\n\n${content}\n\n---\n\n`
      } catch {
        // No hay output.md, intentar con output.json
        const jsonPath = path.join(tasksPath, taskId, 'output.json')
        try {
          const jsonContent = await fs.readFile(jsonPath, 'utf-8')
          const parsed = JSON.parse(jsonContent)
          consolidatedMarkdown += `## Task: ${taskId}\n\n\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\`\n\n---\n\n`
        } catch {
          // Skip
        }
      }
    }

    // If no content was added at all
    if (tasksFromDb.length === 0 && taskDirsFiltered.length === 0) {
      consolidatedMarkdown += `*No task outputs available yet*\n\n`
    }

    // Guardar markdown consolidado
    const finalMdPath = path.join(outputsPath, 'final_report.md')
    await fs.writeFile(finalMdPath, consolidatedMarkdown)

    // Generar PDF
    const finalPdfPath = path.join(outputsPath, 'final_report.pdf')
    await this.generatePDF(consolidatedMarkdown, finalPdfPath)

    // Get PDF file size and checksum
    const pdfStats = await fs.stat(finalPdfPath)
    const pdfBuffer = await fs.readFile(finalPdfPath)
    const pdfChecksum = crypto.createHash('sha256').update(pdfBuffer).digest('hex')

    // Actualizar metadata - agregar tanto Markdown como PDF
    await this.updateMissionMetadata(missionId, (metadata) => {
      // Remove previous reports if exist
      metadata.outputFiles = metadata.outputFiles.filter(f =>
        !f.originalName.includes('final_report')
      )

      // Add Markdown
      metadata.outputFiles.push({
        id: crypto.randomBytes(16).toString('hex'),
        originalName: 'final_report.md',
        mimeType: 'text/markdown',
        size: consolidatedMarkdown.length,
        path: finalMdPath,
        relativePath: path.join('missions', missionId, 'outputs', 'final_report.md').replace(/\\/g, '/'),
        checksum: crypto.createHash('sha256').update(consolidatedMarkdown).digest('hex'),
        uploadedAt: new Date()
      })

      // Add PDF
      metadata.outputFiles.push({
        id: crypto.randomBytes(16).toString('hex'),
        originalName: 'final_report.pdf',
        mimeType: 'application/pdf',
        size: pdfStats.size,
        path: finalPdfPath,
        relativePath: path.join('missions', missionId, 'outputs', 'final_report.pdf').replace(/\\/g, '/'),
        checksum: pdfChecksum,
        uploadedAt: new Date()
      })
    })

    console.log(`✅ Mission outputs consolidated: ${missionId}`)
    return finalPdfPath
  }

  /**
   * Eliminar todos los archivos de una misión
   */
  async deleteMissionFiles(missionId: string): Promise<void> {
    const missionPath = path.join(this.basePath, 'missions', missionId)

    try {
      await fs.rm(missionPath, { recursive: true, force: true })
      console.log(`✅ Mission files deleted: ${missionId}`)
    } catch (error) {
      console.error(`Error deleting mission files:`, error)
    }
  }

  /**
   * Limpiar archivos temporales (antiguos de 24 horas)
   */
  async cleanupTempFiles(): Promise<void> {
    const tempPath = path.join(this.basePath, 'temp')
    const now = Date.now()
    const maxAge = 24 * 60 * 60 * 1000 // 24 horas

    try {
      const files = await fs.readdir(tempPath, { withFileTypes: true })

      for (const file of files) {
        if (file.isFile()) {
          const filePath = path.join(tempPath, file.name)
          const stats = await fs.stat(filePath)

          if (now - stats.mtimeMs > maxAge) {
            await fs.unlink(filePath)
            console.log(`🗑️ Cleaned up temp file: ${file.name}`)
          }
        }
      }
    } catch (error) {
      console.error('Error cleaning temp files:', error)
    }
  }

  /**
   * Obtener tamaño total de archivos de una misión
   */
  async getMissionSize(missionId: string): Promise<number> {
    const missionPath = path.join(this.basePath, 'missions', missionId)

    async function getDirSize(dirPath: string): Promise<number> {
      let totalSize = 0

      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true })

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name)

          if (entry.isDirectory()) {
            totalSize += await getDirSize(fullPath)
          } else if (entry.isFile()) {
            const stats = await fs.stat(fullPath)
            totalSize += stats.size
          }
        }
      } catch {
        // Directorio no existe o error
      }

      return totalSize
    }

    return await getDirSize(missionPath)
  }
}

export const fileManagementService = new FileManagementService()
