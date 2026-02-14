import mongoose, { Schema, Document } from 'mongoose'
import { encrypt, decrypt } from '../lib/encrypt.js'

// Schema para credenciales de API keys (encriptadas)
const credentialSchema = new Schema({
  provider: { type: String, required: true },
  name: { type: String, required: true },
  tokenEncrypted: { type: String, required: true },
  enabled: { type: Boolean, default: true },
  metadata: { type: Schema.Types.Mixed, default: {} }
}, {
  timestamps: true,
  collection: 'api_credentials'
})

export interface ICredential extends Document {
  provider: string
  name: string
  tokenEncrypted: string
  enabled: boolean
  metadata: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

export const Credential = mongoose.models.Credential || mongoose.model<ICredential>('Credential', credentialSchema)
