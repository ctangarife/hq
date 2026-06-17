import { Router } from 'express'
import litellmService from '../services/litellm.service.js'
import LLMConfig from '../models/LLMConfig.js'

const router = Router()

/**
 * LLM Config Routes - Gestión de virtual keys de LiteLLM
 *
 * Endpoints admin para crear/listar/rotar las virtual keys que HQ usa
 * para hablar con el proxy LiteLLM centralizado.
 *
 * HOY: solo se maneja la key global.
 * MAÑANA: cuando existan workspaces, se podrá crear una key por workspace
 *         pasando scope: 'workspace' + workspaceId.
 */

// GET /api/llm-config - Listar todas las configs (sin exponer la key completa)
router.get('/', async (req, res, next) => {
  try {
    const configs = await litellmService.listConfigs()
    res.json(configs)
  } catch (error) {
    next(error)
  }
})

// GET /api/llm-config/models - Modelos disponibles en el proxy
router.get('/models', async (req, res, next) => {
  try {
    // Usa la key global para descubrir modelos
    const key = await litellmService.getKey()
    const models = await litellmService.getAvailableModels(key)
    res.json({ models })
  } catch (error) {
    next(error)
  }
})

// POST /api/llm-config - Crear nueva virtual key en LiteLLM + guardar en Mongo
//
// Body:
//   { alias: "hq-global", scope: "global" }
//   { alias: "workspace-exito", scope: "workspace", workspaceId: "xxx", maxBudget: 100 }
router.post('/', async (req, res, next) => {
  try {
    const { alias, scope, workspaceId, maxBudget, budgetDuration, rpmLimit, models } = req.body

    if (!alias || !scope) {
      return res.status(400).json({ error: 'alias and scope are required' })
    }
    if (scope === 'workspace' && !workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required when scope is "workspace"' })
    }
    if (!['global', 'workspace'].includes(scope)) {
      return res.status(400).json({ error: 'scope must be "global" or "workspace"' })
    }

    // Si es global, desactivar cualquier global previa (solo una activa)
    if (scope === 'global') {
      await LLMConfig.updateMany(
        { scope: 'global' },
        { active: false },
      )
    }

    const result = await litellmService.createVirtualKey({
      alias,
      scope,
      workspaceId: scope === 'workspace' ? workspaceId : undefined,
      maxBudget,
      budgetDuration,
      rpmLimit,
      models,
    })

    res.status(201).json({
      configId: result.configId,
      keyId: result.keyId,
      keyPreview: `${result.key.substring(0, 8)}...${result.key.slice(-4)}`,
      message: 'Virtual key created and stored in MongoDB',
    })
  } catch (error) {
    next(error)
  }
})

// PATCH /api/llm-config/:id/active - Activar/desactivar una key (rotación segura)
router.patch('/:id/active', async (req, res, next) => {
  try {
    const { active } = req.body
    if (typeof active !== 'boolean') {
      return res.status(400).json({ error: 'active (boolean) is required in body' })
    }

    const config = await litellmService.setActive(req.params.id, active)
    if (!config) {
      return res.status(404).json({ error: 'Config not found' })
    }

    res.json({
      _id: config._id,
      alias: config.alias,
      scope: config.scope,
      active: config.active,
    })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/llm-config/:id - Borrar config de Mongo (NO borra la key en LiteLLM)
//
// Para revocar la key en el proxy también, hacerlo desde la UI de LiteLLM o
// vía DELETE /key/delete con la master key.
router.delete('/:id', async (req, res, next) => {
  try {
    const config = await LLMConfig.findByIdAndDelete(req.params.id)
    if (!config) {
      return res.status(404).json({ error: 'Config not found' })
    }
    res.json({ message: 'Config deleted from MongoDB (key still exists in LiteLLM)' })
  } catch (error) {
    next(error)
  }
})

export default router
