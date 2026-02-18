import { EventEmitter } from 'events'

/**
 * Task Events Service
 * Emite eventos cuando las tareas cambian para SSE streaming
 */
class TaskEventsService extends EventEmitter {
  private clients: Set<any> = new Set()
  private taskSubscriptions: Map<string, Set<(event: any) => void>> = new Map()

  constructor() {
    super()
    this.setMaxListeners(100) // Permitir muchos listeners SSE
  }

  /**
   * Registrar un cliente SSE (response object)
   */
  registerClient(client: any): void {
    this.clients.add(client)

    // Enviar lista inicial de tareas
    this.emitToClient(client, {
      type: 'connected',
      message: 'Connected to task updates stream',
      timestamp: Date.now()
    })
  }

  /**
   * Desregistrar un cliente SSE
   */
  unregisterClient(client: any): void {
    this.clients.delete(client)
  }

  /**
   * Emitir evento a todos los clientes conectados
   */
  emitToAll(event: TaskEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`

    this.clients.forEach(client => {
      try {
        client.write(data)
      } catch (error) {
        // Cliente desconectado, remover
        this.clients.delete(client)
      }
    })
  }

  /**
   * Emitir evento a un cliente específico
   */
  private emitToClient(client: any, event: TaskEvent): void {
    try {
      client.write(`data: ${JSON.stringify(event)}\n\n`)
    } catch (error) {
      // Cliente desconectado
      this.clients.delete(client)
    }
  }

  /**
   * Eventos específicos de tareas
   */
  emitTaskCreated(task: any): void {
    this.emitToAll({
      type: 'task.created',
      data: task,
      timestamp: Date.now()
    })
  }

  emitTaskUpdated(task: any): void {
    this.emitToAll({
      type: 'task.updated',
      data: task,
      timestamp: Date.now()
    })
  }

  emitTaskDeleted(taskId: string): void {
    this.emitToAll({
      type: 'task.deleted',
      data: { taskId },
      timestamp: Date.now()
    })
  }

  emitTaskStatusChanged(taskId: string, oldStatus: string, newStatus: string): void {
    this.emitToAll({
      type: 'task.status_changed',
      data: { taskId, oldStatus, newStatus },
      timestamp: Date.now()
    })
  }

  emitTaskAssigned(taskId: string, agentId: string | null): void {
    this.emitToAll({
      type: 'task.assigned',
      data: { taskId, agentId },
      timestamp: Date.now()
    })
  }

  emitTaskCompleted(task: any): void {
    this.emitToAll({
      type: 'task.completed',
      data: task,
      timestamp: Date.now()
    })
  }

  emitTaskFailed(task: any, error?: string): void {
    this.emitToAll({
      type: 'task.failed',
      data: { task, error },
      timestamp: Date.now()
    })
  }

  /**
   * Enviar heartbeat a todos los clientes
   */
  sendHeartbeat(): void {
    this.emitToAll({
      type: 'heartbeat',
      timestamp: Date.now()
    })
  }

  /**
   * Obtener número de clientes conectados
   */
  getClientCount(): number {
    return this.clients.size
  }

  /**
   * Suscribir a eventos de una tarea específica
   * Returns unsubscribe function
   */
  subscribe(taskId: string, callback: (event: any) => void): () => void {
    if (!this.taskSubscriptions.has(taskId)) {
      this.taskSubscriptions.set(taskId, new Set())
    }

    this.taskSubscriptions.get(taskId)!.add(callback)

    // Return unsubscribe function
    return () => {
      const subscribers = this.taskSubscriptions.get(taskId)
      if (subscribers) {
        subscribers.delete(callback)
        if (subscribers.size === 0) {
          this.taskSubscriptions.delete(taskId)
        }
      }
    }
  }

  /**
   * Emitir evento a todos los suscriptores de una tarea específica
   */
  emit(taskId: string, event: any): void {
    const subscribers = this.taskSubscriptions.get(taskId)
    if (subscribers) {
      subscribers.forEach(callback => {
        try {
          callback(event)
        } catch (error) {
          console.error('Error in task event callback:', error)
        }
      })
    }
  }
}

interface TaskEvent {
  type: string
  data?: any
  timestamp: number
}

// Singleton instance
export const taskEventsService = new TaskEventsService()

// Heartbeat cada 30 segundos para mantener conexiones vivas
setInterval(() => {
  taskEventsService.sendHeartbeat()
}, 30000)
