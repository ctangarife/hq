import mongoose, { Schema, Document } from 'mongoose'

/**
 * Provider Model - LLM Provider Configuration
 * Stores provider credentials and API endpoints
 */

export interface Provider {
  _id: string
  name: string // Display name: "Z.ai (Zhipu AI)", "Anthropic", etc.
  providerId: string // Unique ID: "zai", "anthropic", "openai", etc.
  type: 'openai' | 'anthropic' | 'google' | 'ollama' | 'custom'
  enabled: boolean // Whether this provider is active
  apiKey?: string // API key (encrypted in MongoDB)
  apiEndpoint?: string // Base URL for API calls
  modelsEndpoint?: string // Endpoint to fetch available models
  defaultModel?: string // Default model for this provider

  // Cached models list (updated periodically)
  cachedModels?: Array<{
    id: string
    name: string
    description?: string
    contextLength?: number
  }>
  modelsLastUpdated?: Date

  // Configuration
  config?: {
    maxTokens?: number
    temperature?: number
    timeout?: number
  }

  createdAt: Date
  updatedAt: Date
}

const providerSchema = new Schema<Provider & Document>({
  name: { type: String, required: true },
  providerId: { type: String, required: true, unique: true },
  type: { type: String, required: true, enum: ['openai', 'anthropic', 'google', 'ollama', 'custom'] },
  enabled: { type: Boolean, default: true },
  apiKey: { type: String },
  apiEndpoint: { type: String },
  modelsEndpoint: { type: String },
  defaultModel: { type: String },

  cachedModels: [{
    id: String,
    name: String,
    description: String,
    contextLength: Number
  }],
  modelsLastUpdated: { type: Date },

  config: {
    maxTokens: { type: Number },
    temperature: { type: Number },
    timeout: { type: Number }
  }
}, {
  timestamps: true
})

// Indexes
providerSchema.index({ providerId: 1 })
providerSchema.index({ enabled: 1 })

export default mongoose.model<Provider & Document>('Provider', providerSchema)
