import { Router } from 'express'
import { promptService } from '../services/prompt.service.js'

const router = Router()

/**
 * Prompt Routes - Gestión de prompts editables
 *
 * Resolución por capas: project → workspace → global.
 * Cada capa puede refinar el prompt sin tocar las superiores.
 *
 * Endpoints:
 *   GET    /api/prompts                 Listar (con filtros ?key, ?scope, ?workspaceId, ?projectId)
 *   GET    /api/prompts/resolve/:key    Resolver un prompt por capas (con variables reemplazadas)
 *   POST   /api/prompts                 Crear o actualizar (upsert)
 *   DELETE /api/prompts/:id             Desactivar (soft delete)
 */

// Listar prompts con filtros opcionales
router.get('/', async (req, res, next) => {
  try {
    const { key, scope, workspaceId, projectId } = req.query
    const prompts = await promptService.listPrompts({
      key: key as string,
      scope: scope as string,
      workspaceId: workspaceId as string,
      projectId: projectId as string,
    })
    res.json(prompts)
  } catch (e) { next(e) }
})

// Resolver un prompt por capas (devuelve el content con variables reemplazadas)
// GET /api/prompts/resolve/:key?workspaceId=...&projectId=...&agentName=...
router.get('/resolve/:key', async (req, res, next) => {
  try {
    const { key } = req.params
    // Todos los query params que no sean de paginación se pasan como variables
    const { workspaceId, projectId, ...variables } = req.query
    const content = await promptService.getPrompt(key, {
      workspaceId: workspaceId as string,
      projectId: projectId as string,
      ...variables,
    })
    res.json({ key, content })
  } catch (e) { next(e) }
})

// Crear o actualizar (upsert)
router.post('/', async (req, res, next) => {
  try {
    const { key, scope, workspaceId, projectId, name, description, content, variables, category, updatedBy } = req.body
    if (!key || !scope || !name || !content) {
      return res.status(400).json({ error: 'key, scope, name, content are required' })
    }
    if (scope === 'workspace' && !workspaceId) {
      return res.status(400).json({ error: 'workspaceId required when scope=workspace' })
    }
    if (scope === 'project' && (!workspaceId || !projectId)) {
      return res.status(400).json({ error: 'workspaceId and projectId required when scope=project' })
    }
    const prompt = await promptService.upsertPrompt({
      key, scope, workspaceId, projectId, name, description, content, variables, category, updatedBy,
    })
    res.status(201).json(prompt)
  } catch (e) { next(e) }
})

// Desactivar (soft delete)
router.delete('/:id', async (req, res, next) => {
  try {
    const prompt = await promptService.deactivatePrompt(req.params.id)
    if (!prompt) return res.status(404).json({ error: 'Prompt not found' })
    res.json({ message: 'Prompt deactivated' })
  } catch (e) { next(e) }
})

export default router
