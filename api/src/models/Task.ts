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

export interface ITask extends Document {
  missionId: string
  title: string
  description: string
  type: TaskType
  assignedTo?: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  dependencies: string[]
  priority: 'high' | 'medium' | 'low'
  input?: Record<string, any>
  output?: Record<string, any>
  error?: string
  startedAt?: Date
  completedAt?: Date
  createdAt: Date
  updatedAt: Date
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
      'coordination'
    ],
    default: 'custom'
  },
  assignedTo: { type: String },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'failed'],
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
  completedAt: { type: Date }
}, {
  timestamps: true
})

taskSchema.index({ missionId: 1, status: 1 })
taskSchema.index({ assignedTo: 1, status: 1 })
taskSchema.index({ type: 1, status: 1 })

export default mongoose.model<ITask>('Task', taskSchema)
