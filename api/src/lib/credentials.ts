import mongoose, { Schema } from 'mongoose'

// Schema para credenciales de API keys (encriptadas - simples)
const credentialSchema = new Schema({
  provider: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  tokenEncrypted: { type: String, required: true },
  enabled: { type: Boolean, default: true },
  metadata: { type: Schema.Types.Mixed, default: {} }
}, {
  timestamps: true
})

export interface CredentialWithToken {
  provider: string
  name: string
  token: string
  enabled: boolean
  metadata: Record<string, any>
}

const Credential = mongoose.models.Credential || mongoose.model('Credential', credentialSchema)

// Función simple para obtener credenciales (sin desencriptar por ahora)
export async function getCredential(provider: string): Promise<CredentialWithToken | null> {
  // Retornar credenciales desde MongoDB
  const credential = await Credential.findOne({ provider, enabled: true })

  if (!credential) return null

  // Retornar credencial con token en texto plano por ahora
  // TODO: Implementar encriptación/desencriptación cuando sea necesario
  return {
    provider: credential.provider,
    name: credential.name,
    token: credential.tokenEncrypted || '',
    enabled: credential.enabled,
    metadata: credential.metadata
  }
}

export { Credential }
