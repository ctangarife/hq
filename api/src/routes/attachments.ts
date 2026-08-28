import express from 'express'
import multer from 'multer'
import { Resource } from '../models/Resource.js'
import { Attachment, AttachmentType } from '../models/Attachment.js'
import Mission from '../models/Mission.js'
import Task from '../models/Task.js'
import { AuthenticatedRequest } from '../middleware/jwt-auth.js'
import { fileManagementService } from '../services/file-management.service.js'
import crypto from 'crypto'

const router = express.Router()

/**
 * Multer config - almacenar en memoria
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    // Límite uniforme: 3 MB para imágenes y documentos (multer corta el
    // stream temprano; el handler da el mensaje amigable)
    fileSize: 3 * 1024 * 1024,
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
 * Aislamiento multi-tenant: verificar que la misión pertenece al workspace
 * del usuario. Sin esto, cualquier usuario autenticado podía subir/leer
 * adjuntos de misiones ajenas (IDOR cross-tenant).
 * Responde la request y devuelve false si el acceso está denegado.
 */
async function checkMissionAccess(
  req: AuthenticatedRequest,
  res: any,
  missionId: string,
): Promise<boolean> {
  const user = (req as any).user
  if (!user || user.role === 'super_admin') return true

  const mission = await Mission.findById(missionId).select('workspaceId').lean()
  if (!mission) {
    res.status(404).json({ error: 'Mission not found' })
    return false
  }
  if (!mission.workspaceId || mission.workspaceId.toString() !== user.workspaceId) {
    res.status(403).json({ error: 'No tiene acceso a esta misión' })
    return false
  }
  return true
}


/**
 * Verificación de contenido real (magic bytes) contra el MIME declarado.
 * El Content-Type del cliente es spoofable; esto evita que un binario
 * malicioso se haga pasar por texto/imagen para colarse en los prompts.
 */
function contentMatchesMime(buf: Buffer, mime: string): boolean {
  const sig = (bytes: number[], offset = 0) =>
    bytes.every((b, i) => buf[offset + i] === b)
  switch (mime) {
    case 'application/pdf':
      return sig([0x25, 0x50, 0x44, 0x46]) // %PDF
    case 'image/png':
      return sig([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/jpeg':
      return sig([0xff, 0xd8, 0xff])
    case 'image/gif':
      return sig([0x47, 0x49, 0x46, 0x38]) // GIF8
    case 'image/webp':
      return sig([0x52, 0x49, 0x46, 0x46]) && sig([0x57, 0x45, 0x42, 0x50], 8) // RIFF…WEBP
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return sig([0x50, 0x4b, 0x03, 0x04]) // PK (zip: xlsx)
    default:
      // Tipos de texto (txt, md, csv, json, xml, código…) no tienen firma:
      // validar que no sea binario puro (alta densidad de NULs/control)
      if (mime.startsWith('text/') || /json|xml|javascript|typescript|python|java|csv/.test(mime)) {
        const sample = buf.subarray(0, Math.min(buf.length, 4096))
        let binary = 0
        for (const byte of sample) {
          if (byte === 0 || (byte < 0x09 && byte !== 0x00) || (byte > 0x0d && byte < 0x20)) binary++
        }
        return binary / sample.length < 0.1
      }
      return true // tipo no catalogado: no bloquear (futuros tipos válidos)
  }
}

// Límites de almacenamiento (anti disk-fill)
const MAX_ATTACHMENTS_PER_MISSION = parseInt(process.env.MAX_ATTACHMENTS_PER_MISSION || '5', 10)
const MAX_MISSION_BYTES = 30 * 1024 * 1024      // 30 MB por misión
const MAX_WORKSPACE_BYTES = 200 * 1024 * 1024   // 200 MB por workspace

async function missionAttachmentsBytes(missionId: string): Promise<number> {
  const atts = await Attachment.find({ missionId }).select('resourceId').lean()
  if (atts.length === 0) return 0
  const resources = await Resource.find({
    resourceId: { $in: atts.map(a => a.resourceId) }, status: 'active',
  }).select('size')
  return resources.reduce((sum, r) => sum + (r.size || 0), 0)
}

/**
 * Wrapper de multer: traduce sus errores a mensajes amigables en español
 * (multer corta el stream al superar el límite — el error nunca llega al
 * handler de la ruta).
 */
const uploadFriendly = (req: any, res: any, next: any) => {
  upload.single('file')(req, res, (err: any) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'El archivo supera el límite de 3 MB. Reduzca la resolución o comprímalo antes de subirlo.'
      })
    }
    if (err) {
      return res.status(400).json({ error: err.message })
    }
    next()
  })
}

/**
 * POST /api/attachments/upload
 * Subir archivo y crear Resource + Attachment
 */
router.post('/upload', uploadFriendly, async (req, res) => {
  try {
    const { file } = req
    const { missionId, taskId, type, description, role } = req.body

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    if (!missionId) {
      return res.status(400).json({ error: 'missionId is required' })
    }

    // Aislamiento: la misión destino debe ser del workspace del usuario
    if (!(await checkMissionAccess(req as AuthenticatedRequest, res, missionId))) return

    // Límite de peso: 3 MB para imágenes y documentos
    const MAX_FILE_MB = 3
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      return res.status(400).json({
        error: `El archivo supera el límite de ${MAX_FILE_MB} MB (pesa ${(file.size / 1024 / 1024).toFixed(1)} MB). Reduzca la resolución o comprímalo antes de subirlo.`
      })
    }

    // Verificación de contenido real vs MIME declarado (anti-spoofing)
    if (!contentMatchesMime(file.buffer, file.mimetype)) {
      return res.status(400).json({
        error: `El contenido del archivo no corresponde al tipo declarado (${file.mimetype}). Conviértalo o renómbrelo correctamente.`
      })
    }

    // Límites de almacenamiento (anti disk-fill)
    const count = await Attachment.countDocuments({ missionId, type: 'mission_input' })
    if (count >= MAX_ATTACHMENTS_PER_MISSION) {
      return res.status(400).json({
        error: `Límite de ${MAX_ATTACHMENTS_PER_MISSION} archivos por misión alcanzado`
      })
    }
    const missionBytes = await missionAttachmentsBytes(missionId)
    if (missionBytes + file.size > MAX_MISSION_BYTES) {
      return res.status(400).json({ error: 'Límite de 30 MB de adjuntos por misión alcanzado' })
    }
    const userWs = (req as any).user?.workspaceId
    if (userWs) {
      const wsMissions = await Mission.find({ workspaceId: userWs }).select('_id').lean()
      let wsBytes = missionBytes // cuenta la misión actual (si ya pertenece al ws)
      for (const m of wsMissions) {
        const mid = m._id.toString()
        if (mid !== missionId) wsBytes += await missionAttachmentsBytes(mid)
      }
      if (wsBytes + file.size > MAX_WORKSPACE_BYTES) {
        return res.status(400).json({ error: 'Límite de 200 MB de almacenamiento del workspace alcanzado' })
      }
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
router.get('/mission/:missionId', async (req: AuthenticatedRequest, res) => {
  try {
    const missionId = String(req.params.missionId)
    const { type } = req.query

    if (!(await checkMissionAccess(req, res, missionId))) return

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
router.get('/task/:taskId', async (req: AuthenticatedRequest, res) => {
  try {
    const { taskId } = req.params

    // Aislamiento: resolver la misión de la tarea y verificar el workspace
    const task = await Task.findById(taskId).select('missionId').lean()
    if (task && !(await checkMissionAccess(req, res, String(task.missionId)))) return

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
router.get('/:attachmentId/download', async (req: AuthenticatedRequest, res) => {
  try {
    const { attachmentId } = req.params

    const attachment = await Attachment.findOne({ attachmentId })
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' })
    }

    // Aislamiento: el adjunto pertenece a una misión del workspace del usuario
    if (!(await checkMissionAccess(req, res, String(attachment.missionId)))) return

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
router.delete('/:attachmentId', async (req: AuthenticatedRequest, res) => {
  try {
    const { attachmentId } = req.params

    const attachment = await Attachment.findOne({ attachmentId })
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' })
    }

    // Aislamiento: solo se eliminan adjuntos de misiones del propio workspace
    if (!(await checkMissionAccess(req, res, String(attachment.missionId)))) return

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
