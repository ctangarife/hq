import { Router } from 'express'
import {
  getAvailableProviders,
  getProviderModels,
  getModelInfo
} from '../config/provider-models.js'

const router = Router()

// GET /api/models/providers - List all available providers
router.get('/providers', (req, res) => {
  const providers = getAvailableProviders()
  res.json(providers.map(p => ({
    id: p.providerId,
    name: p.providerName,
    modelCount: p.models.length
  })))
})

// GET /api/models/providers/:providerId - Get models for a specific provider
router.get('/providers/:providerId/models', (req, res) => {
  const { providerId } = req.params
  const models = getProviderModels(providerId)

  if (models.length === 0) {
    return res.status(404).json({ error: 'Provider not found or no models available' })
  }

  res.json({
    providerId,
    models: models.map(m => ({
      id: m.id,
      name: m.name,
      description: m.description,
      contextLength: m.contextLength,
      capabilities: m.capabilities,
      costLevel: m.costLevel
    }))
  })
})

// GET /api/models/:providerId/:modelId - Get specific model info
router.get('/:providerId/:modelId', (req, res) => {
  const { providerId, modelId } = req.params
  const model = getModelInfo(providerId, modelId)

  if (!model) {
    return res.status(404).json({ error: 'Model not found' })
  }

  res.json(model)
})

export default router
