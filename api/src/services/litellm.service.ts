import axios from 'axios'
import LLMConfig from '../models/LLMConfig.js'

/**
 * LitellmService - Abstracción sobre el proxy LiteLLM centralizado
 *
 * Centraliza TODOS los LLM calls de HQ a través de litellm.ctangarife.com.
 * La virtual key vive en MongoDB (collection llmconfigs), no en .env ni en
 * el código. Esto permite:
 *   - Rotación de keys sin redeploy
 *   - Multi-tenant-ready: mañana getKey(workspaceId) devuelve la key de ese workspace
 *   - Tracking de costos por workspace en el dashboard de LiteLLM
 *
 * Arquitectura de keys (sin sub-keys efímeras — eso llenaría LiteLLM de basura):
 *   1. La API lee la virtual key de MongoDB según el scope
 *   2. La pasa por ENV al container efímero de Goose
 *   3. El container la usa para hablar al proxy y muere en minutos
 *
 * El threat model: quien puede hacer `docker inspect` en el host ya está
 * comprometido — la virtual key es lo de menos. MongoDB está aislado en red
 * interna (no expuesto al host tras el cambio de Nginx).
 */
class LitellmService {
  private readonly apiUrl: string
  private readonly masterKey: string
  private cachedModels: string[] | null = null

  constructor() {
    // URL del proxy sin sufijo /v1 (lo añade el cliente)
    this.apiUrl = process.env.LITELLM_API_URL || 'https://litellm.ctangarife.com'
    // Master key solo para crear/rotar virtual keys (no para chat completions)
    this.masterKey = process.env.LITELLM_MASTER_KEY || ''
  }

  // =====================================================================
  // Key resolution - el corazón del multi-tenant
  // =====================================================================

  /**
   * Obtener la virtual key para un contexto dado.
   *
   * HOY: solo existe la global. Devuelve esa.
   * MAÑANA: si hay workspaceId, busca la key específica del workspace;
   *         si no existe, hace fallback a la global.
   *
   * @param workspaceId - opcional, para keys por workspace
   * @returns la virtual key (sk-...) o throw si no hay ninguna configurada
   */
  async getKey(workspaceId?: string): Promise<string> {
    // 1. Intentar key por workspace si se especificó
    if (workspaceId) {
      const wsKey = await LLMConfig.findOne({
        scope: 'workspace',
        workspaceId,
        active: true,
      }).lean()
      if (wsKey) {
        return wsKey.virtualKey
      }
      // Fallback a global si no hay específica del workspace
    }

    // 2. Key global (fallback universal)
    const globalKey = await LLMConfig.findOne({
      scope: 'global',
      active: true,
    }).lean()

    if (!globalKey) {
      throw new Error(
        'No LiteLLM virtual key configured in MongoDB. ' +
        'Seed one via POST /api/llm-config or the admin UI.',
      )
    }

    return globalKey.virtualKey
  }

  /**
   * Obtener la virtual key COMPLETA (con metadata) para un contexto.
   * Útil cuando el caller necesita saber los modelos permitidos, budget, etc.
   */
  async getConfig(workspaceId?: string) {
    if (workspaceId) {
      const wsConfig = await LLMConfig.findOne({
        scope: 'workspace',
        workspaceId,
        active: true,
      }).lean()
      if (wsConfig) return wsConfig
    }
    return await LLMConfig.findOne({ scope: 'global', active: true }).lean()
  }

  // =====================================================================
  // Virtual Key Management (usando master key)
  // =====================================================================

  /**
   * Crear una nueva virtual key en LiteLLM y guardarla en MongoDB.
   * Usado para seed inicial y (futuro) para crear keys por workspace desde UI.
   *
   * @param params.alias - alias legible
   * @param params.scope - 'global' | 'workspace'
   * @param params.workspaceId - si scope === 'workspace'
   * @param params.maxBudget - USD por ciclo (default 50)
   * @param params.budgetDuration - '30d' | '1d' etc (default '30d')
   * @param params.rpmLimit - requests por minuto (default 100)
   * @param params.models - modelos permitidos
   */
  async createVirtualKey(params: {
    alias: string
    scope: 'global' | 'workspace'
    workspaceId?: string
    maxBudget?: number
    budgetDuration?: string
    rpmLimit?: number
    models?: string[]
  }): Promise<{ key: string; keyId: string; configId: string }> {
    if (!this.masterKey) {
      throw new Error('LITELLM_MASTER_KEY not set — cannot create virtual keys')
    }

    const payload = {
      key_alias: params.alias,
      max_budget: params.maxBudget ?? 50.0,
      budget_duration: params.budgetDuration ?? '30d',
      rpm_limit: params.rpmLimit ?? 100,
      tpm_limit: 200000,
      models: params.models ?? ['glm-4.7', 'kimi-k2'],
    }

    let response
    try {
      response = await axios.post(
        `${this.apiUrl}/key/generate`,
        payload,
        {
          headers: { Authorization: `Bearer ${this.masterKey}` },
          timeout: 10000,
        },
      )
    } catch (err: any) {
      // LiteLLM a veces rechaza alias duplicados
      if (err.response?.status === 400 &&
          err.response?.data?.error?.message?.includes('already exists')) {
        response = await axios.post(
          `${this.apiUrl}/key/generate`,
          { ...payload, key_alias: `${params.alias}-${Date.now()}` },
          {
            headers: { Authorization: `Bearer ${this.masterKey}` },
            timeout: 10000,
          },
        )
      } else {
        throw err
      }
    }

    const key = response.data.key
    const keyId = response.data.token_id
    if (!key || !keyId) {
      throw new Error('LiteLLM did not return a valid key')
    }

    // Guardar en MongoDB
    const config = await LLMConfig.create({
      scope: params.scope,
      workspaceId: params.workspaceId,
      alias: params.alias,
      virtualKey: key,
      keyId,
      models: params.models ?? ['glm-4.7', 'kimi-k2'],
      maxBudget: params.maxBudget ?? 50.0,
      budgetDuration: params.budgetDuration ?? '30d',
      rpmLimit: params.rpmLimit ?? 100,
      active: true,
    })

    return { key, keyId, configId: config._id.toString() }
  }

  /**
   * Listar todas las configs (para admin UI).
   * No devuelve la virtualKey en la respuesta (se enmascara).
   */
  async listConfigs() {
    const configs = await LLMConfig.find().sort({ scope: 1, workspaceId: 1 }).lean()
    return configs.map(c => ({
      _id: c._id,
      scope: c.scope,
      workspaceId: c.workspaceId,
      alias: c.alias,
      keyPreview: `${c.virtualKey.substring(0, 8)}...${c.virtualKey.slice(-4)}`,
      keyId: c.keyId,
      models: c.models,
      maxBudget: c.maxBudget,
      budgetDuration: c.budgetDuration,
      rpmLimit: c.rpmLimit,
      active: c.active,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }))
  }

  /**
   * Activar/desactivar una key sin borrarla (para rotación segura).
   */
  async setActive(configId: string, active: boolean) {
    return await LLMConfig.findByIdAndUpdate(
      configId,
      { active },
      { new: true },
    ).lean()
  }

  // =====================================================================
  // Model Discovery (desde LiteLLM)
  // =====================================================================

  async getAvailableModels(virtualKey: string): Promise<string[]> {
    const response = await axios.get(`${this.apiUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${virtualKey}` },
      timeout: 10000,
    })
    const models = (response.data?.data || []).map((m: any) => m.id)
    this.cachedModels = models
    return models
  }

  // =====================================================================
  // LLM Operations (vía proxy — OpenAI-compatible)
  // =====================================================================

  /**
   * Chat completion usando la virtual key del contexto.
   * Wrapper del endpoint OpenAI-compatible del proxy.
   *
   * @param workspaceId - para resolver la key correcta
   * @param messages - messages array OpenAI format
   * @param model - modelo (default: primer modelo disponible)
   */
  async chatCompletion(
    messages: { role: string; content: string }[],
    options?: {
      workspaceId?: string
      model?: string
      temperature?: number
      maxTokens?: number
    },
  ): Promise<string> {
    const virtualKey = await this.getKey(options?.workspaceId)

    let model = options?.model
    if (!model) {
      if (this.cachedModels && this.cachedModels.length > 0) {
        model = this.cachedModels[0]
      } else {
        const models = await this.getAvailableModels(virtualKey)
        if (models.length === 0) {
          throw new Error('No models available in LiteLLM')
        }
        model = models[0]
      }
    }

    const response = await axios.post(
      `${this.apiUrl}/v1/chat/completions`,
      {
        model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
      },
      {
        headers: { Authorization: `Bearer ${virtualKey}` },
        timeout: 120000,
      },
    )

    const content = response.data?.choices?.[0]?.message?.content
    if (!content) {
      throw new Error('LLM response missing content')
    }
    return content
  }
}

// Singleton — la API entera comparte una instancia
export const litellmService = new LitellmService()
export default litellmService
