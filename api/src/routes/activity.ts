import { Router } from 'express'
import Activity from '../models/Activity.js'
import { AuthenticatedRequest } from '../middleware/jwt-auth.js'

const router = Router()

// GET /api/activity - List recent activities
// Aislamiento multi-tenant: los usuarios de workspace solo ven los eventos
// de SU workspace. Los eventos sin workspaceId son de sistema (orquestador
// global) y quedan reservados al super_admin.
router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50
    const filter = req.user?.role === 'super_admin'
      ? {}
      : { workspaceId: req.user?.workspaceId }

    const activities = await Activity.find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
    res.json(activities)
  } catch (error) {
    next(error)
  }
})

// GET /api/activity/stream - SSE stream for real-time updates
router.get('/stream', async (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`)

  // TODO: Implement real-time streaming using MongoDB change streams or EventEmitter
  // For now, send heartbeat
  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`)
  }, 30000)

  // Cleanup on client disconnect
  req.on('close', () => {
    clearInterval(heartbeat)
  })
})

// POST /api/activity - Log activity (internal use)
router.post('/', async (req, res, next) => {
  try {
    const activity = new Activity(req.body)
    await activity.save()
    res.status(201).json(activity)
  } catch (error) {
    next(error)
  }
})

export default router
