import { Router, Response } from 'express'
import Agent from '../models/Agent.js'
import { dockerService } from '../services/docker.service.js'
import { getModelInfo, getProviderModels } from '../config/provider-models.js'
import * as agentsMetricsService from '../services/agents-metrics.service.js'
import { activityLog } from '../services/activity-logger.service.js'
import { agentScoringService } from '../services/agent-scoring.service.js'

const router = Router()

// GET /api/agents - List all agents
router.get('/', async (req, res, next) => {
  try {
    const agents = await Agent.find().sort({ createdAt: -1 })
    res.json(agents)
  } catch (error) {
    next(error)
  }
})

// GET /api/agents/:id - Get agent by ID
router.get('/:id', async (req, res, next) => {
  try {
    const agent = await Agent.findById(req.params.id)
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' })
    }
    res.json(agent)
  } catch (error) {
    next(error)
  }
})

// POST /api/agents - Create agent and deploy container
router.post('/', async (req, res, next) => {
  try {
    const { provider, llmModel } = req.body

    // Validate provider/model combination if both are provided
    if (provider && llmModel) {
      const modelInfo = getModelInfo(provider, llmModel)
      if (!modelInfo) {
        return res.status(400).json({
          error: `Invalid model "${llmModel}" for provider "${provider}"`,
          hint: `Use GET /api/models/providers/${provider}/models to list available models`
        })
      }
    }

    // 1. Crear agente en MongoDB
    const agent = new Agent({
      name: req.body.name,
      role: req.body.role,
      personality: req.body.personality,
      llmModel: req.body.llmModel || 'glm-4.7',
      provider: req.body.provider || 'zai',
      apiKey: req.body.apiKey,
      capabilities: req.body.capabilities || [],
      containerId: req.body.containerId,  // Usar containerId del request si existe
      status: req.body.containerId ? 'active' : 'inactive'
    })
    const savedAgent = await agent.save()

    // 2. Si NO se proporcionó containerId, crear contenedor Docker automáticamente
    if (!req.body.containerId) {
      try {
        const containerId = await dockerService.createAgentContainer(
          savedAgent._id.toString(),
          {
            name: savedAgent.name,
            role: savedAgent.role,
            personality: savedAgent.personality,
            llmModel: savedAgent.llmModel,
            provider: savedAgent.provider,
            apiKey: savedAgent.apiKey
          }
        )

        // 3. Actualizar agente con containerId y estado
        savedAgent.containerId = containerId
        savedAgent.status = 'active'
        await savedAgent.save()
      } catch (dockerError) {
        // Si falla Docker, guardar el error pero mantener el agente
        console.error('Docker deployment failed:', dockerError)
        savedAgent.status = 'offline'
        await savedAgent.save()
        return res.status(201).json({
          ...savedAgent.toObject(),
          warning: 'Agent created but container deployment failed'
        })
      }
    }

    // Log activity
    await activityLog.agentCreated(savedAgent.name, savedAgent.role, savedAgent._id.toString())

    if (savedAgent.containerId) {
      await activityLog.agentDeployed(savedAgent.name, savedAgent.containerId, savedAgent._id.toString())
    }

    res.status(201).json(savedAgent)
  } catch (error) {
    next(error)
  }
})

// PUT /api/agents/:id - Update agent
router.put('/:id', async (req, res, next) => {
  try {
    // Get current agent BEFORE updating to detect changes
    const currentAgent = await Agent.findById(req.params.id)
    if (!currentAgent) {
      return res.status(404).json({ error: 'Agent not found' })
    }

    // Detect if provider or model changed
    const providerChanged = req.body.provider && req.body.provider !== currentAgent.provider
    const modelChanged = req.body.llmModel && req.body.llmModel !== currentAgent.llmModel
    const needsContainerRecreation = providerChanged || modelChanged

    // Validate provider/model combination if provided
    if (req.body.provider && req.body.llmModel) {
      const modelInfo = getModelInfo(req.body.provider, req.body.llmModel)
      if (!modelInfo) {
        return res.status(400).json({
          error: `Invalid model "${req.body.llmModel}" for provider "${req.body.provider}"`,
          hint: `Use GET /api/models/providers/${req.body.provider}/models to list available models`
        })
      }
    }

    // Update agent in MongoDB
    const updatedAgent = await Agent.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    )

    // Auto-recreate container if provider/model changed and agent has a container
    let containerRecreated = false
    let newContainerId = updatedAgent.containerId

    if (needsContainerRecreation && currentAgent.containerId) {
      console.log(`Provider or model changed for agent ${updatedAgent.name}. Recreating container...`)

      try {
        // Stop and remove old container
        const existingStatus = await dockerService.getContainerStatus(currentAgent.containerId)
        if (existingStatus === 'running') {
          await dockerService.stopContainer(currentAgent.containerId)
        }
        await dockerService.removeContainer(currentAgent.containerId)
        console.log(`Old container ${currentAgent.containerId} removed`)

        // Create new container with updated config
        newContainerId = await dockerService.createAgentContainer(
          updatedAgent._id.toString(),
          {
            name: updatedAgent.name,
            role: updatedAgent.role,
            personality: updatedAgent.personality,
            llmModel: updatedAgent.llmModel,
            provider: updatedAgent.provider,
            apiKey: updatedAgent.apiKey
          }
        )

        // Update agent with new container ID
        updatedAgent.containerId = newContainerId
        updatedAgent.status = 'active'
        await updatedAgent.save()

        containerRecreated = true
        console.log(`New container ${newContainerId} created for agent ${updatedAgent.name}`)
      } catch (dockerError) {
        console.error('Failed to recreate container:', dockerError)
        // Keep agent updated but mark as offline
        updatedAgent.containerId = undefined
        updatedAgent.status = 'offline'
        await updatedAgent.save()
      }
    }

    const response: any = updatedAgent.toObject()
    if (containerRecreated) {
      response.containerRecreated = true
      response.message = 'Agent updated and container recreated with new model/provider'

      // Log container recreation
      await activityLog.containerRecreated(updatedAgent.name, newContainerId, updatedAgent._id.toString())
    }

    // Log agent update
    const changes: Record<string, any> = {}
    if (providerChanged) changes.provider = { from: currentAgent.provider, to: updatedAgent.provider }
    if (modelChanged) changes.llmModel = { from: currentAgent.llmModel, to: updatedAgent.llmModel }
    if (req.body.name) changes.name = { from: currentAgent.name, to: updatedAgent.name }

    await activityLog.agentUpdated(updatedAgent.name, changes, updatedAgent._id.toString())

    res.json(response)
  } catch (error) {
    next(error)
  }
})

// DELETE /api/agents/:id - Delete agent and remove container
router.delete('/:id', async (req, res, next) => {
  try {
    const agent = await Agent.findById(req.params.id)
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' })
    }

    // Eliminar contenedor si existe
    if (agent.containerId) {
      try {
        await dockerService.removeContainer(agent.containerId)
        console.log(`Container ${agent.containerId} removed for agent ${agent.name}`)
      } catch (dockerError) {
        console.error('Failed to remove container:', dockerError)
        // Continuar con eliminación del agente aunque falle Docker
      }
    }

    // Log activity before deleting
    await activityLog.agentDeleted(agent.name, agent._id.toString())

    // Eliminar agente de MongoDB
    await Agent.findByIdAndDelete(req.params.id)
    res.status(204).send()
  } catch (error) {
    next(error)
  }
})

// POST /api/agents/:id/deploy - Redeploy agent container
router.post('/:id/deploy', async (req, res, next) => {
  try {
    const agent = await Agent.findById(req.params.id)
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' })
    }

    // Si ya tiene contenedor, eliminarlo primero
    if (agent.containerId) {
      try {
        const existingStatus = await dockerService.getContainerStatus(agent.containerId)
        if (existingStatus === 'running') {
          await dockerService.stopContainer(agent.containerId)
        }
        await dockerService.removeContainer(agent.containerId)
      } catch (err) {
        console.error('Error removing old container:', err)
      }
    }

    // Crear nuevo contenedor
    const containerId = await dockerService.createAgentContainer(
      agent._id.toString(),
      {
        name: agent.name,
        role: agent.role,
        personality: agent.personality,
        llmModel: agent.llmModel,
        provider: agent.provider,
        apiKey: agent.apiKey  // Pasar API key al redeploy
      }
    )

    // Actualizar agente
    agent.containerId = containerId
    agent.status = 'active'
    await agent.save()

    // Log activity
    await activityLog.agentDeployed(agent.name, containerId, agent._id.toString())

    res.json({
      message: 'Agent redeployed successfully',
      agent,
      containerId
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/agents/:id/stop - Stop agent container
router.post('/:id/stop', async (req, res, next) => {
  try {
    const agent = await Agent.findById(req.params.id)
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' })
    }

    if (!agent.containerId) {
      return res.status(400).json({ error: 'No container to stop' })
    }

    await dockerService.stopContainer(agent.containerId)
    agent.status = 'offline'
    await agent.save()

    // Log activity
    await activityLog.agentStopped(agent.name, agent._id.toString())

    res.json({ message: 'Agent stopped', agent })
  } catch (error) {
    next(error)
  }
})

// POST /api/agents/:id/start - Start agent container
router.post('/:id/start', async (req, res, next) => {
  try {
    const agent = await Agent.findById(req.params.id)
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' })
    }

    if (!agent.containerId) {
      return res.status(400).json({ error: 'No container to start' })
    }

    await dockerService.startContainer(agent.containerId)
    agent.status = 'active'
    await agent.save()

    // Log activity
    await activityLog.agentStarted(agent.name, agent._id.toString())

    res.json({ message: 'Agent started', agent })
  } catch (error) {
    next(error)
  }
})

// GET /api/agents/:id/logs - Get agent container logs (parsed)
router.get('/:id/logs', async (req, res, next) => {
  try {
    const agent = await Agent.findById(req.params.id)
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' })
    }

    if (!agent.containerId) {
      return res.status(400).json({ error: 'No container found for this agent' })
    }

    const tail = parseInt(req.query.tail as string) || 100
    const logs = await dockerService.getContainerLogsParsed(agent.containerId, { tail })

    res.json({
      agentId: agent._id,
      agentName: agent.name,
      containerId: agent.containerId,
      logs,
      count: logs.length
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/agents/:id/logs/stream - Stream agent container logs (SSE)
router.get('/:id/logs/stream', async (req, res, next) => {
  try {
    const agent = await Agent.findById(req.params.id)
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' })
    }

    if (!agent.containerId) {
      return res.status(400).json({ error: 'No container found for this agent' })
    }

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected', agentId: agent._id, agentName: agent.name })}\n\n`)

    // Setup log stream
    const stream = dockerService.streamContainerLogs(
      agent.containerId,
      (log) => {
        try {
          res.write(`data: ${JSON.stringify({ type: 'log', data: log })}\n\n`)
        } catch (err) {
          // Client disconnected
          stream.destroy()
        }
      }
    )

    // Handle client disconnect
    req.on('close', () => {
      stream.destroy()
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/agents/:id/status - Get agent container status
router.get('/:id/status', async (req, res, next) => {
  try {
    const agent = await Agent.findById(req.params.id)
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' })
    }

    if (!agent.containerId) {
      return res.json({
        agentId: agent._id,
        agentName: agent.name,
        containerStatus: null,
        message: 'No container deployed'
      })
    }

    const container = await dockerService.getContainer(agent.containerId)
    if (!container) {
      return res.json({
        agentId: agent._id,
        agentName: agent.name,
        containerStatus: null,
        message: 'Container not found'
      })
    }

    const containerStatus = await dockerService.getContainerStatus(agent.containerId)

    res.json({
      agentId: agent._id,
      agentName: agent.name,
      containerId: agent.containerId,
      containerStatus,
      state: container.State,
      created: container.Created,
      image: container.Config.Image
    })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/agents/:id/container - Destroy agent container only
router.delete('/:id/container', async (req, res, next) => {
  try {
    const agent = await Agent.findById(req.params.id)
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' })
    }

    if (!agent.containerId) {
      return res.status(400).json({ error: 'No container to destroy' })
    }

    try {
      await dockerService.removeContainer(agent.containerId)
    } catch (dockerError) {
      console.error('Failed to remove container:', dockerError)
      return res.status(500).json({ error: 'Failed to remove container' })
    }

    // Log activity
    await activityLog.containerDestroyed(agent.name, agent._id.toString())

    // Actualizar agente para indicar que no tiene contenedor
    agent.containerId = undefined
    agent.status = 'offline'
    await agent.save()

    res.json({
      message: 'Agent container destroyed',
      agentId: agent._id,
      agentName: agent.name
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/agents/metrics - Get metrics for all agents
router.get('/metrics', async (req, res, next) => {
  try {
    const metrics = await agentsMetricsService.getAllAgentsMetrics()
    res.json(metrics)
  } catch (error) {
    next(error)
  }
})

// GET /api/agents/:id/metrics - Get metrics for a specific agent
router.get('/:id/metrics', async (req, res, next) => {
  try {
    const metrics = await agentsMetricsService.getAgentMetrics(req.params.id)
    if (!metrics) {
      return res.status(404).json({ error: 'Agent not found or has no tasks' })
    }
    res.json(metrics)
  } catch (error) {
    next(error)
  }
})

// GET /api/agents/metrics/system - Get system-wide metrics
router.get('/metrics/system', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query

    const options = {
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined
    }

    const metrics = await agentsMetricsService.getSystemMetrics(options)
    res.json(metrics)
  } catch (error) {
    next(error)
  }
})

// ========== Phase 9: Agent Scoring Endpoints ==========

// POST /api/agents/score - Score agents for a task
router.post('/score', async (req, res, next) => {
  try {
    const { taskType, requiredCapabilities, preferredAgentId, missionId } = req.body

    const scores = await agentScoringService.scoreAgents({
      taskType,
      requiredCapabilities,
      preferredAgentId,
      missionId
    })

    res.json({
      criteria: { taskType, requiredCapabilities, preferredAgentId, missionId },
      agents: scores,
      bestAgent: scores.length > 0 ? scores[0] : null,
      totalAgents: scores.length
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/agents/:id/score - Get score breakdown for a specific agent
router.get('/:id/score', async (req, res, next) => {
  try {
    const { taskType, requiredCapabilities, missionId } = req.query

    const agent = await Agent.findById(req.params.id)
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' })
    }

    const score = await agentScoringService.scoreAgent(agent, {
      taskType: taskType as string,
      requiredCapabilities: requiredCapabilities ? (requiredCapabilities as string).split(',') : undefined,
      missionId: missionId as string
    })

    res.json(score)
  } catch (error) {
    next(error)
  }
})

export default router
