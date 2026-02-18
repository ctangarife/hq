import mongoose, { Schema, Document } from 'mongoose'

export type TaskType =
  | 'web_search'
  | 'data_analysis'
  | 'content_generation'
  | 'code_execution'
  | 'custom'
  | 'mission_analysis'   // Squad Lead analyzes mission
  | 'agent_creation'     // Create specialized agent
  | 'coordination'       // Squad Lead coordinates agents
  | 'human_input'        // Requires human response
  | 'auditor_review'     // Auditor analyzes failed task

export interface ITask extends Document {
  missionId: string
  title: string
  description: string
  type: TaskType
  assignedTo?: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'awaiting_human_response'
  dependencies: string[]
  priority: 'high' | 'medium' | 'low'
  input?: Record<string, any>
  output?: Record<string, any>
  error?: string
  startedAt?: Date
  completedAt?: Date
  createdAt: Date
  updatedAt: Date
  // For human_input tasks - user response when ready
  userId?: string  // ID of the user assigned (not an agent)
  // For awaiting_human_response - link to human task
  humanTaskId?: string
  // Retry system (Phase 7)
  retryCount?: number           // Número de intentos actuales
  maxRetries?: number          // Máximo de reintentos (default: 3)
  retryHistory?: RetryAttempt[]  // Historial de reintentos
  auditorReviewId?: string     // ID de tarea de auditoría asociada
}

export interface RetryAttempt {
  attempt: number              // Número de intento (1, 2, 3...)
  error: string                // Error message
  timestamp: Date              // Cuándo ocurrió
  agentId?: string             // Agente que intentó (si aplica)
}

const taskSchema = new Schema<ITask>({
  missionId: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  type: {
    type: String,
    enum: [
      'web_search',
      'data_analysis',
      'content_generation',
      'code_execution',
      'custom',
      'mission_analysis',
      'agent_creation',
      'coordination',
      'human_input',
      'auditor_review'
    ],
    default: 'custom'
  },
  assignedTo: { type: String },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'failed', 'awaiting_human_response'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium'
  },
  dependencies: [{ type: String }],
  input: { type: Schema.Types.Mixed },
  output: { type: Schema.Types.Mixed },
  error: { type: String },
  startedAt: { type: Date },
  completedAt: { type: Date },
  userId: { type: String },  // For human_input tasks
  humanTaskId: { type: String },  // For awaiting_human_response
  // Retry system (Phase 7)
  retryCount: { type: Number, default: 0 },
  maxRetries: { type: Number, default: 3 },
  retryHistory: [{
    attempt: { type: Number, required: true },
    error: { type: String, required: true },
    timestamp: { type: Date, required: true },
    agentId: { type: String }
  }],
  auditorReviewId: { type: String }  // ID de tarea de auditoría asociada
}, {
  timestamps: true
})

taskSchema.index({ missionId: 1, status: 1 })
taskSchema.index({ assignedTo: 1, status: 1 })
taskSchema.index({ type: 1, status: 1 })
// Índice para tareas que necesitan auditoría (han fallado y alcanzaron maxRetries)
taskSchema.index({ status: 1, retryCount: 1, maxRetries: 1 })

// Método para verificar si necesita reintento
taskSchema.methods.needsRetry = function(): boolean {
  const task = this as any
  return task.status === 'failed' &&
         task.retryCount < task.maxRetries &&
         !task.auditorReviewId
}

// Método para registrar un intento fallido
taskSchema.methods.recordRetry = function(error: string, agentId?: string) {
  const task = this as any
  task.retryCount = (task.retryCount || 0) + 1
  task.retryHistory = task.retryHistory || []
  task.retryHistory.push({
    attempt: task.retryCount,
    error,
    timestamp: new Date(),
    agentId
  })
  return task.save()
}

// Método para marcar que necesita auditoría
taskSchema.methods.requestAudit = function(auditorTaskId: string) {
  const task = this as any
  task.auditorReviewId = auditorTaskId
  task.status = 'pending'  // Resetear a pending para que el auditor pueda procesarla
  return task.save()
}

export default mongoose.model<ITask>('Task', taskSchema)
