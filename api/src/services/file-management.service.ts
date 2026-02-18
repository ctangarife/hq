import fs from 'fs/promises'
import path from 'path'
import { createReadStream, createWriteStream, readFileSync } from 'fs'
import crypto from 'crypto'
import { mkdirp } from 'mkdirp'
import PDFDocument from 'pdfkit'
import { marked } from 'marked'

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

    const content = await fs.readFile(metadataPath, 'utf-8')
    const metadata: MissionMetadata = JSON.parse(content)

    updater(metadata)

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

        for (const rawLine of lines) {
          const line = rawLine.trimEnd()

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
  async consolidateMissionOutputs(missionId: string): Promise<string> {
    const missionPath = path.join(this.basePath, 'missions', missionId)
    const tasksPath = path.join(missionPath, 'tasks')
    const outputsPath = path.join(missionPath, 'outputs')
    await mkdirp(outputsPath)

    // Leer todas las tareas
    const taskDirs = await fs.readdir(tasksPath, { withFileTypes: true })
    const taskDirsFiltered = taskDirs.filter(d => d.isDirectory())

    let consolidatedMarkdown = `# Mission Report: ${missionId}\n\n`
    consolidatedMarkdown += `Generated: ${new Date().toISOString()}\n\n`
    consolidatedMarkdown += `---\n\n`

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
          consolidatedMarkdown += `## Task: ${taskId}\n\n*No output available*\n\n---\n\n`
        }
      }
    }

    // Guardar markdown consolidado
    const finalMdPath = path.join(outputsPath, 'final_report.md')
    await fs.writeFile(finalMdPath, consolidatedMarkdown)

    // Generar PDF (placeholder por ahora)
    const finalPdfPath = path.join(outputsPath, 'final_report.pdf')
    await this.generatePDF(consolidatedMarkdown, finalPdfPath)

    // Actualizar metadata
    await this.updateMissionMetadata(missionId, (metadata) => {
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
    })

    console.log(`✅ Mission outputs consolidated: ${missionId}`)
    return finalMdPath
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
