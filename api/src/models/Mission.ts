import mongoose, { Schema, Document } from 'mongoose'

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
  completedAt: { type: Date }
}, {
  timestamps: true
})

export default mongoose.model<IMission>('Mission', missionSchema)
