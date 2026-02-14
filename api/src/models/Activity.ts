import mongoose, { Schema, Document } from 'mongoose'

export interface IActivity extends Document {
  type: 'mission' | 'task' | 'agent' | 'container'
  message: string
  details?: Record<string, any>
  timestamp: Date
}

const activitySchema = new Schema<IActivity>({
  type: {
    type: String,
    enum: ['mission', 'task', 'agent', 'container'],
    required: true
  },
  message: { type: String, required: true },
  details: { type: Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now }
})

// TTL index: activities expire after 30 days
activitySchema.index({ timestamp: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 })

export default mongoose.model<IActivity>('Activity', activitySchema)
