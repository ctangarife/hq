/**
 * Activity Logger Service
 * Centralized service for logging system activities
 */

import Activity from '../models/Activity.js'
import Mission from '../models/Mission.js'

export type ActivityType = 'mission' | 'task' | 'agent' | 'container'

interface LogOptions {
  type: ActivityType
  message: string
  details?: Record<string, any>
  workspaceId?: string
}

const isValidObjectId = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{24}$/.test(v)

/**
 * Log an activity event.
 *
 * El workspaceId se resuelve en este orden:
 * 1. El que venga explícito en options.workspaceId
 * 2. details.missionId → misión → workspace (eventos de misión/tarea)
 * Sin workspace queda como evento de sistema (invisible para tenants).
 */
export async function logActivity(options: LogOptions): Promise<void> {
  try {
    let workspaceId = options.workspaceId

    if (!workspaceId) {
      const mid = (options.details as any)?.missionId
      if (isValidObjectId(mid)) {
        const mission = await Mission.findById(mid).select('workspaceId').lean()
        workspaceId = mission?.workspaceId?.toString()
      }
    }

    const activity = new Activity({
      type: options.type,
      message: options.message,
      details: options.details,
      workspaceId: workspaceId || undefined
    })
    await activity.save()
  } catch (error) {
    // Don't throw errors for activity logging to avoid breaking main flows
    console.error('Failed to log activity:', error)
  }
}

/**
 * Helper functions for common activity types
 */
export const activityLog = {
  // Agent activities
  agentCreated: (agentName: string, agentRole: string, agentId: string) =>
    logActivity({
      type: 'agent',
      message: `Agente "${agentName}" (${agentRole}) creado`,
      details: { agentId, agentName, agentRole, action: 'created' }
    }),

  agentUpdated: (agentName: string, changes: Record<string, any>, agentId: string) =>
    logActivity({
      type: 'agent',
      message: `Agente "${agentName}" actualizado`,
      details: { agentId, agentName, changes, action: 'updated' }
    }),

  agentDeleted: (agentName: string, agentId: string) =>
    logActivity({
      type: 'agent',
      message: `Agente "${agentName}" eliminado`,
      details: { agentId, agentName, action: 'deleted' }
    }),

  agentDeployed: (agentName: string, containerId: string, agentId: string) =>
    logActivity({
      type: 'container',
      message: `Contenedor desplegado para agente "${agentName}"`,
      details: { agentId, agentName, containerId, action: 'deployed' }
    }),

  agentStopped: (agentName: string, agentId: string) =>
    logActivity({
      type: 'agent',
      message: `Agente "${agentName}" detenido`,
      details: { agentId, agentName, action: 'stopped' }
    }),

  agentStarted: (agentName: string, agentId: string) =>
    logActivity({
      type: 'agent',
      message: `Agente "${agentName}" iniciado`,
      details: { agentId, agentName, action: 'started' }
    }),

  // Task activities
  taskCreated: (taskTitle: string, missionId: string, taskId: string) =>
    logActivity({
      type: 'task',
      message: `Tarea "${taskTitle}" creada`,
      details: { taskId, taskTitle, missionId, action: 'created' }
    }),

  taskUpdated: (taskTitle: string, changes: Record<string, any>, taskId: string) =>
    logActivity({
      type: 'task',
      message: `Tarea "${taskTitle}" actualizada`,
      details: { taskId, taskTitle, changes, action: 'updated' }
    }),

  taskCompleted: (taskTitle: string, duration: number | undefined, taskId: string, missionId?: string) =>
    logActivity({
      type: 'task',
      message: `Tarea "${taskTitle}" completada${duration ? ` (${Math.round(duration / 1000)}s)` : ''}`,
      details: { taskId, taskTitle, duration, missionId, action: 'completed' }
    }),

  taskFailed: (taskTitle: string, error: string | undefined, taskId: string, missionId?: string) =>
    logActivity({
      type: 'task',
      message: `Tarea "${taskTitle}" fallida`,
      details: { taskId, taskTitle, error, missionId, action: 'failed' }
    }),

  taskDeleted: (taskTitle: string, taskId: string) =>
    logActivity({
      type: 'task',
      message: `Tarea "${taskTitle}" eliminada`,
      details: { taskId, taskTitle, action: 'deleted' }
    }),

  taskAssigned: (taskTitle: string, agentName: string, taskId: string, missionId?: string) =>
    logActivity({
      type: 'task',
      message: `Tarea "${taskTitle}" asignada a ${agentName}`,
      details: { taskId, taskTitle, agentName, missionId, action: 'assigned' }
    }),

  // Mission activities
  missionCreated: (missionTitle: string, missionId: string) =>
    logActivity({
      type: 'mission',
      message: `Misión "${missionTitle}" creada`,
      details: { missionId, missionTitle, action: 'created' }
    }),

  missionStarted: (missionTitle: string, missionId: string) =>
    logActivity({
      type: 'mission',
      message: `Misión "${missionTitle}" iniciada`,
      details: { missionId, missionTitle, action: 'started' }
    }),

  missionOrchestrationStarted: (missionTitle: string, squadLeadName: string, missionId: string) =>
    logActivity({
      type: 'mission',
      message: `Orquestación de misión "${missionTitle}" iniciada con Squad Lead ${squadLeadName}`,
      details: { missionId, missionTitle, squadLeadName, action: 'orchestration_started' }
    }),

  missionPaused: (missionTitle: string, reason?: string, missionId: string) =>
    logActivity({
      type: 'mission',
      message: `Misión "${missionTitle}" pausada${reason ? `: ${reason}` : ''}`,
      details: { missionId, missionTitle, reason, action: 'paused' }
    }),

  missionResumed: (missionTitle: string, missionId: string) =>
    logActivity({
      type: 'mission',
      message: `Misión "${missionTitle}" reanudada`,
      details: { missionId, missionTitle, action: 'resumed' }
    }),

  missionCancelled: (missionTitle: string, reason?: string, missionId: string) =>
    logActivity({
      type: 'mission',
      message: `Misión "${missionTitle}" cancelada${reason ? `: ${reason}` : ''}`,
      details: { missionId, missionTitle, reason, action: 'cancelled' }
    }),

  missionCompleted: (missionTitle: string, missionId: string) =>
    logActivity({
      type: 'mission',
      message: `✅ Misión "${missionTitle}" completada`,
      details: { missionId, missionTitle, action: 'completed' }
    }),

  missionDeleted: (missionTitle: string, missionId: string) =>
    logActivity({
      type: 'mission',
      message: `Misión "${missionTitle}" eliminada`,
      details: { missionId, missionTitle, action: 'deleted' }
    }),

  // Container activities
  containerRecreated: (agentName: string, newContainerId: string, agentId: string) =>
    logActivity({
      type: 'container',
      message: `Contenedor de agente "${agentName}" recreado`,
      details: { agentId, agentName, newContainerId, action: 'recreated' }
    }),

  containerDestroyed: (agentName: string, agentId: string) =>
    logActivity({
      type: 'container',
      message: `Contenedor de agente "${agentName}" destruido`,
      details: { agentId, agentName, action: 'destroyed' }
    }),

  // Generic log function for custom activity logging
  log: (options: LogOptions) => logActivity(options)
}
