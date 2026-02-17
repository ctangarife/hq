/**
 * Agent Metrics Service
 * Calculates statistics and metrics for agents
 */

import Task from '../models/Task.js'
import Agent from '../models/Agent.js'

export interface AgentMetrics {
  agentId: string
  agentName: string
  agentRole: string
  tasksCompleted: number
  tasksFailed: number
  tasksTotal: number
  successRate: number // percentage
  averageDuration: number // milliseconds
  lastActivity?: Date
  currentStatus: string
}

export interface MissionMetrics {
  missionId: string
  missionTitle: string
  tasksTotal: number
  tasksCompleted: number
  tasksFailed: number
  tasksInProgress: number
  tasksPending: number
  agentCount: number
  duration: number | null // milliseconds
}

export interface SystemMetrics {
  totalAgents: number
  activeAgents: number
  totalTasks: number
  completedTasks: number
  failedTasks: number
  averageTaskDuration: number
  topAgents: AgentMetrics[]
  tasksByType: Record<string, number>
  tasksByStatus: Record<string, number>
}

/**
 * Get metrics for a specific agent
 */
export async function getAgentMetrics(agentId: string): Promise<AgentMetrics | null> {
  const agent = await Agent.findById(agentId)
  if (!agent) {
    return null
  }

  const tasks = await Task.find({ assignedTo: agentId })

  const completedTasks = tasks.filter(t => t.status === 'completed')
  const failedTasks = tasks.filter(t => t.status === 'failed')

  // Calculate average duration
  const durations = completedTasks
    .filter(t => t.startedAt && t.completedAt)
    .map(t => t.completedAt!.getTime() - t.startedAt!.getTime())

  const averageDuration = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0

  // Get last activity
  const lastActivity = tasks.length > 0
    ? new Date(Math.max(...tasks.map(t => new Date(t.updatedAt).getTime())))
    : undefined

  const successRate = tasks.length > 0
    ? (completedTasks.length / tasks.length) * 100
    : 0

  return {
    agentId: agent._id.toString(),
    agentName: agent.name,
    agentRole: agent.role,
    tasksCompleted: completedTasks.length,
    tasksFailed: failedTasks.length,
    tasksTotal: tasks.length,
    successRate: Math.round(successRate * 10) / 10,
    averageDuration: Math.round(averageDuration),
    lastActivity,
    currentStatus: agent.status
  }
}

/**
 * Get metrics for a specific mission
 */
export async function getMissionMetrics(missionId: string): Promise<MissionMetrics | null> {
  const tasks = await Task.find({ missionId })

  if (tasks.length === 0) {
    return null
  }

  const completed = tasks.filter(t => t.status === 'completed').length
  const failed = tasks.filter(t => t.status === 'failed').length
  const inProgress = tasks.filter(t => t.status === 'in_progress').length
  const pending = tasks.filter(t => t.status === 'pending').length

  // Get unique agents
  const agentIds = new Set<string>()
  tasks.forEach(task => {
    if (task.assignedTo) {
      agentIds.add(task.assignedTo)
    }
  })

  // Calculate duration
  const firstTask = tasks.sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )[0]

  const lastCompleted = tasks
    .filter(t => t.status === 'completed' && t.completedAt)
    .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())[0]

  const duration = lastCompleted?.completedAt && firstTask
    ? lastCompleted.completedAt.getTime() - new Date(firstTask.createdAt).getTime()
    : null

  return {
    missionId,
    missionTitle: firstTask?.missionId || missionId, // Would need Mission model for title
    tasksTotal: tasks.length,
    tasksCompleted: completed,
    tasksFailed: failed,
    tasksInProgress: inProgress,
    tasksPending: pending,
    agentCount: agentIds.size,
    duration
  }
}

/**
 * Get system-wide metrics
 */
export async function getSystemMetrics(options: {
  startDate?: Date
  endDate?: Date
} = {}): Promise<SystemMetrics> {
  const { startDate, endDate } = options

  const dateFilter: any = {}
  if (startDate || endDate) {
    if (startDate) dateFilter.$gte = startDate
    if (endDate) dateFilter.$lte = endDate
  }

  // Build task filter
  const taskFilter: any = {}
  if (Object.keys(dateFilter).length > 0) {
    taskFilter.createdAt = dateFilter
  }

  const [agents, tasks] = await Promise.all([
    Agent.find(),
    Task.find(taskFilter)
  ])

  const activeAgents = agents.filter(a => a.status === 'active' || a.status === 'idle').length

  const completedTasks = tasks.filter(t => t.status === 'completed')
  const failedTasks = tasks.filter(t => t.status === 'failed')

  // Calculate average task duration
  const durations = completedTasks
    .filter(t => t.startedAt && t.completedAt)
    .map(t => t.completedAt!.getTime() - t.startedAt!.getTime())

  const averageTaskDuration = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0

  // Get top agents by completed tasks
  const agentMetricsPromises = agents.map(agent => getAgentMetrics(agent._id.toString()))
  const agentMetricsResults = await Promise.all(agentMetricsPromises)
  const topAgents = agentMetricsResults
    .filter((m): m is AgentMetrics => m !== null && m.tasksTotal > 0)
    .sort((a, b) => b.tasksCompleted - a.tasksCompleted)
    .slice(0, 10)

  // Tasks by type
  const tasksByType: Record<string, number> = {}
  tasks.forEach(task => {
    tasksByType[task.type] = (tasksByType[task.type] || 0) + 1
  })

  // Tasks by status
  const tasksByStatus: Record<string, number> = {}
  tasks.forEach(task => {
    tasksByStatus[task.status] = (tasksByStatus[task.status] || 0) + 1
  })

  return {
    totalAgents: agents.length,
    activeAgents,
    totalTasks: tasks.length,
    completedTasks: completedTasks.length,
    failedTasks: failedTasks.length,
    averageTaskDuration: Math.round(averageTaskDuration),
    topAgents,
    tasksByType,
    tasksByStatus
  }
}

/**
 * Get metrics for all agents
 */
export async function getAllAgentsMetrics(): Promise<AgentMetrics[]> {
  const agents = await Agent.find()

  const metricsPromises = agents.map(agent => getAgentMetrics(agent._id.toString()))
  const results = await Promise.all(metricsPromises)

  return results.filter((m): m is AgentMetrics => m !== null)
}
