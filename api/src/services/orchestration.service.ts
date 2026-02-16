/**
 * Orchestration Service
 * Core logic for Squad Lead orchestration flow
 */

import Agent from '../models/Agent.js'
import Task from '../models/Task.js'
import Mission from '../models/Mission.js'
import { dockerService } from './docker.service.js'
import { getSquadLeadTemplate, AGENT_TEMPLATES } from '../config/agent-templates.js'
import type {
  SquadLeadOutput,
  AgentDefinition,
  AgentTaskDefinition,
  OrchestrationLogEntry
} from '../types/agent.types.js'

/**
 * Select or create a Squad Lead agent for the mission
 * Priority:
 * 1. Find an idle, reusable Squad Lead not assigned to any mission
 * 2. Find an idle, reusable Squad Lead assigned to a completed mission
 * 3. Create a new Squad Lead
 */
export async function selectSquadLead(missionId: string): Promise<Agent> {
  // First try: Find idle Squad Lead with no current mission
  let squadLead = await Agent.findOne({
    role: 'squad_lead',
    status: 'idle',
    currentMissionId: { $exists: false },
    isReusable: true
  })

  if (squadLead) {
    console.log(`Reusing existing Squad Lead: ${squadLead.name}`)
    await assignMissionToAgent(squadLead, missionId)
    return squadLead
  }

  // Second try: Find Squad Lead whose current mission is completed
  const missionsWithCompletedStatus = await Mission.find({
    status: 'completed',
    squadLeadId: { $exists: true }
  })

  const completedMissionIds = missionsWithCompletedStatus.map(m => m.squadLeadId)

  squadLead = await Agent.findOne({
    _id: { $in: completedMissionIds },
    role: 'squad_lead',
    status: 'idle',
    isReusable: true
  })

  if (squadLead) {
    console.log(`Reusing Squad Lead from completed mission: ${squadLead.name}`)
    await assignMissionToAgent(squadLead, missionId)
    return squadLead
  }

  // Third option: Create new Squad Lead
  const template = getSquadLeadTemplate()
  const newSquadLead = new Agent({
    name: `Squad Lead ${Date.now()}`,
    role: template.role,
    personality: template.personality,
    capabilities: template.capabilities,
    llmModel: template.defaultLlmModel,
    provider: template.defaultProvider,
    isReusable: true,
    currentMissionId: missionId,
    missionHistory: [],
    totalMissionsCompleted: 0,
    status: 'inactive'
  })

  await newSquadLead.save()

  // Deploy container
  try {
    const containerId = await dockerService.createAgentContainer(
      newSquadLead._id.toString(),
      {
        name: newSquadLead.name,
        role: newSquadLead.role,
        personality: newSquadLead.personality,
        llmModel: newSquadLead.llmModel,
        provider: newSquadLead.provider
      }
    )
    newSquadLead.containerId = containerId
    newSquadLead.status = 'active'
    await newSquadLead.save()
    console.log(`Created new Squad Lead with container: ${containerId}`)
  } catch (error) {
    console.error('Failed to create Squad Lead container:', error)
    newSquadLead.status = 'offline'
    await newSquadLead.save()
  }

  return newSquadLead
}

/**
 * Assign a mission to an agent
 */
async function assignMissionToAgent(agent: Agent, missionId: string): Promise<void> {
  agent.currentMissionId = missionId
  agent.status = 'active'
  await agent.save()
}

/**
 * Create the initial mission analysis task for Squad Lead
 */
export async function createInitialMissionTask(
  missionId: string,
  squadLeadId: string
): Promise<Task> {
  const mission = await Mission.findById(missionId)
  if (!mission) {
    throw new Error(`Mission not found: ${missionId}`)
  }

  const task = new Task({
    missionId,
    title: 'Analyze Mission and Create Execution Plan',
    description: `Analyze the following mission and create a detailed execution plan:

Mission: ${mission.title}
Description: ${mission.description}
Objective: ${mission.objective}
Priority: ${mission.priority}

Available Agent Templates:
${Object.values(AGENT_TEMPLATES)
  .filter(t => t.role !== 'squad_lead')
  .map(t => `- ${t.id}: ${t.name} (${t.capabilities.join(', ')})`)
  .join('\n')}

Respond with a valid JSON plan following the Squad Lead schema.`,
    type: 'mission_analysis',
    assignedTo: squadLeadId,
    status: 'pending',
    dependencies: [],
    priority: 'high',
    input: {
      missionId,
      title: mission.title,
      description: mission.description,
      objective: mission.objective,
      priority: mission.priority,
      availableAgentTemplates: Object.values(AGENT_TEMPLATES)
        .filter(t => t.role !== 'squad_lead')
        .map(t => ({
          id: t.id,
          name: t.name,
          role: t.role,
          capabilities: t.capabilities
        }))
    }
  })

  await task.save()

  // Update mission with initial task
  mission.initialAnalysisTaskId = task._id.toString()
  await mission.save()

  return task
}

/**
 * Process Squad Lead output and create agents/tasks
 */
export async function processSquadLeadOutput(
  taskId: string,
  output: SquadLeadOutput
): Promise<{ tasksCreated: number; agentsCreated: number }> {
  const task = await Task.findById(taskId)
  if (!task) {
    throw new Error(`Task not found: ${taskId}`)
  }

  const mission = await Mission.findById(task.missionId)
  if (!mission) {
    throw new Error(`Mission not found: ${task.missionId}`)
  }

  // Log orchestration action
  await addOrchestrationLog(mission._id.toString(), {
    action: 'squad_lead_output_received',
    details: {
      complexity: output.complexity,
      taskCount: output.tasks.length,
      agentCount: output.agents.length,
      summary: output.summary
    }
  })

  let agentsCreated = 0
  const agentMap = new Map<string, string>() // agent.id -> agent._id

  // Create agents first
  for (const agentDef of output.agents) {
    try {
      const template = AGENT_TEMPLATES[agentDef.template || agentDef.role]

      const newAgent = new Agent({
        name: agentDef.name,
        role: agentDef.role,
        personality: template?.personality || 'You are a helpful AI assistant.',
        capabilities: agentDef.capabilities,
        llmModel: agentDef.llmModel || template?.defaultLlmModel || 'glm-4',
        provider: template?.defaultProvider || 'zai',
        isReusable: true,
        currentMissionId: mission._id.toString(),
        missionHistory: [],
        totalMissionsCompleted: 0,
        status: 'inactive'
      })

      await newAgent.save()

      // Deploy container
      try {
        const containerId = await dockerService.createAgentContainer(
          newAgent._id.toString(),
          {
            name: newAgent.name,
            role: newAgent.role,
            personality: newAgent.personality,
            llmModel: newAgent.llmModel,
            provider: newAgent.provider
          }
        )
        newAgent.containerId = containerId
        newAgent.status = 'active'
        await newAgent.save()
      } catch (dockerError) {
        console.error(`Failed to create container for agent ${newAgent.name}:`, dockerError)
        newAgent.status = 'offline'
        await newAgent.save()
      }

      agentMap.set(agentDef.id, newAgent._id.toString())
      agentsCreated++

      await addOrchestrationLog(mission._id.toString(), {
        action: 'agent_created',
        details: {
          agentId: newAgent._id.toString(),
          name: newAgent.name,
          role: newAgent.role
        }
      })
    } catch (error) {
      console.error(`Failed to create agent ${agentDef.name}:`, error)
      await addOrchestrationLog(mission._id.toString(), {
        action: 'agent_creation_failed',
        details: { agentDef, error: String(error) }
      })
    }
  }

  // Create tasks - First pass: create all tasks and build ID map
  const taskIdMap = new Map<string, string>() // tempId -> realId
  const createdTasks: Task[] = []

  for (const taskDef of output.tasks) {
    try {
      // Map agent role to actual agent ID
      let assignedTo: string | undefined
      if (taskDef.assignedAgentRole) {
        // Find agent by role
        const agents = await Agent.find({
          role: taskDef.assignedAgentRole,
          currentMissionId: mission._id.toString(),
          status: { $in: ['active', 'idle', 'inactive'] }
        })
        if (agents.length > 0) {
          // Use containerId if available, otherwise use agent _id
          assignedTo = agents[0].containerId || agents[0]._id.toString()
        }
      }

      const newTask = new Task({
        missionId: mission._id.toString(),
        title: taskDef.title,
        description: taskDef.description,
        type: taskDef.type,
        assignedTo,
        status: 'pending',
        dependencies: [], // Will be filled in second pass
        priority: taskDef.priority,
        input: taskDef.input
      })

      await newTask.save()

      // Store mapping of temp ID to real ID
      if (taskDef.id) {
        taskIdMap.set(taskDef.id, newTask._id.toString())
      }

      createdTasks.push(newTask)

      // Add to mission's taskIds
      mission.taskIds.push(newTask._id as any)

      await addOrchestrationLog(mission._id.toString(), {
        action: 'task_created',
        details: {
          taskId: newTask._id.toString(),
          tempId: taskDef.id,
          title: newTask.title,
          type: newTask.type
        }
      })
    } catch (error) {
      console.error(`Failed to create task ${taskDef.title}:`, error)
      await addOrchestrationLog(mission._id.toString(), {
        action: 'task_creation_failed',
        details: { taskDef, error: String(error) }
      })
    }
  }

  // Second pass: Process dependencies using the ID map
  const dependenciesMap = new Map<string, string[]>()
  if (output.dependencies && Array.isArray(output.dependencies)) {
    for (const dep of output.dependencies) {
      const realTaskId = taskIdMap.get(dep.taskId)
      if (realTaskId) {
        const realDepIds = (dep.dependsOn || [])
          .map((tempId: string) => taskIdMap.get(tempId))
          .filter((id: string | undefined): id is string => id !== undefined)

        dependenciesMap.set(realTaskId, realDepIds)
      }
    }
  }

  // Update tasks with their dependencies
  for (const task of createdTasks) {
    const deps = dependenciesMap.get(task._id.toString())
    if (deps && deps.length > 0) {
      task.dependencies = deps
      await task.save()
    }
  }

  await mission.save()

  return { tasksCreated: createdTasks.length, agentsCreated }
}

/**
 * Release Squad Lead after mission completion
 */
export async function releaseSquadLead(
  squadLeadId: string,
  missionId: string
): Promise<void> {
  const squadLead = await Agent.findById(squadLeadId)
  if (!squadLead) {
    console.warn(`Squad Lead not found: ${squadLeadId}`)
    return
  }

  // Update mission history
  if (!squadLead.missionHistory.includes(missionId)) {
    squadLead.missionHistory.push(missionId)
  }
  squadLead.totalMissionsCompleted = squadLead.missionHistory.length
  squadLead.lastMissionCompletedAt = new Date()

  // Clear current mission and set to idle
  squadLead.currentMissionId = undefined
  squadLead.status = 'idle'

  await squadLead.save()

  console.log(`Squad Lead ${squadLead.name} released after mission ${missionId}`)
}

/**
 * Check if all mission tasks are completed
 */
export async function checkMissionCompletion(missionId: string): Promise<boolean> {
  const mission = await Mission.findById(missionId)
  if (!mission) {
    return false
  }

  const tasks = await Task.find({ missionId })

  // Check if all tasks are completed or failed
  const allCompleted = tasks.every(
    t => t.status === 'completed' || t.status === 'failed'
  )

  if (allCompleted && tasks.length > 0) {
    // Mark mission as completed
    mission.status = 'completed'
    mission.completedAt = new Date()
    await mission.save()

    // Release Squad Lead
    if (mission.squadLeadId) {
      await releaseSquadLead(mission.squadLeadId, missionId)
    }

    await addOrchestrationLog(missionId, {
      action: 'mission_completed',
      details: {
        totalTasks: tasks.length,
        completedTasks: tasks.filter(t => t.status === 'completed').length,
        failedTasks: tasks.filter(t => t.status === 'failed').length
      }
    })

    console.log(`Mission ${missionId} marked as completed`)
    return true
  }

  return false
}

/**
 * Add entry to orchestration log
 */
async function addOrchestrationLog(
  missionId: string,
  entry: OrchestrationLogEntry
): Promise<void> {
  const mission = await Mission.findById(missionId)
  if (!mission) {
    console.warn(`Mission not found for orchestration log: ${missionId}`)
    return
  }

  mission.orchestrationLog.push({
    timestamp: entry.timestamp || new Date(),
    action: entry.action,
    details: entry.details
  })

  await mission.save()
}
