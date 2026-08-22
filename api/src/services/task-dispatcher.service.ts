/**
 * TaskDispatcherService - Decide cómo ejecutar cada tarea
 *
 * Arquitectura híbrida Goose:
 *   - Squad Lead, Auditor     → agentes persistentes (polling loop, estado entre tareas)
 *   - Researcher, Writer,
 *     Developer, Analyst      → container efímero Goose (runEphemeralTask, 1 tarea = 1 container)
 *
 * Este servicio es el punto único de decisión: dada una tarea, determina si
 * debe ejecutarse inline (Goose efímero) o dejarse para un agente persistente
 * (que la tomará vía polling).
 *
 * Los tipos de tarea que van a Goose efímero son los "especialistas":
 *   web_search, data_analysis, content_generation, code_execution, custom
 *
 * Los tipos que quedan en agentes persistentes:
 *   mission_analysis (Squad Lead), auditor_review (Auditor), human_input
 */

import Task, { ITask, TaskType } from '../models/Task.js'
import { dockerService } from './docker.service.js'
import { taskEventsService } from './task-events.service.js'
import { agentScoringService } from './agent-scoring.service.js'
import Agent from '../models/Agent.js'

// Tipos de tarea que ejecutan los especialistas (Goose efímero)
const SPECIALIST_TASK_TYPES: TaskType[] = [
  'web_search',
  'data_analysis',
  'content_generation',
  'code_execution',
  'custom',
]

class TaskDispatcherService {
  /**
   * Verificar si una tarea debe ejecutarse vía Goose efímero.
   */
  isSpecialistTask(task: { type: string }): boolean {
    return SPECIALIST_TASK_TYPES.includes(task.type as TaskType)
  }

  /**
   * Ejecutar UNA tarea de especialista en un container Goose efímero.
   *
   * Flujo:
   *   1. Marcar tarea como in_progress
   *   2. Construir el prompt con el template del agente + la tarea
   *   3. dockerService.runEphemeralTask(prompt) → output
   *   4. Marcar tarea como completed (o failed si algo falla)
   *   5. Emitir evento para que el frontend actualice en tiempo real
   *
   * No usa polling: la API decide cuándo ejecutar y lo hace directo.
   */
  async executeSpecialistTask(task: ITask): Promise<void> {
    console.log(`[dispatcher] executing specialist task ${task._id} (${task.type})`)

    // 1. Marcar in_progress
    task.status = 'in_progress'
    task.startedAt = new Date()
    await task.save()
    await taskEventsService.emitTaskUpdate(task._id.toString(), {
      status: 'in_progress',
      message: 'Executing in ephemeral Goose container',
    })

    try {
      // 2. Resolver el agente para obtener su personalidad/template
      let agent: any = null
      if (task.assignedTo) {
        agent = await Agent.findOne({
          $or: [
            { _id: task.assignedTo },
            { containerId: task.assignedTo },
          ],
        }).lean()
      }

      // 3. Construir el prompt: personalidad del agente + datos de la tarea
      const prompt = this.buildSpecialistPrompt(task, agent)
      const model = agent?.llmModel || undefined

      // 4. Ejecutar en Goose efímero
      const output = await dockerService.runEphemeralTask(prompt, {
        model,
        workspaceId: task.input?.workspaceId,
      })

      console.log(`[dispatcher] task ${task._id} completed (${output.length} chars)`)

      // 5. Marcar completed
      task.status = 'completed'
      task.completedAt = new Date()
      task.output = {
        success: true,
        result: output,
        duration: task.startedAt
          ? Date.now() - task.startedAt.getTime()
          : 0,
      }
      await task.save()
      await taskEventsService.emitTaskUpdate(task._id.toString(), {
        status: 'completed',
        output: task.output,
      })
    } catch (error: any) {
      console.error(`[dispatcher] task ${task._id} failed:`, error.message)
      task.status = 'failed'
      task.error = error.message
      task.output = { success: false, error: error.message }
      await task.save()
      await taskEventsService.emitTaskUpdate(task._id.toString(), {
        status: 'failed',
        error: error.message,
      })

      // Delegar el manejo de reintentos al flujo existente
      // (el polling skill o el endpoint /fail creará la auditoría si se agotan)
    }
  }

  /**
   * Construir el prompt que se pasa a Goose para una tarea de especialista.
   * Combina la personalidad del agente (template) con los datos de la tarea.
   *
   * CONTRACTO sobre agent.personality (importante):
   * El `personality` del agente YA fue resuelto desde MongoDB
   * (promptService.getPrompt) en el momento de crearlo — ver
   * orchestration.service.ts → processSquadLeadOutput(). Los agentes son
   * efímeros, así que NO se re-resuelve el prompt aquí en cada tarea: una
   * edición en la colección `prompts` se refleja la próxima vez que se crea
   * un agente, no en medio de una misión en curso.
   *
   * Goose recibe todo por stdin como un prompt plano.
   */
  private buildSpecialistPrompt(task: ITask, agent: any): string {
    const personality = agent?.personality ||
      'You are a helpful AI assistant. Respond in Spanish.'

    // La instrucción de output va PRIMERO: es la que más pesa en el modelo.
    // glm-4.7+Goose tiende a "planificar" o "delegar" la tarea en vez de
    // ejecutarla; sin esto el entregable llega contaminado con planes/TODOs.
    let prompt = `ENTREGA DIRECTAMENTE EL CONTENUTO FINAL PEDIDO. Tu respuesta ES el entregable — no un plan, no un análisis, no una propuesta. Si te piden un post, tu respuesta empieza con el post mismo.

`
    prompt += `${personality}\n\n`
    prompt += `# Tarea: ${task.title}\n\n`

    if (task.description) {
      prompt += `${task.description}\n\n`
    }

    if (task.input && Object.keys(task.input).length > 0) {
      prompt += `## Datos de entrada\n\`\`\`json\n`
      prompt += JSON.stringify(task.input, null, 2)
      prompt += `\n\`\`\`\n\n`
    }

    prompt += `## Instrucciones de entrega (CRÍTICAS)
- Entrega ÚNICAMENTE el contenido final solicitado en tu respuesta.
- NO incluyas planes de ejecución, análisis previos, listas de tareas, TODOs ni explicaciones de tu proceso.
- NO delegues la tarea a otro agente: ejecútala tú directamente.
- NO repitas el enunciado; el entregable empieza de una.

Ejecuta esta tarea y reporta SOLO el resultado final en español.`

    return prompt
  }

  /**
   * Dispatchar todas las tareas de especialista listas para ejecutar de una misión.
   *
   * "Lista" = status pending + tipo especialista + dependencias completadas.
   * Se invoca típicamente después de que processSquadOutput crea las tareas,
   * o cuando una tarea que era dependencia se completa.
   *
   * Ejecuta en paralelo las tareas sin dependencias entre sí.
   */
  async dispatchReadySpecialistTasks(missionId: string): Promise<void> {
    const pendingTasks = await Task.find({
      missionId,
      status: 'pending',
      type: { $in: SPECIALIST_TASK_TYPES },
    })

    console.log(`[dispatcher] found ${pendingTasks.length} pending specialist tasks for mission ${missionId}`)

    // Filtrar las que tienen dependencias completas
    const ready: ITask[] = []
    for (const task of pendingTasks) {
      if (!task.dependencies || task.dependencies.length === 0) {
        ready.push(task)
        continue
      }
      const completedDeps = await Task.countDocuments({
        _id: { $in: task.dependencies },
        status: 'completed',
      })
      if (completedDeps === task.dependencies.length) {
        ready.push(task)
      }
    }

    if (ready.length === 0) {
      console.log(`[dispatcher] no ready specialist tasks for mission ${missionId}`)
      return
    }

    // Ejecutar en paralelo (cada una spawnea su propio container Goose)
    console.log(`[dispatcher] executing ${ready.length} specialist tasks in parallel`)
    await Promise.allSettled(
      ready.map(task => this.executeSpecialistTask(task)),
    )

    // Tras completar, verificar si hay misiones que marcar como completas
    // (delegado al flujo existente checkMissionCompletion)
  }
}

export const taskDispatcherService = new TaskDispatcherService()
export default taskDispatcherService
