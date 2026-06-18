import mongoose, { Schema, Document } from 'mongoose'

/**
 * Workspace Model - Contenedor de nivel superior (cliente/agencia)
 *
 * Jerarquía multi-tenant de HQ:
 *   Workspace → Project → Mission
 *
 * Un workspace agrupa proyectos de un mismo cliente o unidad de negocio.
 * Permite aislar:
 *   - Agents (asignados al workspace)
 *   - Prompts (defaults del workspace, refinables por proyecto)
 *   - Budgets de LiteLLM (virtual key propia por workspace)
 *
 * Miembros: usuarios humanos con acceso al workspace y sus proyectos.
 */

export type WorkspaceRole = 'owner' | 'manager' | 'member' | 'viewer'

export interface WorkspaceMember {
  userId: string
  email?: string
  role: WorkspaceRole
  addedAt: Date
}

export interface Workspace {
  _id: string
  name: string                    // "Agencia Éxito", "Freelance"
  slug: string                    // "agencia-exito" (URL-friendly, único)
  description?: string
  ownerId: string                 // Creator del workspace
  members: WorkspaceMember[]
  llmConfigId?: string            // Virtual key propia (ref LLMConfig._id)
  avatarStyle?: string            // DiceBear style para los avatars del workspace
  active: boolean
  createdAt: Date
  updatedAt: Date
}

const memberSchema = new Schema<WorkspaceMember>({
  userId: { type: String, required: true },
  email: { type: String },
  role: {
    type: String,
    required: true,
    enum: ['owner', 'manager', 'member', 'viewer'],
    default: 'member',
  },
  addedAt: { type: Date, default: Date.now },
}, { _id: false })

const workspaceSchema = new Schema<Workspace & Document>({
  name: { type: String, required: true, trim: true },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens'],
  },
  description: { type: String, trim: true },
  ownerId: { type: String, required: true },
  members: { type: [memberSchema], default: [] },
  llmConfigId: { type: Schema.Types.ObjectId, ref: 'LLMConfig' },
  avatarStyle: { type: String, default: 'avataaars' },
  active: { type: Boolean, default: true },
}, {
  timestamps: true,
})

export default mongoose.model<Workspace & Document>('Workspace', workspaceSchema)
