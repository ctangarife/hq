import { Router } from 'express'
import Task from '../models/Task.js'
import Mission from '../models/Mission.js'
import Agent from '../models/Agent.js'
import {
  processSquadLeadOutput,
  checkMissionCompletion
} from '../services/orchestration.service.js'

const router = Router()

// Helper para enriquecer tareas con información de misión y agente
async function enrichTasks(tasks: any[]) {
  if (tasks.length === 0) return []

  // Obtener IDs únicos de misiones y agentes
  const missionIds = [...new Set(tasks.map(t => t.missionId).filter(Boolean))]
  const agentContainerIds = [...new Set(tasks.map(t => t.assignedTo).filter(Boolean))]

  // Buscar misiones - filtrar solo IDs válidos (24 caracteres hex)
  const validMissionIds = missionIds.filter(id => /^[0-9a-f]{24}$/.test(id))
  let missionMap = new Map()

  if (validMissionIds.length > 0) {
    try {
      const missions = await Mission.find({ _id: { $in: validMissionIds } }).lean()
      missionMap = new Map(missions.map(m => [m._id.toString(), m]))
    } catch (e) {
      console.error('Error fetching missions:', e.message)
    }
  }

  // Buscar agentes por containerId
  let agentMap = new Map()
  if (agentContainerIds.length > 0) {
    try {
      const agents = await Agent.find({ containerId: { $in: agentContainerIds } }).lean()
      agentMap = new Map(agents.map(a => [a.containerId, a.name || a.containerId]))
    } catch (e) {
      console.error('Error fetching agents:', e.message)
    }
  }

  // Enriquecer cada tarea
  return tasks.map(task => {
    const taskObj = task.toObject ? task.toObject() : task

    // Añadir información de la misión
    if (task.missionId) {
      const mission = missionMap.get(task.missionId)
      taskObj.missionTitle = mission?.title || task.missionId
    }

    // Añadir nombre del agente
    if (task.assignedTo) {
      const agentName = agentMap.get(task.assignedTo)
      if (agentName) {
        taskObj.agentName = agentName
      }
    }

    return taskObj
  })
}

// GET /api/tasks - List all tasks
router.get('/', async (req, res, next) => {
  try {
    const { missionId, status, assignedTo } = req.query

    const filter: any = {}
    if (missionId) filter.missionId = missionId
    if (status) filter.status = status
    if (assignedTo) filter.assignedTo = assignedTo

    const tasks = await Task.find(filter)
      .sort({ createdAt: -1 })

    const enrichedTasks = await enrichTasks(tasks)
    res.json(enrichedTasks)
  } catch (error) {
    next(error)
  }
})

// GET /api/tasks/:id - Get task by ID
router.get('/:id', async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id)
    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    // Enriquecer con información de la misión
    const enriched = await enrichTasks([task])
    res.json(enriched[0])
  } catch (error) {
    next(error)
  }
})

// POST /api/tasks - Create task
router.post('/', async (req, res, next) => {
  try {
    const task = new Task(req.body)
    await task.save()
    res.status(201).json(task)
  } catch (error) {
    next(error)
  }
})

// PUT /api/tasks/:id - Update task
router.put('/:id', async (req, res, next) => {
  try {
    const task = await Task.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    )
    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    // If task is completed, set completedAt
    if (req.body.status === 'completed' && !task.completedAt) {
      task.completedAt = new Date()
      await task.save()
    }

    res.json(task)
  } catch (error) {
    next(error)
  }
})

// DELETE /api/tasks/:id - Delete task
router.delete('/:id', async (req, res, next) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id)
    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }
    res.status(204).send()
  } catch (error) {
    next(error)
  }
})

// GET /api/tasks/agent/:agentId/next - Get next task for agent (polling endpoint)
// :agentId can be either MongoDB _id or containerId
router.get('/agent/:agentId/next', async (req, res, next) => {
  try {
    const agentId = req.params.agentId
    const { missionId } = req.query

    // Find the agent to get containerId
    const agent = await Agent.findById(agentId)
    let containerId = agentId // Default to using agentId as is

    if (agent && agent.containerId) {
      // Use containerId if available (for existing tasks)
      containerId = agent.containerId
    }

    // Find next pending task for this agent
    const filter: any = {
      status: 'pending',
      $or: [
        { assignedTo: containerId }, // Assigned to this agent's container
        { assignedTo: agentId },     // Or assigned to agentId directly
        { assignedTo: { $exists: false } } // Or unassigned (any agent can take)
      ]
    }

    // Filter by mission if specified
    if (missionId) {
      filter.missionId = missionId
    }

    // Get candidate tasks
    const tasks = await Task.find(filter)
      .sort({ priority: -1, createdAt: 1 })
      .limit(10)

    // For each task, check if its dependencies are completed
    const availableTasks = []
    for (const task of tasks) {
      if (!task.dependencies || task.dependencies.length === 0) {
        availableTasks.push(task)
        continue
      }

      // Fetch all dependency tasks and check if they're completed
      const depTasks = await Task.find({
        _id: { $in: task.dependencies },
        status: 'completed'
      })

      if (depTasks.length === task.dependencies.length) {
        availableTasks.push(task)
      }
    }

    if (availableTasks.length === 0) {
      return res.status(204).send()
    }

    // Return first available task
    const task = availableTasks[0]

    // Assign task to this agent's containerId (or agentId if no container yet)
    task.assignedTo = agent.containerId || agentId
    await task.save()

    res.json(task)
  } catch (error) {
    next(error)
  }
})

// POST /api/tasks/:id/start - Mark task as in progress
router.post('/:id/start', async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id)

    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    if (task.status !== 'pending') {
      return res.status(400).json({ error: 'Task can only be started from pending status' })
    }

    task.status = 'in_progress'
    task.startedAt = new Date()
    await task.save()

    res.json({ message: 'Task started', task })
  } catch (error) {
    next(error)
  }
})

// POST /api/tasks/:id/complete - Complete task with result
router.post('/:id/complete', async (req, res, next) => {
  try {
    const { output, completed = true } = req.body

    const task = await Task.findById(req.params.id)

    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    if (task.status !== 'in_progress') {
      return res.status(400).json({ error: 'Task can only be completed from in_progress status' })
    }

    task.status = completed ? 'completed' : 'failed'
    task.output = output || {}
    task.completedAt = new Date()

    // Clear error if completing successfully
    if (completed) {
      task.error = undefined
    }

    await task.save()

    // Check if mission is completed after this task
    if (task.missionId) {
      await checkMissionCompletion(task.missionId)
    }

    res.json({ message: completed ? 'Task completed' : 'Task failed', task })
  } catch (error) {
    next(error)
  }
})

// POST /api/tasks/:id/fail - Mark task as failed
router.post('/:id/fail', async (req, res, next) => {
  try {
    const { error: errorMessage } = req.body

    const task = await Task.findByIdAndUpdate(
      req.params.id,
      {
        status: 'failed',
        error: errorMessage,
        completedAt: new Date()
      },
      { new: true }
    )

    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    res.json({ message: 'Task marked as failed', task })
  } catch (error) {
    next(error)
  }
})

// POST /api/tasks/:id/process-squad-output - Process Squad Lead output and create agents/tasks
router.post('/:id/process-squad-output', async (req, res, next) => {
  try {
    const { output } = req.body

    if (!output) {
      return res.status(400).json({ error: 'Output is required' })
    }

    const task = await Task.findById(req.params.id)

    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    if (task.type !== 'mission_analysis') {
      return res.status(400).json({ error: 'This endpoint is only for mission_analysis tasks' })
    }

    // Validate output structure
    if (!output.tasks || !Array.isArray(output.tasks)) {
      return res.status(400).json({ error: 'Output must contain a tasks array' })
    }

    if (!output.agents || !Array.isArray(output.agents)) {
      return res.status(400).json({ error: 'Output must contain an agents array' })
    }

    // Process the Squad Lead output
    const result = await processSquadLeadOutput(req.params.id, output)

    res.json({
      message: 'Squad Lead output processed successfully',
      tasksCreated: result.tasksCreated,
      agentsCreated: result.agentsCreated
    })
  } catch (error) {
    next(error)
  }
})

export default router
