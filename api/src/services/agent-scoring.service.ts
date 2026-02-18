import Agent from '../models/Agent.js'
import Task from '../models/Task.js'

/**
 * Agent Scoring Service
 *
 * Calcula puntajes para asignar el mejor agente a cada tarea
 * basándose en rol, capacidades, disponibilidad e historial.
 */

export interface AgentScore {
  agentId: string
  agentName: string
  role: string
  score: number
  breakdown: {
    roleMatch: number      // 0-40 points
    availability: number   // 0-30 points
    successRate: number    // 0-20 points
    workload: number       // -10 to 0 points
  }
  reasons: string[]
}

export interface ScoringCriteria {
  taskType?: string          // Tipo de tarea para match de rol
  requiredCapabilities?: string[]  // Capacidades requeridas
  preferredAgentId?: string  // Preferencia de agente específico
  missionId?: string         // Misión actual (para evitar conflictos)
}

class AgentScoringService {

  /**
   * Calcular puntajes para todos los agentes disponibles
   */
  async scoreAgents(criteria: ScoringCriteria): Promise<AgentScore[]> {
    // Buscar agentes activos y reutilizables
    const agents = await Agent.find({
      status: { $in: ['idle', 'active'] },
      isReusable: true
    })

    const scores: AgentScore[] = []

    for (const agent of agents) {
      const score = await this.scoreAgent(agent, criteria)
      scores.push(score)
    }

    // Ordenar por puntaje descendente
    scores.sort((a, b) => b.score - a.score)

    return scores
  }

  /**
   * Calcular puntaje para un agente específico
   */
  async scoreAgent(agent: any, criteria: ScoringCriteria): Promise<AgentScore> {
    let score = 0
    const reasons: string[] = []

    // 1. Role/Capability Match (0-40 points)
    const roleMatch = this.calculateRoleMatch(agent, criteria)
    score += roleMatch.score
    reasons.push(...roleMatch.reasons)

    // 2. Availability (0-30 points)
    const availability = this.calculateAvailability(agent, criteria)
    score += availability.score
    reasons.push(...availability.reasons)

    // 3. Success Rate (0-20 points)
    const successRate = this.calculateSuccessRate(agent)
    score += successRate.score
    reasons.push(...successRate.reasons)

    // 4. Workload Penalty (0 to -10 points)
    const workload = await this.calculateWorkload(agent)
    score += workload.score
    reasons.push(...workload.reasons)

    return {
      agentId: agent._id.toString(),
      agentName: agent.name,
      role: agent.role,
      score: Math.max(0, Math.min(100, score)), // Clamp between 0-100
      breakdown: {
        roleMatch: roleMatch.score,
        availability: availability.score,
        successRate: successRate.score,
        workload: workload.score
      },
      reasons
    }
  }

  /**
   * Calcular match de rol/capacidades (0-40 points)
   */
  private calculateRoleMatch(agent: any, criteria: ScoringCriteria): { score: number, reasons: string[] } {
    let score = 0
    const reasons: string[] = []

    // Si hay un agente preferido, darle máximo puntaje
    if (criteria.preferredAgentId && agent._id.toString() === criteria.preferredAgentId) {
      score = 40
      reasons.push('Agente preferido seleccionado')
      return { score, reasons }
    }

    // Match por tipo de tarea a rol
    if (criteria.taskType) {
      const taskRoleMap: Record<string, string> = {
        'web_search': 'researcher',
        'data_analysis': 'analyst',
        'content_generation': 'writer',
        'code_execution': 'developer',
        'code_review': 'developer',
        'mission_analysis': 'squad_lead',
        'agent_creation': 'squad_lead',
        'coordination': 'squad_lead'
      }

      const preferredRole = taskRoleMap[criteria.taskType]
      if (preferredRole && agent.role === preferredRole) {
        score += 30
        reasons.push(`Rol "${agent.role}" es ideal para tarea "${criteria.taskType}"`)
      } else if (agent.role === 'squad_lead') {
        // Squad Lead puede hacer cualquier tarea pero con menor prioridad
        score += 10
        reasons.push('Squad Lead puede ejecutar tarea')
      }
    }

    // Match por capacidades requeridas
    if (criteria.requiredCapabilities && criteria.requiredCapabilities.length > 0) {
      const agentCapabilities = agent.capabilities || []
      const matchedCapabilities = criteria.requiredCapabilities.filter(cap =>
        agentCapabilities.some((ac: string) => ac.toLowerCase().includes(cap.toLowerCase()))
      )

      const matchPercentage = matchedCapabilities.length / criteria.requiredCapabilities.length
      score += Math.round(matchPercentage * 10)

      if (matchedCapabilities.length > 0) {
        reasons.push(`Tiene ${matchedCapabilities.length}/${criteria.requiredCapabilities.length} capacidades requeridas`)
      }
    }

    // Puntaje base si tiene capacidades generales
    if (agent.capabilities && agent.capabilities.length > 0) {
      score += Math.min(10, agent.capabilities.length * 2)
      reasons.push(`Tiene ${agent.capabilities.length} capacidades generales`)
    }

    return { score: Math.min(40, score), reasons }
  }

  /**
   * Calcular disponibilidad (0-30 points)
   */
  private calculateAvailability(agent: any, criteria: ScoringCriteria): { score: number, reasons: string[] } {
    let score = 0
    const reasons: string[] = []

    // Si está idle, tiene máxima disponibilidad
    if (agent.status === 'idle') {
      score += 20
      reasons.push('Agente disponible (idle)')
    } else if (agent.status === 'active') {
      // Active pero podría estar disponible
      score += 10
      reasons.push('Agente activo pero puede tomar tarea')
    }

    // Si no tiene misión actual, bonus
    if (!agent.currentMissionId) {
      score += 10
      reasons.push('Sin misión asignada')
    }

    // Si está en la misma misión que la tarea, penalty (quiere diversidad)
    if (criteria.missionId && agent.currentMissionId === criteria.missionId) {
      score -= 5
      reasons.push('Ya trabaja en esta misión')
    }

    return { score: Math.max(0, Math.min(30, score)), reasons }
  }

  /**
   * Calcular historial de éxito (0-20 points)
   */
  private calculateSuccessRate(agent: any): { score: number, reasons: string[] } {
    let score = 0
    const reasons: string[] = []

    const successRate = agent.successRate || 100
    const tasksCompleted = agent.tasksCompleted || 0

    // Puntaje basado en tasa de éxito
    score += Math.round((successRate / 100) * 10)

    if (successRate >= 90) {
      reasons.push(`Excelente tasa de éxito: ${successRate}%`)
    } else if (successRate >= 70) {
      reasons.push(`Buena tasa de éxito: ${successRate}%`)
    } else if (successRate < 50) {
      reasons.push(`Tasa de éxito baja: ${successRate}%`)
    }

    // Bonus por experiencia (tareas completadas)
    if (tasksCompleted >= 10) {
      score += 10
      reasons.push(`Muy experimentado: ${tasksCompleted} tareas completadas`)
    } else if (tasksCompleted >= 5) {
      score += 7
      reasons.push(`Experimentado: ${tasksCompleted} tareas completadas`)
    } else if (tasksCompleted >= 1) {
      score += 4
      reasons.push(`Algo de experiencia: ${tasksCompleted} tareas completadas`)
    } else {
      reasons.push('Sin experiencia previa')
    }

    return { score: Math.min(20, score), reasons }
  }

  /**
   * Calcular carga de trabajo actual (-10 to 0 points)
   */
  private async calculateWorkload(agent: any): Promise<{ score: number, reasons: string[] }> {
    let score = 0
    const reasons: string[] = []

    // Contar tareas pendientes asignadas a este agente
    const pendingTasks = await Task.countDocuments({
      assignedTo: agent._id.toString(),
      status: { $in: ['pending', 'in_progress'] }
    })

    // Penalty por cada tarea pendiente
    const penalty = Math.min(10, pendingTasks * 5)
    score -= penalty

    if (pendingTasks === 0) {
      reasons.push('Sin carga de trabajo actual')
    } else if (pendingTasks <= 2) {
      reasons.push(`${pendingTasks} tarea(s) pendiente(s)`)
    } else {
      reasons.push(`${pendingTasks} tareas pendientes - carga alta`)
    }

    return { score, reasons }
  }

  /**
   * Obtener el mejor agente para una tarea
   */
  async getBestAgent(criteria: ScoringCriteria): Promise<AgentScore | null> {
    const scores = await this.scoreAgents(criteria)

    if (scores.length === 0) {
      return null
    }

    return scores[0] // Primer elemento tiene mayor puntaje
  }

  /**
   * Actualizar métricas de un agente después de completar una tarea
   */
  async updateAgentMetrics(agentId: string, taskStatus: 'completed' | 'failed', duration: number): Promise<void> {
    const agent = await Agent.findById(agentId)

    if (!agent) {
      console.warn(`Agent ${agentId} not found for metrics update`)
      return
    }

    // Actualizar contadores
    if (taskStatus === 'completed') {
      agent.tasksCompleted = (agent.tasksCompleted || 0) + 1
    } else {
      agent.tasksFailed = (agent.tasksFailed || 0) + 1
    }

    // Actualizar duración total
    agent.totalDuration = (agent.totalDuration || 0) + duration

    // Calcular nueva duración promedio
    const totalTasks = (agent.tasksCompleted || 0) + (agent.tasksFailed || 0)
    agent.averageDuration = totalTasks > 0 ? Math.round(agent.totalDuration / totalTasks) : 0

    // Calcular nueva tasa de éxito
    if (totalTasks > 0) {
      agent.successRate = Math.round((agent.tasksCompleted / totalTasks) * 100)
    }

    // Actualizar timestamp
    if (taskStatus === 'completed') {
      agent.lastTaskCompletedAt = new Date()
    }

    await agent.save()

    console.log(`✅ Updated metrics for agent ${agent.name}: ${taskStatus}, duration: ${duration}ms`)
  }
}

export const agentScoringService = new AgentScoringService()
