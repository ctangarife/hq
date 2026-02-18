import mongoose, { Schema, Model } from 'mongoose'

/**
 * Attachment Model
 *
 * Vincula un Resource con una Mission o Task.
 * Permite tener contexto sobre cómo se usa un archivo.
 */

export type AttachmentType = 'mission_input' | 'task_input' | 'task_output' | 'task_artifact' | 'mission_output'

export interface IAttachment extends mongoose.Document {
  // Identificación
  attachmentId: string          // ID único (para usar con string IDs)

  // Referencias
  resourceId: string            // ID del recurso (Resource)
  missionId: string             // Misión a la que pertenece
  taskId?: string               // Tarea (opcional, si es específico de una tarea)

  // Tipo de vinculación
  type: AttachmentType

  // Contexto adicional
  description?: string          // Descripción del archivo
  role?: string                 // Rol del archivo (ej: "input_data", "reference", "generated_code")

  // Orden (para mostrar en orden específico)
  order: number

  // Timestamps
  createdAt: Date
  updatedAt: Date
}

const attachmentSchema = new Schema<IAttachment>({
  attachmentId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  resourceId: {
    type: String,
    required: true,
    index: true
  },
  missionId: {
    type: String,
    required: true,
    index: true
  },
  taskId: {
    type: String,
    index: true
  },
  type: {
    type: String,
    enum: ['mission_input', 'task_input', 'task_output', 'task_artifact', 'mission_output'],
    required: true,
    index: true
  },
  description: {
    type: String
  },
  role: {
    type: String
  },
  order: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
})

// Índice compuesto para búsquedas de attachments de misión
attachmentSchema.index({ missionId: 1, type: 1, order: 1 })

// Índice para búsquedas de attachments de tarea
attachmentSchema.index({ taskId: 1, type: 1 })

// Método estático para crear attachment
attachmentSchema.statics.createAttachment = async function(data: {
  resourceId: string
  missionId: string
  taskId?: string
  type: AttachmentType
  description?: string
  role?: string
  order?: number
}): Promise<IAttachment> {
  const Attachment = this as Model<IAttachment>

  // Generar attachmentId único
  const attachmentId = `att-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`

  const attachment = new Attachment({
    attachmentId,
    ...data
  })

  return await attachment.save()
}

// Método estático para obtener attachments de misión con population de resource
attachmentSchema.statics.findMissionAttachments = async function(
  missionId: string,
  type?: AttachmentType
): Promise<IAttachment[]> {
  const Attachment = this as Model<IAttachment>

  const query: any = { missionId }
  if (type) query.type = type

  return await Attachment.find(query).sort({ order: 1, createdAt: 1 })
}

// Método estático para obtener attachments de tarea
attachmentSchema.statics.findTaskAttachments = async function(
  taskId: string
): Promise<IAttachment[]> {
  const Attachment = this as Model<IAttachment>

  return await Attachment.find({ taskId }).sort({ order: 1, createdAt: 1 })
}

export const Attachment = mongoose.model<IAttachment>('Attachment', attachmentSchema)
