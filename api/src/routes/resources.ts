import express from 'express'
import multer from 'multer'
import path from 'path'
import { fileManagementService } from '../services/file-management.service.js'

const router = express.Router()

/**
 * Multer config - almacenar en memoria (luego el servicio lo guarda en el volumen)
 */
const storage = multer.memoryStorage()

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
  fileFilter: (req, file, cb) => {
    // Tipos permitidos
    const allowedTypes = [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/json',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
      'text/javascript',
      'application/javascript',
      'text/typescript',
      'application/x-typescript',
      'text/x-python',
      'text/x-java-source',
      'text/x-c',
      'text/x-c++',
      'text/html',
      'text/css',
      'application/xml',
      'text/xml',
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp'
    ]

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`))
    }
  }
})

/**
 * POST /api/resources/mission/:missionId/upload
 * Subir archivo a la carpeta inputs de una misión
 */
router.post('/mission/:missionId/upload', upload.single('file'), async (req, res) => {
  try {
    const { missionId } = req.params
    const file = req.file

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    // Crear estructura de misión si no existe
    const metadata = await fileManagementService.getMissionMetadata(missionId)
    if (!metadata) {
      await fileManagementService.createMissionStructure(missionId, `Mission ${missionId}`)
    }

    // Guardar archivo
    const fileInfo = await fileManagementService.saveInputFile(
      missionId,
      file,
      file.originalname,
      file.mimetype
    )

    res.json({
      message: 'File uploaded successfully',
      file: fileInfo
    })
  } catch (error: any) {
    console.error('Error uploading file:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/resources/mission/:missionId/upload-url
 * Guardar una URL como recurso
 */
router.post('/mission/:missionId/upload-url', async (req, res) => {
  try {
    const { missionId } = req.params
    const { url, title } = req.body

    if (!url) {
      return res.status(400).json({ error: 'URL is required' })
    }

    // Crear estructura de misión si no existe
    const metadata = await fileManagementService.getMissionMetadata(missionId)
    if (!metadata) {
      await fileManagementService.createMissionStructure(missionId, `Mission ${missionId}`)
    }

    // Guardar como "archivo" con tipo URL
    // TODO: En siguiente fase implementar fetch del contenido
    res.json({
      message: 'URL saved (content fetch not implemented yet)',
      url,
      title: title || url
    })
  } catch (error: any) {
    console.error('Error saving URL:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/resources/mission/:missionId/files
 * Listar archivos de una misión
 */
router.get('/mission/:missionId/files', async (req, res) => {
  try {
    const { missionId } = req.params
    const metadata = await fileManagementService.getMissionMetadata(missionId)

    if (!metadata) {
      return res.status(404).json({ error: 'Mission not found' })
    }

    res.json({
      inputFiles: metadata.inputFiles,
      outputFiles: metadata.outputFiles,
      totalSize: metadata.totalSize
    })
  } catch (error: any) {
    console.error('Error listing files:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/resources/mission/:missionId/download/:filename
 * Descargar archivo de inputs
 */
router.get('/mission/:missionId/download/:filename', async (req, res) => {
  try {
    const { missionId, filename } = req.params

    // Leer metadata para verificar que el archivo existe
    const metadata = await fileManagementService.getMissionMetadata(missionId)
    if (!metadata) {
      return res.status(404).json({ error: 'Mission not found' })
    }

    const fileInfo = metadata.inputFiles.find(f => f.originalName === filename || f.id === filename)
    if (!fileInfo) {
      return res.status(404).json({ error: 'File not found' })
    }

    // Leer archivo
    const buffer = await fileManagementService.getInputFile(missionId, path.basename(fileInfo.path))

    res.setHeader('Content-Type', fileInfo.mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="${fileInfo.originalName}"`)
    res.setHeader('Content-Length', fileInfo.size.toString())
    res.send(buffer)
  } catch (error: any) {
    console.error('Error downloading file:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/resources/mission/:missionId/outputs/download
 * Descargar entregable final (PDF o Markdown)
 */
router.get('/mission/:missionId/outputs/download', async (req, res) => {
  try {
    const { missionId } = req.params
    const { format = 'md' } = req.query

    const metadata = await fileManagementService.getMissionMetadata(missionId)
    if (!metadata) {
      return res.status(404).json({ error: 'Mission not found' })
    }

    const outputFile = metadata.outputFiles.find(f =>
      format === 'pdf' ? f.originalName.endsWith('.pdf') : f.originalName.endsWith('.md')
    )

    if (!outputFile) {
      return res.status(404).json({ error: 'Output not found. Generate it first.' })
    }

    const buffer = await fileManagementService.getInputFile(
      missionId,
      path.join('outputs', path.basename(outputFile.path)).replace(/\\/g, '/')
    )

    res.setHeader('Content-Type', outputFile.mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="${outputFile.originalName}"`)
    res.setHeader('Content-Length', outputFile.size.toString())
    res.send(buffer)
  } catch (error: any) {
    console.error('Error downloading output:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/resources/mission/:missionId/consolidate
 * Consolidar outputs de tareas en entregable final
 */
router.post('/mission/:missionId/consolidate', async (req, res) => {
  try {
    const { missionId } = req.params

    const outputPath = await fileManagementService.consolidateMissionOutputs(missionId)

    res.json({
      message: 'Mission outputs consolidated successfully',
      outputPath
    })
  } catch (error: any) {
    console.error('Error consolidating outputs:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/resources/mission/:missionId/size
 * Obtener tamaño total de archivos de una misión
 */
router.get('/mission/:missionId/size', async (req, res) => {
  try {
    const { missionId } = req.params
    const size = await fileManagementService.getMissionSize(missionId)

    res.json({
      missionId,
      sizeBytes: size,
      sizeMB: (size / (1024 * 1024)).toFixed(2)
    })
  } catch (error: any) {
    console.error('Error getting mission size:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * DELETE /api/resources/mission/:missionId
 * Eliminar todos los archivos de una misión
 */
router.delete('/mission/:missionId', async (req, res) => {
  try {
    const { missionId } = req.params
    await fileManagementService.deleteMissionFiles(missionId)

    res.json({ message: 'Mission files deleted successfully' })
  } catch (error: any) {
    console.error('Error deleting mission files:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/resources/task/:taskId/output
 * Obtener output de una tarea
 */
router.get('/task/:taskId/output', async (req, res) => {
  try {
    const { taskId } = req.params
    const { missionId } = req.query

    if (!missionId) {
      return res.status(400).json({ error: 'missionId query parameter is required' })
    }

    const output = await fileManagementService.getTaskOutput(taskId, missionId as string)

    if (!output) {
      return res.status(404).json({ error: 'Task output not found' })
    }

    res.json(output)
  } catch (error: any) {
    console.error('Error getting task output:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/resources/task/:taskId/stream
 * Streaming de output parcial (SSE)
 */
router.get('/task/:taskId/stream', async (req, res) => {
  try {
    const { taskId } = req.params
    const { missionId } = req.query

    if (!missionId) {
      return res.status(400).json({ error: 'missionId query parameter is required' })
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    // Enviar heartbeat cada 5 segundos
    const heartbeatInterval = setInterval(() => {
      res.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`)
    }, 5000)

    // Verificar si la tarea está completada
    // TODO: Consultar a Task model para saber el estado
    // Por ahora enviamos el partial output si existe

    const partialOutput = await fileManagementService.getPartialOutput(
      taskId,
      missionId as string
    )

    if (partialOutput) {
      res.write(`data: ${JSON.stringify({ type: 'progress', data: partialOutput })}\n\n`)
    }

    // Si hay output final, enviarlo y cerrar
    const finalOutput = await fileManagementService.getTaskOutput(
      taskId,
      missionId as string
    )

    if (finalOutput) {
      clearInterval(heartbeatInterval)
      res.write(`data: ${JSON.stringify({ type: 'done', output: finalOutput })}\n\n`)
      res.end()
    }

    // Si no hay output final, mantener conexión abierta
    req.on('close', () => {
      clearInterval(heartbeatInterval)
    })
  } catch (error: any) {
    console.error('Error streaming output:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router
