import { Router } from 'express'
import { workspaceService } from '../services/workspace.service.js'
import { WorkspaceRole } from '../models/Workspace.js'

const router = Router()

/**
 * Workspace Routes - Gestión de workspaces y sus proyectos
 *
 * Jerarquía: Workspace → Project → Mission
 *
 * Endpoints:
 *   GET    /api/workspaces
 *   POST   /api/workspaces
 *   GET    /api/workspaces/:id
 *   PATCH  /api/workspaces/:id
 *   DELETE /api/workspaces/:id
 *
 *   GET    /api/workspaces/:id/projects
 *   POST   /api/workspaces/:id/projects
 *
 *   POST   /api/workspaces/:id/members
 *   DELETE /api/workspaces/:id/members/:userId
 *   PATCH  /api/workspaces/:id/members/:userId
 */

router.get('/', async (req, res, next) => {
  try {
    const workspaces = await workspaceService.listWorkspaces()
    res.json(workspaces)
  } catch (e) { next(e) }
})

router.post('/', async (req, res, next) => {
  try {
    const { name, slug, description, ownerId, avatarStyle } = req.body
    if (!name || !slug || !ownerId) {
      return res.status(400).json({ error: 'name, slug, ownerId are required' })
    }
    const ws = await workspaceService.createWorkspace({ name, slug, description, ownerId, avatarStyle })
    res.status(201).json(ws)
  } catch (e: any) {
    if (e.code === 11000) return res.status(409).json({ error: 'slug already exists' })
    next(e)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const ws = await workspaceService.getWorkspace(req.params.id)
    if (!ws) return res.status(404).json({ error: 'Workspace not found' })
    res.json(ws)
  } catch (e) { next(e) }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const ws = await workspaceService.updateWorkspace(req.params.id, req.body)
    if (!ws) return res.status(404).json({ error: 'Workspace not found' })
    res.json(ws)
  } catch (e) { next(e) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await workspaceService.deleteWorkspace(req.params.id)
    res.json(result)
  } catch (e) { next(e) }
})

// =====================================================================
// Proyectos dentro de un workspace
// =====================================================================

router.get('/:id/projects', async (req, res, next) => {
  try {
    const projects = await workspaceService.listProjects(req.params.id)
    res.json(projects)
  } catch (e) { next(e) }
})

router.post('/:id/projects', async (req, res, next) => {
  try {
    const { name, slug, description, llmConfigId, avatarStyle } = req.body
    if (!name || !slug) {
      return res.status(400).json({ error: 'name, slug are required' })
    }
    const project = await workspaceService.createProject(req.params.id, {
      name, slug, description, llmConfigId, avatarStyle,
    })
    res.status(201).json(project)
  } catch (e: any) {
    if (e.code === 11000) return res.status(409).json({ error: 'slug already exists in this workspace' })
    next(e)
  }
})

// =====================================================================
// Miembros del workspace
// =====================================================================

router.post('/:id/members', async (req, res, next) => {
  try {
    const { userId, email, role } = req.body
    if (!userId || !role) {
      return res.status(400).json({ error: 'userId, role are required' })
    }
    const ws = await workspaceService.addMember(req.params.id, { userId, email, role: role as WorkspaceRole })
    res.json(ws)
  } catch (e) { next(e) }
})

router.delete('/:id/members/:userId', async (req, res, next) => {
  try {
    const ws = await workspaceService.removeMember(req.params.id, req.params.userId)
    res.json(ws)
  } catch (e) { next(e) }
})

router.patch('/:id/members/:userId', async (req, res, next) => {
  try {
    const { role } = req.body
    const ws = await workspaceService.updateMemberRole(req.params.id, req.params.userId, role)
    res.json(ws)
  } catch (e) { next(e) }
})

export default router
