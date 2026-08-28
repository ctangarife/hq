import { Router, Response, NextFunction } from 'express'
import Mission from '../models/Mission.js'
import Task from '../models/Task.js'
import {
  selectSquadLead,
  createInitialMissionTask
} from '../services/orchestration.service.js'
import { activityLog } from '../services/activity-logger.service.js'
import { fileManagementService } from '../services/file-management.service.js'
import { litellmService } from '../services/litellm.service.js'
import Workspace from '../models/Workspace.js'
import Agent from '../models/Agent.js'
import { AuthenticatedRequest } from '../middleware/jwt-auth.js'
import { getMissionFilter, getWorkspaceScope } from '../middleware/workspace-filter.js'

const router = Router()

// POST /api/missions/enrich - Enriquecer una idea breve a brief profesional
//
// El brief completo mejora drásticamente la fidelidad del contenido (validado:
// el writer desviaba sin él), pero escribirlo es fricción para el usuario.
// Este endpoint expande una idea de una línea a un brief estructurado que el
// usuario revisa/edita ANTES de crear la misión — no crea nada por sí mismo.
router.post('/enrich', async (req, res, next) => {
  try {
    const { seed } = req.body
    if (!seed || typeof seed !== 'string' || seed.trim().length < 3) {
      return res.status(400).json({ error: 'seed (idea breve) es requerido' })
    }

    const system = `Eres un estratega de contenido y marketing senior. Recibes una idea BREVE de misión y la conviertes en un BRIEF profesional completo para un equipo de agentes IA de contenido.

REGLAS:
- Enriquece la idea: propón entregables concretos (con formato, extensión y cantidad), audiencia, tono y criterios de éxito.
- NO inventes datos verificables específicos (cifras de mercado, precios) — usa directrices razonables.
- Mantén el español natural y directo.
- Responde SOLO con un JSON válido, sin markdown, con EXACTAMENTE estos campos:
{"title": "conciso", "description": "brief detallado con entregables numerados", "objective": "una línea", "context": "contexto del proyecto", "audience": "audiencia específica", "tone": "tono recomendado", "deliverableFormat": "formato de entrega", "successCriteria": "qué define el éxito", "constraints": "restricciones o 'ninguna'", "priority": "high|medium|low"}`

    const user = `Idea del usuario: "${seed.trim()}"`

    const content = await litellmService.chatCompletion(
      [{ role: 'system', content: system }, { role: 'user', content: user }],
      { temperature: 0.5, model: 'glm-5.2' },
    )

    // Parse tolerante (el modelo puede envolver en ```json)
    let cleaned = content.trim()
    const mdMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (mdMatch) cleaned = mdMatch[1]
    const firstBrace = cleaned.indexOf('{')
    if (firstBrace > 0) cleaned = cleaned.slice(firstBrace)
    // Trailing commas que rompen JSON.parse
    cleaned = cleaned.replace(/,\s*([}\]])/g, '$1')

    let brief
    try {
      brief = JSON.parse(cleaned)
    } catch {
      return res.status(502).json({
        error: 'El modelo no devolvió un brief válido',
        raw: content.slice(0, 300),
      })
    }

    res.json({ brief })
  } catch (error) {
    next(error)
  }
})

// GET /api/missions - List all missions
router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { status, assignedTo } = req.query

    const filter: any = getMissionFilter(req) // aislamiento por workspace
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

// GET /api/missions/dashboard-stats - Métricas del dashboard con scope de workspace
//
// Usuario de workspace: métricas de SU workspace (misiones/tareas/agentes).
// super_admin: métricas globales + desglose por workspace (la vista que
// antes no existía: cada tenant con sus propios números).
router.get('/dashboard-stats', async (req: AuthenticatedRequest, res, next) => {
  try {
    const scope = getWorkspaceScope(req)

    const statsForWorkspace = async (wsId?: string) => {
      const missionFilter = wsId ? { workspaceId: wsId } : {}
      const missions = await Mission.find(missionFilter).select('_id status').lean()
      // Task.missionId se guarda como string — mapear a string para que el $in matchee
      const missionIds = missions.map(m => m._id.toString())

      const taskAgg = await Task.aggregate([
        { $match: { missionId: { $in: missionIds } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
      const byStatus: Record<string, number> = {}
      for (const a of taskAgg) byStatus[a._id] = a.count

      // Agentes globales (sin workspace) + los del workspace — mismo criterio
      // de visibilidad que GET /api/agents
      const agentFilter = wsId
        ? { $or: [{ workspaceId: wsId }, { workspaceId: { $exists: false } }] }
        : {}
      const activeAgents = await Agent.countDocuments({ ...agentFilter, status: 'active' })

      return {
        totalMissions: missions.length,
        activeMissions: missions.filter(m => m.status === 'active').length,
        completedMissions: missions.filter(m => m.status === 'completed').length,
        pendingTasks: byStatus.pending || 0,
        inProgressTasks: byStatus.in_progress || 0,
        completedTasks: byStatus.completed || 0,
        failedTasks: byStatus.failed || 0,
        activeAgents,
      }
    }

    if (scope.isGlobal) {
      const overall = await statsForWorkspace(undefined)
      const workspaces = await Workspace.find().select('name members').lean()
      const breakdown = []
      for (const ws of workspaces) {
        breakdown.push({
          workspaceId: ws._id,
          name: ws.name,
          members: (ws.members || []).length,
          ...(await statsForWorkspace(ws._id.toString())),
        })
      }
      return res.json({ scope: 'global', ...overall, workspaces: breakdown })
    }

    const stats = await statsForWorkspace(scope.workspaceId || undefined)
    res.json({ scope: 'workspace', workspaceId: scope.workspaceId, ...stats })
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
router.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    // El brief completo (context, audience, tone, …) viene del enriquecedor
    // y del formulario extendido: antes sólo se persistían title/description/
    // objective y el resto se descartaba silenciosamente — el Squad Lead
    // recibía un brief vacío en el flujo de creación normal.
    const {
      title, description, objective, priority, squadIds,
      context, audience, tone, deliverableFormat, successCriteria, constraints,
      missionType, templateId,
      workspaceId: bodyWsId,
    } = req.body

    // Aislamiento: asignar el workspace del usuario automáticamente.
    // super_admin puede especificar cualquier workspaceId vía body.
    // El resto: SIEMPRE su propio workspace (ignora lo que venga en el body).
    const scope = getWorkspaceScope(req)
    const wsId = scope.isGlobal ? (bodyWsId || undefined) : (scope.workspaceId || undefined)

    const mission = new Mission({
      title,
      description,
      objective,
      priority: priority || 'medium',
      squadIds: squadIds || [],
      status: 'draft',
      taskIds: [],
      workspaceId: wsId,
      missionType,
      templateId,
      context,
      audience,
      tone,
      deliverableFormat,
      successCriteria,
      constraints,
    })

    const saved = await mission.save()

    // Log activity
    await activityLog.missionCreated(saved.title, saved._id.toString())

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

    // Add orchestration log entry
    mission.orchestrationLog.push({
      timestamp: new Date(),
      action: 'mission_paused',
      details: { reason: req.body.reason || 'Manually paused' }
    })
    await mission.save()

    // Log activity
    const reason = req.body.reason
    await activityLog.missionPaused(mission.title, reason, mission._id.toString())

    res.json({ message: 'Mission paused', mission })
  } catch (error) {
    next(error)
  }
})

// POST /api/missions/:id/resume - Resume paused mission
router.post('/:id/resume', async (req, res, next) => {
  try {
    const mission = await Mission.findById(req.params.id)

    if (!mission) {
      return res.status(404).json({ error: 'Mission not found' })
    }

    if (mission.status !== 'paused') {
      return res.status(400).json({ error: 'Mission can only be resumed from paused status' })
    }

    mission.status = 'active'

    // Add orchestration log entry
    mission.orchestrationLog.push({
      timestamp: new Date(),
      action: 'mission_resumed',
      details: {}
    })
    await mission.save()

    // Log activity
    await activityLog.missionResumed(mission.title, mission._id.toString())

    res.json({ message: 'Mission resumed', mission })
  } catch (error) {
    next(error)
  }
})

// POST /api/missions/:id/cancel - Cancel active mission
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const mission = await Mission.findById(req.params.id)

    if (!mission) {
      return res.status(404).json({ error: 'Mission not found' })
    }

    if (mission.status === 'completed') {
      return res.status(400).json({ error: 'Cannot cancel a completed mission' })
    }

    const previousStatus = mission.status
    mission.status = 'completed' // Cancelled missions are marked as completed
    mission.completedAt = new Date()

    // Add orchestration log entry
    mission.orchestrationLog.push({
      timestamp: new Date(),
      action: 'mission_cancelled',
      details: {
        previousStatus,
        reason: req.body.reason || 'Manually cancelled'
      }
    })
    await mission.save()

    // Log activity
    const reason = req.body.reason
    await activityLog.missionCancelled(mission.title, reason, mission._id.toString())

    res.json({ message: 'Mission cancelled', mission })
  } catch (error) {
    next(error)
  }
})

// GET /api/missions/:id/progress - Get mission progress statistics
router.get('/:id/progress', async (req, res, next) => {
  try {
    const mission = await Mission.findById(req.params.id)

    if (!mission) {
      return res.status(404).json({ error: 'Mission not found' })
    }

    const tasks = await Task.find({ missionId: req.params.id })

    const totalTasks = tasks.length
    const completedTasks = tasks.filter(t => t.status === 'completed').length
    const failedTasks = tasks.filter(t => t.status === 'failed').length
    const pendingTasks = tasks.filter(t => t.status === 'pending').length
    const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length
    const awaitingHumanTasks = tasks.filter(t => t.status === 'awaiting_human_response').length

    // Get unique agents working on this mission
    const agentIds = new Set()
    tasks.forEach(task => {
      if (task.assignedTo) {
        agentIds.add(task.assignedTo)
      }
    })

    // Calculate progress percentage
    const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

    res.json({
      missionId: mission._id,
      missionTitle: mission.title,
      status: mission.status,
      progress,
      tasks: {
        total: totalTasks,
        completed: completedTasks,
        failed: failedTasks,
        pending: pendingTasks,
        inProgress: inProgressTasks,
        awaitingHuman: awaitingHumanTasks
      },
      agents: {
        active: agentIds.size
      },
      startedAt: mission.startedAt,
      completedAt: mission.completedAt,
      duration: mission.startedAt && mission.completedAt
        ? mission.completedAt.getTime() - mission.startedAt.getTime()
        : null
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/missions/:id/timeline - Get orchestration timeline
router.get('/:id/timeline', async (req, res, next) => {
  try {
    const mission = await Mission.findById(req.params.id)

    if (!mission) {
      return res.status(404).json({ error: 'Mission not found' })
    }

    // Sort orchestration log by timestamp
    const timeline = mission.orchestrationLog
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map(entry => ({
        timestamp: entry.timestamp,
        action: entry.action,
        details: entry.details
      }))

    res.json({
      missionId: mission._id,
      missionTitle: mission.title,
      timeline,
      totalEvents: timeline.length
    })
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

    // Log activity
    await activityLog.missionCompleted(mission.title, mission._id.toString())

    res.json({ message: 'Mission completed', mission })
  } catch (error) {
    next(error)
  }
})

// POST /api/missions/:id/orchestrate - Start automatic orchestration with Squad Lead
router.post('/:id/orchestrate', async (req, res, next) => {
  try {
    const mission = await Mission.findById(req.params.id)

    if (!mission) {
      return res.status(404).json({ error: 'Mission not found' })
    }

    if (mission.status !== 'draft') {
      return res.status(400).json({ error: 'Mission can only be orchestrated from draft status' })
    }

    if (mission.squadLeadId) {
      return res.status(400).json({ error: 'Mission already has a Squad Lead assigned' })
    }

    // Step 1: Select or create Squad Lead
    const squadLead = await selectSquadLead(mission._id.toString())

    // Step 2: Update mission with Squad Lead
    mission.squadLeadId = squadLead._id.toString()
    mission.autoOrchestrate = true
    mission.status = 'active'
    mission.startedAt = new Date()
    await mission.save()

    // Add orchestration log entry
    mission.orchestrationLog.push({
      timestamp: new Date(),
      action: 'orchestration_started',
      details: {
        squadLeadId: squadLead._id.toString(),
        squadLeadName: squadLead.name
      }
    })
    await mission.save()

    // Step 3: Create initial mission analysis task
    const initialTask = await createInitialMissionTask(
      mission._id.toString(),
      squadLead._id.toString()
    )

    // Add task to mission's taskIds
    mission.taskIds.push(initialTask._id as any)
    await mission.save()

    // Log activity
    await activityLog.missionOrchestrationStarted(mission.title, squadLead.name, mission._id.toString())

    res.status(200).json({
      message: 'Mission orchestration started',
      mission: {
        _id: mission._id,
        title: mission.title,
        status: mission.status,
        squadLeadId: mission.squadLeadId,
        autoOrchestrate: mission.autoOrchestrate
      },
      squadLead: {
        _id: squadLead._id,
        name: squadLead.name,
        role: squadLead.role,
        status: squadLead.status
      },
      initialTask: {
        _id: initialTask._id,
        title: initialTask.title,
        type: initialTask.type,
        status: initialTask.status
      }
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/missions/:id/consolidate - Consolidate mission outputs into PDF
router.post('/:id/consolidate', async (req, res, next) => {
  try {
    const mission = await Mission.findById(req.params.id)

    if (!mission) {
      return res.status(404).json({ error: 'Mission not found' })
    }

    // Verificar que la misión tenga tareas completadas
    const tasks = await Task.find({ missionId: req.params.id })
    const completedTasks = tasks.filter(t => t.status === 'completed')

    if (completedTasks.length === 0) {
      return res.status(400).json({ error: 'No completed tasks to consolidate' })
    }

    // Consolidar outputs usando el servicio
    const reportPath = await fileManagementService.consolidateMissionOutputs(req.params.id)

    // Obtener metadata actualizada
    const metadata = await fileManagementService.getMissionMetadata(req.params.id)

    // Add orchestration log entry
    mission.orchestrationLog.push({
      timestamp: new Date(),
      action: 'outputs_consolidated',
      details: {
        tasksConsolidated: completedTasks.length,
        reportPath
      }
    })
    await mission.save()

    // Log activity
    await activityLog.log({
      type: 'mission.consolidated',
      missionId: mission._id.toString(),
      title: mission.title,
      details: {
        tasksCount: completedTasks.length,
        reportPath
      },
      timestamp: new Date()
    })

    res.json({
      message: 'Mission outputs consolidated successfully',
      missionId: mission._id,
      reportPath,
      outputFiles: metadata?.outputFiles || [],
      tasksConsolidated: completedTasks.length
    })
  } catch (error) {
    console.error('Error consolidating mission outputs:', error)
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

    // Log activity before deleting
    await activityLog.missionDeleted(mission.title, req.params.id)

    // Also delete all associated tasks
    await Task.deleteMany({ missionId: req.params.id })

    res.status(204).send()
  } catch (error) {
    next(error)
  }
})

// POST /api/missions/:id/restart - Restart mission (reset to draft)
router.post('/:id/restart', async (req, res, next) => {
  try {
    const mission = await Mission.findById(req.params.id)

    if (!mission) {
      return res.status(404).json({ error: 'Mission not found' })
    }

    if (mission.status === 'draft') {
      return res.status(400).json({ error: 'Cannot restart a mission that is already in draft status' })
    }

    // Store previous state for logging
    const previousStatus = mission.status
    const previousSquadLeadId = mission.squadLeadId

    // Reset mission to draft state
    mission.status = 'draft'
    mission.autoOrchestrate = false
    mission.squadLeadId = undefined
    mission.startedAt = undefined
    mission.completedAt = undefined
    mission.awaitingHumanTaskId = undefined

    // Clear orchestration log
    mission.orchestrationLog = []

    // Clear task IDs (but don't delete tasks - they remain for history)
    const previousTaskIds = [...mission.taskIds]
    mission.taskIds = []

    await mission.save()

    // Optionally: Update all associated tasks to cancelled status
    if (previousTaskIds.length > 0) {
      await Task.updateMany(
        { _id: { $in: previousTaskIds } },
        { status: 'cancelled' }
      )
    }

    // Log activity
    await activityLog.log({
      type: 'mission.restarted',
      missionId: mission._id.toString(),
      title: mission.title,
      details: {
        previousStatus,
        previousSquadLeadId,
        tasksCleared: previousTaskIds.length
      },
      timestamp: new Date()
    })

    res.json({
      message: 'Mission restarted successfully',
      mission: {
        _id: mission._id,
        title: mission.title,
        status: mission.status,
        tasksCleared: previousTaskIds.length
      }
    })
  } catch (error) {
    next(error)
  }
})

export default router
