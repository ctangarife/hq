import mongoose, { Schema, Model } from 'mongoose'

/**
 * Resource Model
 *
 * Representa un archivo almacenado en el sistema de archivos.
 * No almacena el contenido binario, solo metadatos y referencia al path.
 */

export interface IResource extends mongoose.Document {
  // Identificación
  resourceId: string            // ID único (para usar con string IDs)
  originalName: string          // Nombre original del archivo
  filename: string              // Nombre en el sistema de archivos
  mimeType: string              // Tipo MIME

  // Metadatos de archivo
  size: number                  // Tamaño en bytes
  checksum: string              // SHA-256 del contenido

  // Ubicación
  filePath: string              // Ruta completa dentro del volumen
  relativePath: string          // Ruta relativa para descargas

  // Contexto
  uploadedBy?: string           // Usuario que lo subió (opcional)
  uploadSource: 'user' | 'agent' | 'system'  // Quién lo subió

  // Estado
  status: 'active' | 'deleted' | 'quarantined'

  // Timestamps
  createdAt: Date
  updatedAt: Date
}

const resourceSchema = new Schema<IResource>({
  resourceId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  originalName: {
    type: String,
    required: true
  },
  filename: {
    type: String,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  checksum: {
    type: String,
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  relativePath: {
    type: String,
    required: true
  },
  uploadedBy: {
    type: String,
    index: true
  },
  uploadSource: {
    type: String,
    enum: ['user', 'agent', 'system'],
    default: 'user'
  },
  status: {
    type: String,
    enum: ['active', 'deleted', 'quarantined'],
    default: 'active',
    index: true
  }
}, {
  timestamps: true,
  // Optimización: índice compuesto para búsquedas comunes
  index: {
    resourceId: 1,
    status: 1
  }
})

// Índice para búsquedas por usuario
resourceSchema.index({ uploadedBy: 1, status: 1, createdAt: -1 })

// Índice para búsquedas de mimetype
resourceSchema.index({ mimeType: 1, status: 1 })

// Método estático para crear un nuevo recurso
resourceSchema.statics.createResource = async function(data: {
  originalName: string
  filename: string
  mimeType: string
  size: number
  checksum: string
  filePath: string
  relativePath: string
  uploadedBy?: string
  uploadSource?: 'user' | 'agent' | 'system'
}): Promise<IResource> {
  const Resource = this as Model<IResource>

  // Generar resourceId único
  const resourceId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`

  const resource = new Resource({
    resourceId,
    ...data
  })

  return await resource.save()
}

// Método para marcar como eliminado (soft delete)
resourceSchema.methods.markAsDeleted = async function(): Promise<IResource> {
  this.status = 'deleted'
  return await this.save()
}

// Método de instancia para verificar si es activo
resourceSchema.methods.isActive = function(): boolean {
  return this.status === 'active'
}

export const Resource = mongoose.model<IResource>('Resource', resourceSchema)
