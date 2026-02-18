import { Router } from 'express'
import Task from '../models/Task.js'
import Mission from '../models/Mission.js'
import Agent from '../models/Agent.js'
import {
  processSquadLeadOutput,
  checkMissionCompletion
} from '../services/orchestration.service.js'
import { taskEventsService } from '../services/task-events.service.js'
import { activityLog } from '../services/activity-logger.service.js'

const router = Router()

// Helper para enriquecer tareas con información de misión y agente
async function enrichTasks(tasks: any[]) {
  if (tasks.length === 0) return []

  // Obtener IDs únicos de misiones y agentes
  const missionIds = [...new Set(tasks.map(t => t.missionId).filter(Boolean))]
  const assignedAgentIds = [...new Set(tasks.map(t => t.assignedTo).filter(Boolean))]

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

  // Buscar agentes - puede ser por _id o por containerId
  let agentMap = new Map()
  if (assignedAgentIds.length > 0) {
    try {
      // Buscar agentes que coincidan ya sea por _id o por containerId
      const agents = await Agent.find({
        $or: [
          { _id: { $in: assignedAgentIds } },
          { containerId: { $in: assignedAgentIds } }
        ]
      }).lean()

      // Crear mapa con ambas claves: _id y containerId
      for (const agent of agents) {
        const name = agent.name || agent.containerId || 'Unknown Agent'
        if (agent._id) {
          agentMap.set(agent._id.toString(), name)
        }
        if (agent.containerId) {
          agentMap.set(agent.containerId, name)
        }
      }
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

    // Añadir nombre del agente (por _id o por containerId)
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

// GET /api/tasks/stream - SSE stream for real-time task updates
// IMPORTANTE: Esta ruta debe ir ANTES de /:id para evitar conflictos
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  taskEventsService.registerClient(res)

  req.on('close', () => {
    taskEventsService.unregisterClient(res)
  })
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

    // Log activity
    await activityLog.taskCreated(task.title, task.missionId, task._id.toString())

    taskEventsService.emitTaskCreated(task)
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

    taskEventsService.emitTaskUpdated(task)

    // If task is completed, set completedAt and log
    if (req.body.status === 'completed' && !task.completedAt) {
      task.completedAt = new Date()
      await task.save()

      // Calculate duration
      const duration = task.startedAt
        ? task.completedAt.getTime() - new Date(task.startedAt).getTime()
        : undefined

      await activityLog.taskCompleted(task.title, duration, task._id.toString())
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

    // Log activity
    await activityLog.taskDeleted(task.title, task._id.toString())

    taskEventsService.emitTaskDeleted(req.params.id)
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
    // Exclude human_input tasks - those are for humans, not agents
    const filter: any = {
      status: 'pending',
      type: { $ne: 'human_input' }, // Exclude tasks for humans
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

// POST /api/tasks/:id/fail - Mark task as failed and handle retry logic
router.post('/:id/fail', async (req, res, next) => {
  try {
    const { error: errorMessage } = req.body

    const task = await Task.findById(req.params.id)

    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    // Record retry attempt
    await task.recordRetry(errorMessage, task.assignedTo)

    // Mark as failed
    task.status = 'failed'
    task.error = errorMessage
    task.completedAt = new Date()
    await task.save()

    // Log activity
    await activityLog.taskFailed(task.title, errorMessage, task._id.toString())

    // Check if task needs audit (reached max retries)
    const needsAudit = task.retryCount >= task.maxRetries && !task.auditorReviewId

    res.json({
      message: 'Task marked as failed',
      task,
      needsAudit,
      retryCount: task.retryCount,
      maxRetries: task.maxRetries
    })
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

// POST /api/tasks/:id/status - Update task status
router.post('/:id/status', async (req, res, next) => {
  try {
    const { status, output } = req.body

    if (!status) {
      return res.status(400).json({ error: 'Status is required' })
    }

    const validStatuses = ['pending', 'in_progress', 'completed', 'failed', 'awaiting_human_response']
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` })
    }

    const task = await Task.findById(req.params.id)
    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    task.status = status
    if (output) {
      task.output = output
    }

    // Set timestamps based on status
    if (status === 'in_progress' && !task.startedAt) {
      task.startedAt = new Date()
    } else if (status === 'completed' || status === 'failed') {
      task.completedAt = new Date()
    }

    await task.save()
    res.json({ message: 'Task status updated', task })
  } catch (error) {
    next(error)
  }
})

// POST /api/tasks/:id/human-response - Complete a human_input task and resume parent task
router.post('/:id/human-response', async (req, res, next) => {
  try {
    const { response } = req.body

    if (!response) {
      return res.status(400).json({ error: 'Response is required' })
    }

    const task = await Task.findById(req.params.id)
    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    if (task.type !== 'human_input') {
      return res.status(400).json({ error: 'This endpoint is only for human_input tasks' })
    }

    // Get parent task ID from input
    const parentTaskId = task.input?.parentTaskId
    if (!parentTaskId) {
      return res.status(400).json({ error: 'Human task has no parent task ID' })
    }

    // Find and update the parent Squad Lead task
    const parentTask = await Task.findById(parentTaskId)
    if (!parentTask) {
      return res.status(404).json({ error: 'Parent task not found' })
    }

    // Mark human task as completed
    task.status = 'completed'
    task.output = { humanResponse: response }
    task.completedAt = new Date()
    await task.save()

    // Update mission to clear awaiting task
    if (task.missionId) {
      await Mission.findByIdAndUpdate(
        task.missionId,
        { $unset: { awaitingHumanTaskId: '' } }
      )
    }

    // Create a new Squad Lead task with the human's answers
    // This task will contain the human's response as context
    const resumeTask = new Task({
      missionId: parentTask.missionId,
      title: `Resume Mission Analysis with Human Input`,
      description: `Continue mission analysis with the following human input:\n\n${response}`,
      type: 'mission_analysis',
      assignedTo: parentTask.assignedTo,
      status: 'pending',
      dependencies: [],
      priority: parentTask.priority,
      input: {
        originalTaskId: parentTaskId,
        humanResponse: response,
        originalMission: {
          title: parentTask.title,
          description: parentTask.description
        }
      }
    })
    await resumeTask.save()

    // Mark old parent task as completed (replaced by resume task)
    parentTask.status = 'completed'
    parentTask.output = {
      success: true,
      result: {
        awaitingHumanInput: true,
        resumedBy: resumeTask._id
      }
    }
    parentTask.completedAt = new Date()
    await parentTask.save()

    res.json({
      message: 'Human response recorded. Squad Lead will continue with your input.',
      humanTask: task,
      resumeTask
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/tasks/human/list - List all pending human_input tasks
router.get('/human/list', async (req, res, next) => {
  try {
    const { missionId } = req.query

    const filter: any = {
      type: 'human_input',
      status: 'pending'
    }

    if (missionId) {
      filter.missionId = missionId
    }

    const tasks = await Task.find(filter).sort({ createdAt: -1 })
    const enrichedTasks = await enrichTasks(tasks)

    res.json(enrichedTasks)
  } catch (error) {
    next(error)
  }
})

// POST /api/tasks/:id/retry - Reintentar tarea manualmente
router.post('/:id/retry', async (req, res, next) => {
  try {
    const { id } = req.params
    const { forceNewAgent } = req.body  // Opción forzar asignación a diferente agente

    const task = await Task.findById(id)
    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    // Verificar si puede ser reintentada
    if (task.status !== 'failed') {
      return res.status(400).json({ error: 'Only failed tasks can be retried' })
    }

    if (task.retryCount >= task.maxRetries) {
      return res.status(400).json({
        error: 'Task has reached maximum retries. Use auditor to review.',
        needsAudit: true
      })
    }

    if (task.auditorReviewId) {
      return res.status(400).json({ error: 'Task is under auditor review' })
    }

    // Registrar reintento
    await task.recordRetry('Manual retry by user', task.assignedTo)

    // Resetear estado para que el agente la tome nuevamente
    task.status = 'pending'
    task.error = undefined

    // Si se solicita nuevo agente, remover asignación actual
    if (forceNewAgent) {
      task.assignedTo = undefined
    }

    await task.save()

    // Log activity
    await activityLog.log({
      type: 'task',
      message: `Task "${task.title}" reattempted (attempt ${task.retryCount}/${task.maxRetries})`,
      details: {
        taskId: task._id.toString(),
        missionId: task.missionId,
        retryCount: task.retryCount
      }
    })

    res.json({
      message: 'Task queued for retry',
      task: {
        _id: task._id,
        title: task.title,
        retryCount: task.retryCount,
        maxRetries: task.maxRetries,
        status: task.status
      }
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/tasks/:id/auditor-decision - Recibir decisión del auditor
// id puede ser:
//   - ID de la tarea de auditoría (tiene input.failedTaskId)
//   - ID directo de la tarea fallida (para uso manual/pruebas)
router.post('/:id/auditor-decision', async (req, res, next) => {
  try {
    const { id } = req.params
    const { decision, reason, suggestedAgentRole, refinedDescription, questionForHuman } = req.body

    if (!decision || !['reassign', 'refine', 'escalate_human', 'retry'].includes(decision)) {
      return res.status(400).json({ error: 'Invalid decision. Must be: reassign, refine, escalate_human, or retry' })
    }

    // Check if this is an audit task (has failedTaskId in input) or a failed task directly
    const auditTask = await Task.findById(id)
    let task

    if (auditTask && auditTask.input?.failedTaskId) {
      // This is an audit task - get the failed task ID from input
      const failedTaskId = auditTask.input.failedTaskId
      task = await Task.findById(failedTaskId)
      if (!task) {
        return res.status(404).json({ error: 'Failed task not found' })
      }
    } else if (auditTask && (auditTask.status === 'failed' || auditTask.retryCount > 0)) {
      // This is the failed task itself - use directly
      task = auditTask
    } else {
      return res.status(404).json({ error: 'Task not found or not a valid audit/failed task' })
    }

    switch (decision) {
      case 'reassign':
        // Find agent by suggested role
        if (!suggestedAgentRole) {
          return res.status(400).json({ error: 'suggestedAgentRole required for reassign' })
        }

        // Find an available agent with the suggested role
        const newAgent = await Agent.findOne({
          role: suggestedAgentRole,
          status: 'idle',
          containerId: { $exists: true, $ne: null }
        })

        if (!newAgent) {
          return res.status(404).json({ error: `No available ${suggestedAgentRole} agent found` })
        }

        // Reassign to new agent
        task.assignedTo = newAgent.containerId
        task.status = 'pending'
        task.error = undefined
        task.auditorReviewId = undefined
        await task.save()

        await activityLog.log({
          type: 'task',
          message: `Task "${task.title}" reassigned from auditor decision`,
          details: {
            taskId: task._id.toString(),
            missionId: task.missionId,
            newAgentId: newAgent._id.toString(),
            newAgentName: newAgent.name,
            suggestedRole: suggestedAgentRole,
            auditorReason: reason
          }
        })

        res.json({
          message: `Task reassigned to ${newAgent.name} (${suggestedAgentRole})`,
          decision: 'reassign',
          taskId: task._id,
          newAgent: {
            id: newAgent._id,
            name: newAgent.name,
            role: newAgent.role
          }
        })
        break

      case 'refine':
        // Refinar descripción de la tarea
        if (!refinedDescription) {
          return res.status(400).json({ error: 'refinedDescription required for refine' })
        }

        task.description = refinedDescription
        task.status = 'pending'
        task.error = undefined
        task.auditorReviewId = undefined
        await task.save()

        await activityLog.log({
          type: 'task',
          message: `Task "${task.title}" description refined by auditor`,
          details: {
            taskId: task._id.toString(),
            missionId: task.missionId,
            refinedDescription,
            auditorReason: reason
          }
        })

        res.json({
          message: 'Task description refined',
          decision: 'refine',
          taskId: task._id,
          newDescription: refinedDescription
        })
        break

      case 'escalate_human':
        // Escalar a humano - crear tarea human_input
        const humanTask = new Task({
          missionId: task.missionId,
          title: `Input needed for task: ${task.title}`,
          description: questionForHuman || `The auditor needs information:\n\n${reason}\n\nOriginal task: ${task.description}`,
          type: 'human_input',
          status: 'pending',
          input: {
            parentTaskId: task._id,
            auditorTaskId: id,
            originalTaskId: task._id.toString()
          }
        })
        await humanTask.save()

        // Marcar tarea como esperando respuesta humana
        task.status = 'awaiting_human_response'
        task.auditorReviewId = undefined
        await task.save()

        // Actualizar misión si es necesario
        if (task.missionId) {
          await Mission.findByIdAndUpdate(
            task.missionId,
            { awaitingHumanTaskId: humanTask._id.toString() }
          )
        }

        await activityLog.log({
          type: 'task',
          message: `Task "${task.title}" escalated to human by auditor`,
          details: {
            taskId: task._id.toString(),
            missionId: task.missionId,
            humanTaskId: humanTask._id.toString(),
            questionForHuman,
            auditorReason: reason
          }
        })

        res.json({
          message: 'Task escalated to human',
          decision: 'escalate_human',
          humanTaskId: humanTask._id,
          taskId: task._id
        })
        break

      case 'retry':
        // Reintentar con el mismo agente (resetear contador de retry)
        task.retryCount = 0
        task.maxRetries = (task.maxRetries || 3) + 1  // Dar un intento extra
        task.status = 'pending'
        task.error = undefined
        task.auditorReviewId = undefined
        await task.save()

        await activityLog.log({
          type: 'task',
          message: `Task "${task.title}" queued for retry with extra attempt`,
          details: {
            taskId: task._id.toString(),
            missionId: task.missionId,
            newMaxRetries: task.maxRetries,
            auditorReason: reason
          }
        })

        res.json({
          message: 'Task queued for retry with extra attempt',
          decision: 'retry',
          taskId: task._id,
          newMaxRetries: task.maxRetries
        })
        break
    }
  } catch (error) {
    next(error)
  }
})

export default router
