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
import Mission from '../models/Mission.js'
import { dockerService } from './docker.service.js'
import { taskEventsService } from './task-events.service.js'
import { agentScoringService } from './agent-scoring.service.js'
import Agent from '../models/Agent.js'

// Tipos de tarea que ejecutan los especialistas (Goose efímero)
const SPECIALIST_TASK_TYPES: TaskType[] = [
  'web_search',
  'data_analysis',
  'content_generation',
  'image_prompt',
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
    await taskEventsService.emitTaskUpdated(task._id.toString(), {
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

      // 2b. Cargar la misión: el especialista necesita el CONTEXTO COMPLETO
      // del brief (público, audiencia, tono) — no solo el título resumido de
      // la tarea. Sin esto, el writer "desvía" del brief (ej: habló de curso
      // en vez de early access) porque el plan del Squad Lead resume.
      const mission = await Mission.findById(task.missionId).lean()

      // 3. Construir el prompt: personalidad + brief completo + tarea
      const prompt = this.buildSpecialistPrompt(task, agent, mission)
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
      await taskEventsService.emitTaskUpdated(task._id.toString(), {
        status: 'completed',
        output: task.output,
      })
    } catch (error: any) {
      console.error(`[dispatcher] task ${task._id} failed:`, error.message)
      task.status = 'failed'
      task.error = error.message
      task.output = { success: false, error: error.message }
      await task.save()
      await taskEventsService.emitTaskUpdated(task._id.toString(), {
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
  private buildSpecialistPrompt(task: ITask, agent: any, mission?: any): string {
    const personality = agent?.personality ||
      'You are a helpful AI assistant. Respond in Spanish.'

    // La instrucción de output va PRIMERO: es la que más pesa en el modelo.
    // glm-4.7+Goose tiende a "planificar" o "delegar" la tarea en vez de
    // ejecutarla; sin esto el entregable llega contaminado con planes/TODOs.
    let prompt = `ENTREGA DIRECTAMENTE EL CONTENUTO FINAL PEDIDO. Tu respuesta ES el entregable — no un plan, no un análisis, no una propuesta. Si te piden un post, tu respuesta empieza con el post mismo.

`
    prompt += `${personality}\n\n`

    // CONTEXTO COMPLETO DE LA MISIÓN: audiencia, tono y brief original.
    // El título de la tarea es un resumen del plan — sin el brief, el
    // especialista desvía el mensaje (ej: "curso" vs "early access").
    if (mission) {
      prompt += `# Contexto del proyecto (BRIEF — cíñete estrictamente a esto)\n`
      prompt += `**Producto/Misión:** ${mission.title}\n\n`
      if (mission.description) {
        prompt += `${mission.description}\n\n`
      }
      if (mission.audience) {
        prompt += `**Audiencia:** ${mission.audience}\n\n`
      }
      if (mission.tone) {
        prompt += `**Tono obligatorio:** ${mission.tone}\n\n`
      }
      if (mission.context) {
        prompt += `**Contexto adicional:** ${mission.context}\n\n`
      }
      prompt += `**REGLA DE FIDELIDAD:** No inventes objetivos que no están en el brief. Cada pieza que produzcas debe servir EXACTAMENTE al propósito descrito arriba.\n\n`

      // ESTILO EDITORIAL HQ (reglas de estilo universales para contenido de
      // negocios locales — nacidas de feedback profesional real: el contenido
      // "marketero genérico" dice lo mismo que cualquier bar y no convence).
      prompt += `**ESTILO EDITORIAL OBLIGATORIO:**
1. ESPECÍFICO > GENÉRICO. Prohibidas las frases marketeras vacías: "experiencia única", "gastronomía que sorprende", "el sabor se une con el ambiente", "un evento inolvidable", "de primera". Úsa SIEMPRE nombres propios y datos concretos: el nombre del producto, del plato, del aliado, el precio, el barrio. Si un dato específico falta, escribe un placeholder explícito tipo [DATO: nombre de la cerveza] — nunca lo sustituyas con una frase genérica.
2. VOZ. Usa el tratamiento que el brief indique. Por defecto en Colombia (especialmente Antioquia/Eje Cafetero): USTEDEO ("lo invitamos", "no se lo pierda", "su parche"). NUNCA voseo ("activá", "no te lo perdás") salvo que la marca lo pida.
3. EMOJIS. Máximo 2 en toda la pieza, usados con moderación como firma de la marca — nunca decorando cada línea. Si la marca no define sus emojis, deja placeholders [EMOJI FIRMA] donde aporten.
4. LA PREGUNTA REAL. Cada pieza debe responder qué hay EN ESTE lugar que justifica que el cliente vaya hasta allí (su producto concreto, su razón de viaje), no describir atmósferas que valdrían para cualquier bar de la ciudad.
5. HASHTAGS. Solo ultra-locales (barrio, ciudad, zona). Sin hashtags masivos o genéricos (#CraftBeer #SaturdayVibes #GastroBar): traen alcance de gente que nunca irá.\n\n`
    }

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

    // Tras completar, verificar si la misión debe cerrarse (y limpiar a los
    // especialistas — ciclo de vida efímero). Import dinámico para evitar
    // circularidad: orchestration.service importa este módulo.
    try {
      const { checkMissionCompletion } = await import('./orchestration.service.js')
      await checkMissionCompletion(missionId)
    } catch (err: any) {
      console.error('[dispatcher] mission completion check failed:', err.message)
    }
  }
}

export const taskDispatcherService = new TaskDispatcherService()
export default taskDispatcherService
