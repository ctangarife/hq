import { Router, Response } from 'express'
import Agent from '../models/Agent.js'
import { dockerService } from '../services/docker.service.js'

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
    // 1. Crear agente en MongoDB
    const agent = new Agent({
      name: req.body.name,
      role: req.body.role,
      personality: req.body.personality,
      llmModel: req.body.llmModel || 'glm-4',
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

    res.status(201).json(savedAgent)
  } catch (error) {
    next(error)
  }
})

// PUT /api/agents/:id - Update agent
router.put('/:id', async (req, res, next) => {
  try {
    const agent = await Agent.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    )
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' })
    }
    res.json(agent)
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

    res.json({ message: 'Agent started', agent })
  } catch (error) {
    next(error)
  }
})

// GET /api/agents/:id/logs - Get agent container logs
router.get('/:id/logs', async (req, res, next) => {
  try {
    const agent = await Agent.findById(req.params.id)
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' })
    }

    if (!agent.containerId) {
      return res.status(400).json({ error: 'No container found' })
    }

    const tail = parseInt(req.query.tail as string) || 100
    const logs = await dockerService.getContainerLogs(agent.containerId, tail)

    res.json({ logs, containerId: agent.containerId })
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

export default router
