import express from 'express'
import multer from 'multer'
import { Resource } from '../models/Resource.js'
import { Attachment, AttachmentType } from '../models/Attachment.js'
import { fileManagementService } from '../services/file-management.service.js'
import crypto from 'crypto'

const router = express.Router()

/**
 * Multer config - almacenar en memoria
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/json',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
 * POST /api/attachments/upload
 * Subir archivo y crear Resource + Attachment
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { file } = req
    const { missionId, taskId, type, description, role } = req.body

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    if (!missionId) {
      return res.status(400).json({ error: 'missionId is required' })
    }

    // Validar tipo
    const attachmentType: AttachmentType = type || 'mission_input'
    const validTypes = ['mission_input', 'task_input', 'task_output', 'task_artifact', 'mission_output']
    if (!validTypes.includes(attachmentType)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` })
    }

    // Calcular checksum
    const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex')

    // Guardar archivo en volumen
    const fileInfo = await fileManagementService.saveInputFile(
      missionId,
      file,
      file.originalname,
      file.mimetype
    )

    // Crear Resource
    const resource = await Resource.createResource({
      resourceId: fileInfo.id,
      originalName: file.originalname,
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      checksum,
      filePath: fileInfo.path,
      relativePath: fileInfo.relativePath,
      uploadedBy: req.user?.id || 'system',
      uploadSource: 'user'
    })

    // Obtener el orden siguiente para esta misión/tipo
    const lastAttachment = await Attachment.findOne({
      missionId,
      type: attachmentType
    }).sort({ order: -1 })

    const order = (lastAttachment?.order ?? -1) + 1

    // Crear Attachment
    const attachment = await Attachment.createAttachment({
      resourceId: resource.resourceId,
      missionId,
      taskId: taskId || undefined,
      type: attachmentType,
      description,
      role,
      order
    })

    res.status(201).json({
      message: 'File uploaded and attached successfully',
      attachment: {
        attachmentId: attachment.attachmentId,
        type: attachment.type,
        order: attachment.order
      },
      resource: {
        resourceId: resource.resourceId,
        originalName: resource.originalName,
        mimeType: resource.mimeType,
        size: resource.size
      }
    })
  } catch (error: any) {
    console.error('Error uploading attachment:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/attachments/mission/:missionId
 * Listar attachments de una misión
 */
router.get('/mission/:missionId', async (req, res) => {
  try {
    const { missionId } = req.params
    const { type } = req.query

    let attachments
    if (type) {
      attachments = await Attachment.findMissionAttachments(missionId, type as AttachmentType)
    } else {
      attachments = await Attachment.find({ missionId }).sort({ order: 1, createdAt: 1 })
    }

    // Obtener los recursos asociados
    const resourceIds = attachments.map(a => a.resourceId)
    const resources = await Resource.find({ resourceId: { $in: resourceIds }, status: 'active' })
    const resourceMap = new Map(resources.map(r => [r.resourceId, r]))

    // Combinar datos
    const result = attachments.map(attachment => {
      const resource = resourceMap.get(attachment.resourceId)
      if (!resource) return null

      return {
        attachmentId: attachment.attachmentId,
        type: attachment.type,
        taskId: attachment.taskId,
        description: attachment.description,
        role: attachment.role,
        order: attachment.order,
        createdAt: attachment.createdAt,
        resource: {
          resourceId: resource.resourceId,
          originalName: resource.originalName,
          filename: resource.filename,
          mimeType: resource.mimeType,
          size: resource.size,
          relativePath: resource.relativePath,
          uploadedAt: resource.createdAt
        }
      }
    }).filter(Boolean)

    res.json({ attachments: result })
  } catch (error: any) {
    console.error('Error listing attachments:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/attachments/task/:taskId
 * Listar attachments de una tarea
 */
router.get('/task/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params

    const attachments = await Attachment.findTaskAttachments(taskId)

    // Obtener los recursos asociados
    const resourceIds = attachments.map(a => a.resourceId)
    const resources = await Resource.find({ resourceId: { $in: resourceIds }, status: 'active' })
    const resourceMap = new Map(resources.map(r => [r.resourceId, r]))

    const result = attachments.map(attachment => {
      const resource = resourceMap.get(attachment.resourceId)
      if (!resource) return null

      return {
        attachmentId: attachment.attachmentId,
        type: attachment.type,
        description: attachment.description,
        role: attachment.role,
        order: attachment.order,
        resource: {
          resourceId: resource.resourceId,
          originalName: resource.originalName,
          filename: resource.filename,
          mimeType: resource.mimeType,
          size: resource.size,
          relativePath: resource.relativePath
        }
      }
    }).filter(Boolean)

    res.json({ attachments: result })
  } catch (error: any) {
    console.error('Error listing task attachments:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/attachments/:attachmentId/download
 * Descargar archivo por attachmentId
 */
router.get('/:attachmentId/download', async (req, res) => {
  try {
    const { attachmentId } = req.params

    const attachment = await Attachment.findOne({ attachmentId })
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' })
    }

    const resource = await Resource.findOne({ resourceId: attachment.resourceId, status: 'active' })
    if (!resource) {
      return res.status(404).json({ error: 'Resource not found or deleted' })
    }

    // Leer archivo
    const buffer = await fileManagementService.getInputFile(
      attachment.missionId,
      resource.relativePath.split('/').pop() || resource.filename
    )

    res.setHeader('Content-Type', resource.mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="${resource.originalName}"`)
    res.setHeader('Content-Length', resource.size.toString())
    res.send(buffer)
  } catch (error: any) {
    console.error('Error downloading attachment:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * DELETE /api/attachments/:attachmentId
 * Eliminar attachment (soft delete del recurso)
 */
router.delete('/:attachmentId', async (req, res) => {
  try {
    const { attachmentId } = req.params

    const attachment = await Attachment.findOne({ attachmentId })
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' })
    }

    const resource = await Resource.findOne({ resourceId: attachment.resourceId })
    if (!resource) {
      return res.status(404).json({ error: 'Resource not found' })
    }

    // Soft delete del recurso
    await resource.markAsDeleted()

    // Eliminar attachment
    await Attachment.deleteOne({ attachmentId })

    res.json({ message: 'Attachment deleted successfully' })
  } catch (error: any) {
    console.error('Error deleting attachment:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * PATCH /api/attachments/:attachmentId
 * Actualizar metadata de attachment (descripción, orden, etc.)
 */
router.patch('/:attachmentId', async (req, res) => {
  try {
    const { attachmentId } = req.params
    const { description, role, order } = req.body

    const attachment = await Attachment.findOne({ attachmentId })
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' })
    }

    if (description !== undefined) attachment.description = description
    if (role !== undefined) attachment.role = role
    if (order !== undefined) attachment.order = order

    await attachment.save()

    res.json({
      message: 'Attachment updated successfully',
      attachment: {
        attachmentId: attachment.attachmentId,
        description: attachment.description,
        role: attachment.role,
        order: attachment.order
      }
    })
  } catch (error: any) {
    console.error('Error updating attachment:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/attachments/:attachmentId/reorder
 * Reordenar attachments
 */
router.post('/reorder', async (req, res) => {
  try {
    const { attachmentIds } = req.body // Array de attachmentIds en orden

    if (!Array.isArray(attachmentIds)) {
      return res.status(400).json({ error: 'attachmentIds must be an array' })
    }

    // Actualizar orden de cada attachment
    for (let i = 0; i < attachmentIds.length; i++) {
      await Attachment.updateOne(
        { attachmentId: attachmentIds[i] },
        { order: i }
      )
    }

    res.json({ message: 'Attachments reordered successfully' })
  } catch (error: any) {
    console.error('Error reordering attachments:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router
