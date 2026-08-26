import mongoose, { Schema, Document } from 'mongoose'

/**
 * Prompt Model - Prompts editables con resolución por capas
 *
 * Reemplaza los prompts hardcoded que estaban en:
 *   - agent-templates.ts (personality por rol)
 *   - hq-polling-skill.cjs (system prompts por tipo de tarea)
 *
 * Jerarquía de resolución (cascada con fallback):
 *   1. Project   → prompt específico de un proyecto
 *   2. Workspace → prompt específico de un workspace
 *   3. Global    → default del sistema
 *
 * El PromptService.getPrompt(key, {workspaceId, projectId}) devuelve el más
 * específico que exista. Esto permite que un workspace manager refine el
 * prompt de un agente sin tocar el default global.
 *
 * Variables: placeholders {{agentName}}, {{missionTitle}}, etc. que el
 * PromptService rellena con el contexto de cada invocación.
 */

export type PromptScope = 'global' | 'workspace' | 'project'

// Claves de prompt conocidas (rol de agente o tipo de tarea)
export const PROMPT_KEYS = [
  // Por rol de agente
  'squad_lead',
  'researcher',
  'developer',
  'designer',
  'writer',
  'analyst',
  'auditor',
  'reviewer',
  // Por tipo de tarea
  'mission_analysis',
  'auditor_review',
  'web_search',
  'content_generation',
  'image_prompt',
  'data_analysis',
  'code_execution',
] as const

export type PromptKey = typeof PROMPT_KEYS[number]

export interface Prompt {
  _id: string
  key: PromptKey                    // 'squad_lead', 'mission_analysis', etc.
  scope: PromptScope                // 'global' | 'workspace' | 'project'
  workspaceId?: string              // requerido si scope !== 'global'
  projectId?: string                // requerido si scope === 'project'
  name: string                      // legible: "Squad Lead - Default"
  description?: string              // qué hace este prompt, cuándo se usa
  content: string                   // el prompt real (con {{variables}})
  variables: string[]               // lista de placeholders: ['agentName', 'missionTitle']
  category: 'role' | 'task'         // agrupación para la UI
  active: boolean                   // desactivar sin borrar
  version: number                   // incrementa en cada update (historial)
  updatedBy?: string                // userId del último editor
  createdAt: Date
  updatedAt: Date
}

const promptSchema = new Schema<Prompt & Document>({
  key: {
    type: String,
    required: true,
    enum: PROMPT_KEYS,
    index: true,
  },
  scope: {
    type: String,
    required: true,
    enum: ['global', 'workspace', 'project'],
    default: 'global',
  },
  workspaceId: {
    type: Schema.Types.ObjectId,
    ref: 'Workspace',
    index: true,
  },
  projectId: {
    type: Schema.Types.ObjectId,
    ref: 'Project',
    index: true,
  },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  content: { type: String, required: true },
  variables: [{ type: String }],
  category: {
    type: String,
    required: true,
    enum: ['role', 'task'],
    default: 'role',
  },
  active: { type: Boolean, default: true },
  version: { type: Number, default: 1 },
  updatedBy: { type: String },
}, {
  timestamps: true,
})

// Index para resolución rápida: una sola query resuelve la cascada.
// Solo un prompt activo por (key, scope, workspaceId, projectId).
promptSchema.index(
  { key: 1, scope: 1, workspaceId: 1, projectId: 1, active: 1 },
  { unique: true, partialFilterExpression: { active: true } },
)

export default mongoose.model<Prompt & Document>('Prompt', promptSchema)
