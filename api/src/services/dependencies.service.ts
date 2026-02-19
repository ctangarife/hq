import Task from '../models/Task.js'
import Mission from '../models/Mission.js'

/**
 * Task Dependencies Service
 *
 * Maneja la lógica de dependencias entre tareas, validación de DAG,
 * y ejecución paralela de tareas independientes.
 */

export interface TaskNode {
  taskId: string
  title: string
  status: string
  dependencies: string[]
  level: number  // Nivel en el DAG (para layout)
  canExecute: boolean
  blockingReason?: string
}

export interface DAGEdge {
  from: string  // taskId
  to: string    // taskId
  status: 'valid' | 'blocked' | 'completed'
}

export interface DAGGraph {
  nodes: TaskNode[]
  edges: DAGEdge[]
  levels: number  // Máximo nivel de profundidad
  hasCycles: boolean
  cycles: string[][]  // Ciclos detectados (array de taskIds)
}

class TaskDependenciesService {

  /**
   * Obtener el grafo DAG de todas las tareas de una misión
   */
  async getMissionDAG(missionId: string): Promise<DAGGraph> {
    const tasks = await Task.find({ missionId })

    const nodes: TaskNode[] = []
    const edges: DAGEdge[] = []
    const cycles: string[][] = []

    // Build nodes
    for (const task of tasks) {
      const canExecuteResult = await task.canExecute()
      const level = await task.getDAGLevel()

      nodes.push({
        taskId: task._id.toString(),
        title: task.title,
        status: task.status,
        dependencies: task.dependencies || [],
        level,
        canExecute: canExecuteResult.canExecute,
        blockingReason: canExecuteResult.reason
      })

      // Build edges
      if (task.dependencies) {
        for (const depId of task.dependencies) {
          const depTask = tasks.find(t => t._id.toString() === depId)
          if (depTask) {
            edges.push({
              from: depId,
              to: task._id.toString(),
              status: depTask.status === 'completed' ? 'completed' :
                      task.status === 'pending' ? 'blocked' : 'valid'
            })
          }
        }
      }
    }

    // Detect cycles
    for (const task of tasks) {
      const cycle = await task.detectCircularDependency()
      if (cycle) {
        cycles.push(cycle)
      }
    }

    const maxLevel = Math.max(...nodes.map(n => n.level), 0)

    return {
      nodes,
      edges,
      levels: maxLevel + 1,
      hasCycles: cycles.length > 0,
      cycles
    }
  }

  /**
   * Validar que no haya dependencias circulares
   */
  async validateNoCircularDependencies(missionId: string): Promise<{
    valid: boolean
    cycles: string[][]
  }> {
    const tasks = await Task.find({ missionId })
    const cycles: string[][] = []

    for (const task of tasks) {
      const cycle = await task.detectCircularDependency()
      if (cycle) {
        cycles.push(cycle)
      }
    }

    return {
      valid: cycles.length === 0,
      cycles
    }
  }

  /**
   * Obtener tareas que pueden ejecutarse en paralelo
   * (dependencias completadas y estatus pending)
   */
  async getExecutableTasks(missionId: string): Promise<any[]> {
    const tasks = await Task.find({ missionId, status: 'pending' })
    const executableTasks: any[] = []

    for (const task of tasks) {
      const canExecuteResult = await task.canExecute()
      if (canExecuteResult.canExecute) {
        executableTasks.push(task)
      }
    }

    return executableTasks
  }

  /**
   * Obtener tareas bloqueadas y sus razones
   */
  async getBlockedTasks(missionId: string): Promise<Array<{
    task: any
    reason: string
    blockingTasks: any[]
  }>> {
    const tasks = await Task.find({ missionId, status: 'pending' })
    const blockedTasks: Array<{
      task: any
      reason: string
      blockingTasks: any[]
    }> = []

    for (const task of tasks) {
      const canExecuteResult = await task.canExecute()

      if (!canExecuteResult.canExecute) {
        // Obtener tareas que están bloqueando
        const blockingTasks: any[] = []

        if (task.dependencies && task.dependencies.length > 0) {
          for (const depId of task.dependencies) {
            const depTask = await Task.findById(depId)
            if (depTask && depTask.status !== 'completed') {
              blockingTasks.push(depTask)
            }
          }
        }

        blockedTasks.push({
          task,
          reason: canExecuteResult.reason || 'Unknown',
          blockingTasks
        })
      }
    }

    return blockedTasks
  }

  /**
   * Calcular el camino crítico (longest path through DAG)
   */
  async getCriticalPath(missionId: string): Promise<any[]> {
    const tasks = await Task.find({ missionId })

    // Obtener tareas terminales (sin downstream)
    const terminalTasks: any[] = []
    for (const task of tasks) {
      const dependents = await task.getDependentTasks()
      if (dependents.length === 0) {
        terminalTasks.push(task)
      }
    }

    // Función recursiva para calcular最长路径
    const calculatePath = async (task: any, visited = new Set<string>()): Promise<number[]> => {
      const taskId = task._id.toString()

      if (visited.has(taskId)) {
        return []  // Ciclo detectado
      }

      visited.add(taskId)

      if (!task.dependencies || task.dependencies.length === 0) {
        return [taskId]
      }

      let longestPath: number[] = []
      let maxLength = 0

      for (const depId of task.dependencies) {
        const depTask = tasks.find(t => t._id.toString() === depId)
        if (depTask) {
          const path = await calculatePath(depTask, new Set(visited))
          if (path.length > maxLength) {
            longestPath = path
            maxLength = path.length
          }
        }
      }

      return [...longestPath, taskId]
    }

    // Encontrar el camino más largo entre todas las tareas terminales
    let criticalPath: number[] = []
    let maxLength = 0

    for (const terminalTask of terminalTasks) {
      const path = await calculatePath(terminalTask)
      if (path.length > maxLength) {
        criticalPath = path
        maxLength = path.length
      }
    }

    // Convertir IDs a tareas completas
    return criticalPath.map(id => tasks.find(t => t._id.toString() === id)).filter(Boolean)
  }

  /**
   * Obtener estadísticas de dependencias de una misión
   */
  async getDependencyStats(missionId: string): Promise<{
    totalTasks: number
    tasksWithDependencies: number
    averageDependencies: number
    maxDependencies: number
    parallelismPotential: number  // Máximo número de tareas que pueden correr en paralelo
    currentBlocking: number  // Tareas bloqueadas ahora
  }> {
    const tasks = await Task.find({ missionId })

    const tasksWithDependencies = tasks.filter(t => t.dependencies && t.dependencies.length > 0)
    const totalDeps = tasksWithDependencies.reduce((sum, t) => sum + (t.dependencies?.length || 0), 0)
    const averageDependencies = tasksWithDependencies.length > 0 ? totalDeps / tasksWithDependencies.length : 0
    const maxDependencies = Math.max(...tasks.map(t => t.dependencies?.length || 0), 0)

    // Obtener tareas ejecutables en paralelo ahora
    const executableTasks = await this.getExecutableTasks(missionId)

    // Obtener tareas bloqueadas
    const blockedTasks = await this.getBlockedTasks(missionId)

    return {
      totalTasks: tasks.length,
      tasksWithDependencies: tasksWithDependencies.length,
      averageDependencies: Math.round(averageDependencies * 100) / 100,
      maxDependencies,
      parallelismPotential: executableTasks.length,
      currentBlocking: blockedTasks.length
    }
  }

  /**
   * Verificar si una misión puede proceder (tareas ready disponibles)
   */
  async canMissionProceed(missionId: string): Promise<{
    canProceed: boolean
    executableTasks: number
    blockedTasks: number
    message: string
  }> {
    const executable = await this.getExecutableTasks(missionId)
    const blocked = await this.getBlockedTasks(missionId)

    if (executable.length === 0 && blocked.length === 0) {
      // No hay tareas pendientes
      return {
        canProceed: false,
        executableTasks: 0,
        blockedTasks: 0,
        message: 'No pending tasks'
      }
    }

    if (executable.length > 0) {
      return {
        canProceed: true,
        executableTasks: executable.length,
        blockedTasks: blocked.length,
        message: `${executable.length} tasks ready to execute`
      }
    }

    return {
      canProceed: false,
      executableTasks: 0,
      blockedTasks: blocked.length,
      message: `${blocked.length} tasks blocked, ${blocked[0].reason}`
    }
  }
}

export const taskDependenciesService = new TaskDependenciesService()
