import { Router } from 'express'
import Provider from '../models/Provider.js'
import {
  getProviderModels,
  refreshAllProviderModels,
  getEnabledProviders,
  upsertProvider,
  deleteProvider
} from '../services/provider-models.service.js'

const router = Router()

// GET /api/providers - List all providers
router.get('/', async (req, res, next) => {
  try {
    const providers = await Provider.find().sort({ name: 1 })
    res.json(providers.map(p => ({
      id: p._id,
      providerId: p.providerId,
      name: p.name,
      type: p.type,
      enabled: p.enabled,
      apiEndpoint: p.apiEndpoint,
      defaultModel: p.defaultModel,
      modelsCount: p.cachedModels?.length || 0,
      modelsLastUpdated: p.modelsLastUpdated
    })))
  } catch (error) {
    next(error)
  }
})

// GET /api/providers/enabled - Get only enabled providers
router.get('/enabled', async (req, res, next) => {
  try {
    const providers = await getEnabledProviders()
    res.json(providers)
  } catch (error) {
    next(error)
  }
})

// POST /api/providers - Create or update a provider
router.post('/', async (req, res, next) => {
  try {
    const provider = await upsertProvider(req.body)
    res.status(201).json(provider)
  } catch (error) {
    next(error)
  }
})

// PUT /api/providers/:providerId - Update a provider
router.put('/:providerId', async (req, res, next) => {
  try {
    const provider = await Provider.findOneAndUpdate(
      { providerId: req.params.providerId },
      { $set: req.body },
      { new: true, runValidators: true }
    )
    if (!provider) {
      return res.status(404).json({ error: 'Provider not found' })
    }
    res.json(provider)
  } catch (error) {
    next(error)
  }
})

// DELETE /api/providers/:providerId - Delete a provider
router.delete('/:providerId', async (req, res, next) => {
  try {
    const deleted = await deleteProvider(req.params.providerId)
    if (!deleted) {
      return res.status(404).json({ error: 'Provider not found' })
    }
    res.status(204).send()
  } catch (error) {
    next(error)
  }
})

// GET /api/providers/:providerId/models - Get models for a provider
router.get('/:providerId/models', async (req, res, next) => {
  try {
    const { refresh } = req.query
    const forceRefresh = refresh === 'true'
    const models = await getProviderModels(req.params.providerId, forceRefresh)
    res.json({ providerId: req.params.providerId, models })
  } catch (error) {
    next(error)
  }
})

// POST /api/providers/refresh-all - Refresh all providers' models
router.post('/refresh-all', async (req, res, next) => {
  try {
    const results = await refreshAllProviderModels()
    res.json({
      message: 'All provider models refreshed',
      providers: Object.keys(results).map(providerId => ({
        providerId,
        modelsCount: results[providerId].length
      }))
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/providers/:providerId/toggle - Enable/disable a provider
router.post('/:providerId/toggle', async (req, res, next) => {
  try {
    const { enabled, apiKey } = req.body

    // Prepare update object
    const update: any = { enabled: enabled !== false }
    if (apiKey) {
      update.apiKey = apiKey
    }

    const provider = await Provider.findOneAndUpdate(
      { providerId: req.params.providerId },
      { $set: update },
      { new: true }
    )

    if (!provider) {
      return res.status(404).json({ error: 'Provider not found' })
    }

    // If enabling and apiKey was provided, fetch models automatically
    if (enabled && apiKey) {
      try {
        const { getProviderModels } = await import('../services/provider-models.service.js')
        const models = await getProviderModels(req.params.providerId, true)
        res.json({
          ...provider.toObject(),
          modelsFetched: true,
          modelsCount: models.length
        })
      } catch (fetchError) {
        console.error('Failed to fetch models:', fetchError)
        res.json({
          ...provider.toObject(),
          modelsFetched: false,
          error: 'Provider enabled but failed to fetch models'
        })
      }
    } else {
      res.json(provider)
    }
  } catch (error) {
    next(error)
  }
})

export default router
