import mongoose, { Schema, Document } from 'mongoose'

/**
 * LLMConfig Model - Virtual keys de LiteLLM por scope
 *
 * Centraliza las virtual keys que HQ usa para hablar con litellm.ctangarife.com.
 * Hoy: 1 key global. Mañana: N keys por workspace (para tracking de costos
 * y budgets aislados por cliente/tenant).
 *
 * La key vive en texto plano porque:
 * - MongoDB está aislado en red Docker interna (no expuesto al host tras el
 *   cambio de Nginx a único puerto de entrada).
 * - La virtual key de HQ es un secreto operacional de la app, no de usuario final.
 * - La key casi no se usa directo: los containers efímeros la reciben por ENV
 *   y mueren en minutos.
 *
 * El campo `scope` es la clave del diseño multi-tenant:
 *   - scope: 'global'      → fallback para tareas sin workspace
 *   - scope: 'workspace'   → key específica de un workspace (con workspaceId)
 *   - futuro: scope: 'user' → key por usuario humano
 */

export type LLMConfigScope = 'global' | 'workspace' | 'project'

export interface LLMConfig {
  _id: string
  scope: LLMConfigScope
  workspaceId?: string // Solo cuando scope !== 'global'
  projectId?: string   // Solo cuando scope === 'project'
  alias: string // Alias legible: "hq-global", "workspace-exito", etc.
  virtualKey: string // sk-... (la key real de LiteLLM)
  keyId?: string // token_id retornado por LiteLLM (para gestión/rotación)
  models: string[] // Modelos permitidos: ['glm-4.7', 'kimi-k2']
  // Metadata de LiteLLM (para info, no control — eso se hace en el proxy)
  maxBudget?: number // USD por ciclo
  budgetDuration?: string // '30d', '1d', etc.
  rpmLimit?: number // Requests por minuto
  active: boolean // Para desactivar sin borrar
  createdAt: Date
  updatedAt: Date
}

const llmConfigSchema = new Schema<LLMConfig & Document>({
  scope: {
    type: String,
    required: true,
    enum: ['global', 'workspace', 'project'],
    default: 'global',
  },
  workspaceId: { type: String, index: true }, // Index para queries por workspace
  projectId: { type: String, index: true },   // Index para queries por proyecto
  alias: { type: String, required: true, trim: true },
  virtualKey: { type: String, required: true },
  keyId: { type: String },
  models: [{ type: String }],
  maxBudget: { type: Number },
  budgetDuration: { type: String },
  rpmLimit: { type: Number },
  active: { type: Boolean, default: true },
}, {
  timestamps: true,
})

// Index para resolver rápido "dame la key de este scope"
// Solo una key activa por (scope, workspaceId)
llmConfigSchema.index({ scope: 1, workspaceId: 1, active: 1 })

export default mongoose.model<LLMConfig & Document>('LLMConfig', llmConfigSchema)
