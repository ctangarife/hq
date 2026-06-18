import mongoose, { Schema, Document } from 'mongoose'

/**
 * Project Model - Contenedor intermedio (campaña/trabajo concreto)
 *
 * Jerarquía multi-tenant de HQ:
 *   Workspace → Project → Mission
 *
 * Un proyecto agrupa misiones relacionadas dentro de un workspace.
 * Permite refinar a nivel más fino:
 *   - Prompts específicos del proyecto (sobreescriben defaults del workspace/global)
 *   - Budget propio de LiteLLM (para trackear costos por campaña)
 *   - Agents dedicados al proyecto
 *
 * Ejemplo:
 *   Workspace: "Agencia Éxito"
 *     Project: "Campaña Café Q3" → 5 missions, su prompt de copywriter
 *     Project: "Verificación Fake News" → 3 missions, su prompt de fact-checker
 */

export type ProjectStatus = 'active' | 'paused' | 'archived' | 'completed'

export interface Project {
  _id: string
  name: string                    // "Campaña Café Q3"
  slug: string                    // "campana-cafe-q3" (único dentro del workspace)
  description?: string
  workspaceId: string             // ← pertenece a un workspace (requerido)
  status: ProjectStatus
  llmConfigId?: string            // Budget propio del proyecto (ref LLMConfig._id)
  avatarStyle?: string            // DiceBear style (override del workspace)
  // Stats agregadas (cacheadas, recalculadas periódicamente)
  stats?: {
    missionCount: number
    completedMissions: number
    totalSpend: number            // USD consumido en LiteLLM
    lastActivityAt?: Date
  }
  active: boolean
  createdAt: Date
  updatedAt: Date
}

const projectSchema = new Schema<Project & Document>({
  name: { type: String, required: true, trim: true },
  slug: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    match: [/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens'],
  },
  description: { type: String, trim: true },
  workspaceId: {
    type: Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true,
  },
  status: {
    type: String,
    required: true,
    enum: ['active', 'paused', 'archived', 'completed'],
    default: 'active',
  },
  llmConfigId: { type: Schema.Types.ObjectId, ref: 'LLMConfig' },
  avatarStyle: { type: String },
  stats: {
    missionCount: { type: Number, default: 0 },
    completedMissions: { type: Number, default: 0 },
    totalSpend: { type: Number, default: 0 },
    lastActivityAt: { type: Date },
  },
  active: { type: Boolean, default: true },
}, {
  timestamps: true,
})

// Slug único dentro de cada workspace (no globalmente)
projectSchema.index({ workspaceId: 1, slug: 1 }, { unique: true })
projectSchema.index({ workspaceId: 1, status: 1 })

export default mongoose.model<Project & Document>('Project', projectSchema)
