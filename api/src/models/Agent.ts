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
  createdAt: Date
  updatedAt: Date
}

const agentSchema = new Schema({
  name: { type: String, required: true, unique: true },
  role: { type: String, required: true },
  personality: { type: String, default: 'You are a helpful AI assistant.' },
  capabilities: [{ type: String }],
  llmModel: { type: String, default: 'glm-4-plus' },  // Renombrado
  provider: { type: String, default: 'zai' },
  apiKey: { type: String },  // API key específica del agente
  containerId: { type: String },
  status: {
    type: String,
    enum: ['idle', 'busy', 'offline', 'active', 'inactive'],
    default: 'inactive'
  }
}, {
  timestamps: true
})

export default mongoose.model<IAgent>('Agent', agentSchema)
