import mongoose, { Schema, Document } from 'mongoose'

export interface IAgent extends Document {
  name: string
  role: string
  personality: string
  capabilities: string[]
  llmModel: string
  provider: string
  apiKey?: string
  containerId?: string
  status: 'idle' | 'busy' | 'offline' | 'active' | 'inactive'
  // Orchestration fields
  currentMissionId?: string
  missionHistory: string[]
  totalMissionsCompleted: number
  lastMissionCompletedAt?: Date
  isReusable: boolean
  // Phase 9: Agent Metrics fields
  tasksCompleted: number        // Total tasks completed successfully
  tasksFailed: number           // Total tasks that failed
  successRate: number           // Percentage (0-100)
  totalDuration: number         // Accumulated duration in ms
  averageDuration: number       // Average task duration in ms
  lastTaskCompletedAt?: Date    // Timestamp of last completed task
  createdAt: Date
  updatedAt: Date
}

const agentSchema = new Schema({
  name: { type: String, required: true, unique: true },
  role: { type: String, required: true },
  personality: { type: String, default: 'You are a helpful AI assistant.' },
  capabilities: [{ type: String }],
  llmModel: { type: String, default: 'glm-4.7' },
  provider: { type: String, default: 'zai' },
  apiKey: { type: String },
  containerId: { type: String },
  status: {
    type: String,
    enum: ['idle', 'busy', 'offline', 'active', 'inactive'],
    default: 'inactive'
  },
  // Orchestration fields for Squad Lead flow
  currentMissionId: { type: String },
  missionHistory: [{ type: String }],
  totalMissionsCompleted: { type: Number, default: 0 },
  lastMissionCompletedAt: { type: Date },
  isReusable: { type: Boolean, default: true },
  // Phase 9: Agent Metrics
  tasksCompleted: { type: Number, default: 0 },
  tasksFailed: { type: Number, default: 0 },
  successRate: { type: Number, default: 100 },
  totalDuration: { type: Number, default: 0 },
  averageDuration: { type: Number, default: 0 },
  lastTaskCompletedAt: { type: Date }
}, {
  timestamps: true
})

// Indexes for orchestration queries
agentSchema.index({ currentMissionId: 1, status: 1 })
agentSchema.index({ role: 1, status: 1 })
agentSchema.index({ isReusable: 1 })

export default mongoose.model<IAgent>('Agent', agentSchema)
