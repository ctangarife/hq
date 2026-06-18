import Prompt, { PromptKey } from '../models/Prompt.js'

/**
 * PromptService - Resolución de prompts editables con cascada por capas
 *
 * Jerarquía de resolución (más específico gana):
 *   1. Project   → prompt específico de un proyecto
 *   2. Workspace → prompt específico de un workspace
 *   3. Global    → default del sistema (seed inicial)
 *
 * Mismo patrón que litellmService.getKey(): el contexto (workspaceId,
 * projectId) determina qué prompt se devuelve, con fallback a la capa
 * superior. Esto permite que un workspace manager refine prompts sin
 * tocar el default global, y un project owner los refine aún más.
 *
 * Variables: los placeholders {{agentName}}, {{missionTitle}}, etc. se
 * reemplazan con los valores del contexto antes de devolver el prompt.
 */

class PromptService {
  private cache: Map<string, { prompt: string; expiresAt: number }> = new Map()
  private readonly CACHE_TTL_MS = 30_000 // 30s — prompts cambian poco, pero editables

  /**
   * Obtener un prompt resuelto por capas, con variables reemplazadas.
   *
   * @param key - 'squad_lead', 'mission_analysis', 'researcher', etc.
   * @param context - { workspaceId?, projectId?, agentName?, missionTitle?, ... }
   * @returns el content del prompt con variables reemplazadas
   */
  async getPrompt(
    key: PromptKey | string,
    context: {
      workspaceId?: string
      projectId?: string
      [varName: string]: any
    } = {},
  ): Promise<string> {
    // 1. Resolver el prompt crudo por capas (project → workspace → global)
    const rawPrompt = await this.resolvePrompt(key, context.workspaceId, context.projectId)

    // 2. Reemplazar variables {{var}} con los valores del contexto
    return this.fillVariables(rawPrompt, context)
  }

  /**
   * Resolución por capas: busca el prompt más específico que exista.
   * No reemplaza variables — devuelve el content crudo.
   */
  private async resolvePrompt(
    key: string,
    workspaceId?: string,
    projectId?: string,
  ): Promise<string> {
    // Cache key (incluye el contexto para no cachear mal entre capas)
    const cacheKey = `${key}:${workspaceId || ''}:${projectId || ''}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.prompt
    }

    let prompt: any = null

    // Capa 1: Project (más específico)
    if (projectId) {
      prompt = await Prompt.findOne({ key, scope: 'project', projectId, active: true }).lean()
    }

    // Capa 2: Workspace
    if (!prompt && workspaceId) {
      prompt = await Prompt.findOne({ key, scope: 'workspace', workspaceId, active: true }).lean()
    }

    // Capa 3: Global (default del sistema)
    if (!prompt) {
      prompt = await Prompt.findOne({ key, scope: 'global', active: true }).lean()
    }

    // Fallback último: si ni siquiera hay global (no se seedeó), devolver un mínimo
    if (!prompt) {
      console.warn(`[prompts] No prompt found for key "${key}" — using fallback`)
      return `You are an AI assistant. Respond in Spanish.`
    }

    const content = prompt.content

    // Guardar en cache
    this.cache.set(cacheKey, { prompt: content, expiresAt: Date.now() + this.CACHE_TTL_MS })

    return content
  }

  /**
   * Reemplazar {{variables}} en el prompt con los valores del contexto.
   * Si una variable no está en el contexto, se deja como está (no falla).
   */
  private fillVariables(template: string, context: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      if (varName in context && context[varName] !== undefined && context[varName] !== null) {
        return String(context[varName])
      }
      return match // deja la variable sin reemplazar
    })
  }

  /**
   * Invalidar el cache (llamar al editar/crear prompts desde admin).
   */
  invalidateCache(key?: string): void {
    if (key) {
      // Borrar solo entradas de esa key
      for (const k of this.cache.keys()) {
        if (k.startsWith(`${key}:`)) this.cache.delete(k)
      }
    } else {
      this.cache.clear()
    }
  }

  // =====================================================================
  // Admin: gestión de prompts
  // =====================================================================

  /**
   * Listar prompts con filtros opcionales.
   * Para admin UI: ver todos, o filtrar por scope/workspace/project.
   */
  async listPrompts(filters: {
    key?: string
    scope?: string
    workspaceId?: string
    projectId?: string
  } = {}) {
    const query: any = { active: true }
    if (filters.key) query.key = filters.key
    if (filters.scope) query.scope = filters.scope
    if (filters.workspaceId) query.workspaceId = filters.workspaceId
    if (filters.projectId) query.projectId = filters.projectId

    return await Prompt.find(query).sort({ key: 1, scope: 1 }).lean()
  }

  /**
   * Crear o actualizar un prompt.
   * Si ya existe uno activo para (key, scope, workspaceId, projectId),
   * lo actualiza (sube version). Si no, lo crea.
   */
  async upsertPrompt(params: {
    key: PromptKey | string
    scope: 'global' | 'workspace' | 'project'
    workspaceId?: string
    projectId?: string
    name: string
    description?: string
    content: string
    variables?: string[]
    category?: 'role' | 'task'
    updatedBy?: string
  }) {
    const filter: any = {
      key: params.key,
      scope: params.scope,
      active: true,
    }
    if (params.scope === 'workspace') filter.workspaceId = params.workspaceId
    if (params.scope === 'project') {
      filter.projectId = params.projectId
      filter.workspaceId = params.workspaceId
    }

    const existing = await Prompt.findOne(filter)

    if (existing) {
      // Update: subir versión
      existing.content = params.content
      existing.name = params.name
      existing.description = params.description
      existing.variables = params.variables || existing.variables
      existing.category = params.category || existing.category
      existing.version += 1
      existing.updatedBy = params.updatedBy
      await existing.save()
      this.invalidateCache(params.key)
      return existing
    }

    // Create
    const created = await Prompt.create({
      ...params,
      version: 1,
    })
    this.invalidateCache(params.key)
    return created
  }

  /**
   * Desactivar un prompt (soft delete). La resolución hará fallback a la
   * capa superior.
   */
  async deactivatePrompt(id: string) {
    const prompt = await Prompt.findByIdAndUpdate(id, { active: false }, { new: true }).lean()
    if (prompt) {
      this.invalidateCache(prompt.key)
    }
    return prompt
  }
}

export const promptService = new PromptService()
export default promptService
