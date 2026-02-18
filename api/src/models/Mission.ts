import mongoose, { Schema, Document } from 'mongoose'

export type MissionType = 'AUTO_ORCHESTRATED' | 'TEMPLATE_BASED' | 'MANUAL'

export interface IMission extends Document {
  title: string
  description: string
  objective: string
  status: 'draft' | 'active' | 'paused' | 'completed'
  priority: 'high' | 'medium' | 'low'
  squadIds: mongoose.Types.ObjectId[]
  taskIds: mongoose.Types.ObjectId[]
  startedAt?: Date
  completedAt?: Date
  // Orchestration fields for Squad Lead flow
  squadLeadId?: string
  autoOrchestrate: boolean
  missionType?: MissionType
  templateId?: string
  // Enhanced mission context for better Squad Lead planning
  context?: string           // Background: company, project, situation
  audience?: string          // Who will consume the output
  deliverableFormat?: string // Expected output format (PDF, code, report, etc.)
  successCriteria?: string   // What defines mission completion
  constraints?: string       // Limitations: time, budget, technical
  tone?: string             // Communication style (formal, casual, technical)
  initialAnalysisTaskId?: string
  orchestrationLog: Array<{
    timestamp: Date
    action: string
    details: Record<string, any>
  }>
  // Human input flow - ID of task waiting for human response
  awaitingHumanTaskId?: string
  createdAt: Date
  updatedAt: Date
}

const missionSchema = new Schema<IMission>({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  objective: { type: String, required: true },
  status: {
    type: String,
    enum: ['draft', 'active', 'paused', 'completed'],
    default: 'draft'
  },
  priority: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium'
  },
  squadIds: [{ type: Schema.Types.ObjectId, ref: 'Agent' }],
  taskIds: [{ type: Schema.Types.ObjectId, ref: 'Task' }],
  startedAt: { type: Date },
  completedAt: { type: Date },
  // Orchestration fields for Squad Lead flow
  squadLeadId: { type: String },
  autoOrchestrate: { type: Boolean, default: false },
  missionType: {
    type: String,
    enum: ['AUTO_ORCHESTRATED', 'TEMPLATE_BASED', 'MANUAL'],
    default: 'AUTO_ORCHESTRATED'
  },
  templateId: { type: String },
  // Enhanced mission context for better Squad Lead planning
  context: { type: String },
  audience: { type: String },
  deliverableFormat: { type: String },
  successCriteria: { type: String },
  constraints: { type: String },
  tone: { type: String },
  initialAnalysisTaskId: { type: String },
  orchestrationLog: [{
    timestamp: { type: Date, default: Date.now },
    action: { type: String, required: true },
    details: { type: Schema.Types.Mixed, default: {} }
  }],
  // Human input flow - ID of task waiting for human response
  awaitingHumanTaskId: { type: String }
}, {
  timestamps: true
})

// Index for orchestration queries
missionSchema.index({ squadLeadId: 1, status: 1 })

export default mongoose.model<IMission>('Mission', missionSchema)
