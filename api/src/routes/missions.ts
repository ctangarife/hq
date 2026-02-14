import { Router, Response, NextFunction } from 'express'
import Mission from '../models/Mission.js'
import Task from '../models/Task.js'

const router = Router()

// GET /api/missions - List all missions
router.get('/', async (req, res, next) => {
  try {
    const { status, assignedTo } = req.query

    const filter: any = {}
    if (status) filter.status = status
    if (assignedTo) filter.squadIds = assignedTo

    const missions = await Mission.find(filter)
      .populate('squadIds', 'name role status')
      .sort({ createdAt: -1 })

    res.json(missions)
  } catch (error) {
    next(error)
  }
})

// GET /api/missions/:id - Get mission by ID
router.get('/:id', async (req, res, next) => {
  try {
    const mission = await Mission.findById(req.params.id)
      .populate('squadIds', 'name role status')
      .populate('taskIds')

    if (!mission) {
      return res.status(404).json({ error: 'Mission not found' })
    }
    res.json(mission)
  } catch (error) {
    next(error)
  }
})

// POST /api/missions - Create mission
router.post('/', async (req, res, next) => {
  try {
    const { title, description, objective, priority, squadIds } = req.body

    const mission = new Mission({
      title,
      description,
      objective,
      priority: priority || 'medium',
      squadIds: squadIds || [],
      status: 'draft',
      taskIds: []
    })

    const saved = await mission.save()
    res.status(201).json(saved)
  } catch (error) {
    next(error)
  }
})

// PUT /api/missions/:id - Update mission
router.put('/:id', async (req, res, next) => {
  try {
    const mission = await Mission.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    )

    if (!mission) {
      return res.status(404).json({ error: 'Mission not found' })
    }
    res.json(mission)
  } catch (error) {
    next(error)
  }
})

// POST /api/missions/:id/start - Start mission
router.post('/:id/start', async (req, res, next) => {
  try {
    const mission = await Mission.findById(req.params.id)

    if (!mission) {
      return res.status(404).json({ error: 'Mission not found' })
    }

    if (mission.status !== 'draft' && mission.status !== 'paused') {
      return res.status(400).json({ error: 'Mission can only be started from draft or paused status' })
    }

    mission.status = 'active'
    mission.startedAt = new Date()
    await mission.save()

    res.json({ message: 'Mission started', mission })
  } catch (error) {
    next(error)
  }
})

// POST /api/missions/:id/pause - Pause mission
router.post('/:id/pause', async (req, res, next) => {
  try {
    const mission = await Mission.findByIdAndUpdate(
      req.params.id,
      { status: 'paused' },
      { new: true }
    )

    if (!mission) {
      return res.status(404).json({ error: 'Mission not found' })
    }

    res.json({ message: 'Mission paused', mission })
  } catch (error) {
    next(error)
  }
})

// POST /api/missions/:id/complete - Complete mission
router.post('/:id/complete', async (req, res, next) => {
  try {
    const mission = await Mission.findByIdAndUpdate(
      req.params.id,
      {
        status: 'completed',
        completedAt: new Date()
      },
      { new: true }
    )

    if (!mission) {
      return res.status(404).json({ error: 'Mission not found' })
    }

    res.json({ message: 'Mission completed', mission })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/missions/:id - Delete mission
router.delete('/:id', async (req, res, next) => {
  try {
    const mission = await Mission.findByIdAndDelete(req.params.id)

    if (!mission) {
      return res.status(404).json({ error: 'Mission not found' })
    }

    // Also delete all associated tasks
    await Task.deleteMany({ missionId: req.params.id })

    res.status(204).send()
  } catch (error) {
    next(error)
  }
})

export default router
