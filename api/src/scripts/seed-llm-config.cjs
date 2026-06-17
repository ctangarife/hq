/**
 * Seed inicial: guarda la virtual key global de HQ en MongoDB.
 *
 * Uso (dentro del container hq-api):
 *   node /app/src/scripts/seed-llm-config.cjs
 *
 * Lee la key de LITELLM_VIRTUAL_KEY (env var) o de un argumento.
 * Si ya existe una key global activa, NO la sobreescribe (idempotente).
 */
const mongoose = require('mongoose')

const MONGO_URI = process.env.MONGO_URI ||
  `mongodb://${process.env.MONGODB_USERNAME || 'root'}:${process.env.MONGODB_PASSWORD || ''}@${process.env.MONGODB_HOST || 'mongodb'}:${process.env.MONGODB_PORT || '27017'}/${process.env.MONGODB_DATABASE || 'hq'}?authSource=admin`

// Schema inline (el script corre standalone, sin compilar TS)
const llmConfigSchema = new mongoose.Schema({
  scope: { type: String, required: true, enum: ['global', 'workspace'], default: 'global' },
  workspaceId: { type: String, index: true },
  alias: { type: String, required: true, trim: true },
  virtualKey: { type: String, required: true },
  keyId: { type: String },
  models: [{ type: String }],
  maxBudget: { type: Number },
  budgetDuration: { type: String },
  rpmLimit: { type: Number },
  active: { type: Boolean, default: true },
}, { timestamps: true })
llmConfigSchema.index({ scope: 1, workspaceId: 1, active: 1 })

const LLMConfig = mongoose.model('LLMConfig', llmConfigSchema)

async function seed() {
  const virtualKey = process.argv[2] || process.env.LITELLM_VIRTUAL_KEY
  if (!virtualKey) {
    console.error('❌ No virtual key provided.')
    console.error('   Usage: node seed-llm-config.cjs <virtual-key>')
    console.error('   Or set LITELLM_VIRTUAL_KEY env var.')
    process.exit(1)
  }

  console.log('🔌 Connecting to MongoDB...')
  await mongoose.connect(MONGO_URI)

  // Idempotente: si ya existe una global activa, salir
  const existing = await LLMConfig.findOne({ scope: 'global', active: true })
  if (existing) {
    console.log(`✅ Global key already exists (alias: "${existing.alias}"). Nothing to seed.`)
    console.log(`   To replace: deactivate it first via PATCH /api/llm-config/:id/active`)
    await mongoose.disconnect()
    return
  }

  const config = await LLMConfig.create({
    scope: 'global',
    alias: 'hq-global',
    virtualKey,
    models: ['glm-4.7', 'kimi-k2'],
    maxBudget: 50.0,
    budgetDuration: '30d',
    rpmLimit: 100,
    active: true,
  })

  console.log(`✅ Seeded global LiteLLM config:`)
  console.log(`   _id:        ${config._id}`)
  console.log(`   alias:      ${config.alias}`)
  console.log(`   keyPreview: ${virtualKey.substring(0, 8)}...${virtualKey.slice(-4)}`)
  console.log(`   models:     ${config.models.join(', ')}`)
  console.log(`   budget:     $${config.maxBudget}/${config.budgetDuration}`)

  await mongoose.disconnect()
}

seed().catch(err => {
  console.error('❌ Seed failed:', err.message)
  process.exit(1)
})
