/**
 * Provider Models Service
 * Dynamically fetches available models from each provider
 */

import Provider from '../models/Provider.js'
import { getCredential } from '../lib/credentials.js'
import axios from 'axios'

export interface ModelInfo {
  id: string
  name: string
  description?: string
  contextLength?: number
  capabilities?: string[]
}

/**
 * Fetch models from Z.ai (BigModel/ZhipuAI)
 * Uses their OpenAI-compatible API
 */
async function fetchZaiModels(apiKey: string, baseUrl: string = 'https://api.z.ai/api/paas/v4/'): Promise<ModelInfo[]> {
  try {
    const response = await axios.get(`${baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    })

    if (response.data && response.data.data) {
      return response.data.data.map((model: any) => ({
        id: model.id,
        name: model.id,
        description: model.description || '',
        contextLength: Math.max(...(model.context_length || [128000]))
      }))
    }

    // Fallback to known models if API fails
    return getFallbackZaiModels()
  } catch (error) {
    console.warn('Failed to fetch Z.ai models, using fallback:', error.message)
    return getFallbackZaiModels()
  }
}

/**
 * Fallback models for Z.ai (when API fails)
 */
function getFallbackZaiModels(): ModelInfo[] {
  return [
    { id: 'glm-5', name: 'GLM-5', description: 'Latest flagship model', contextLength: 128000 },
    { id: 'glm-4.7', name: 'GLM-4.7', description: 'Advanced model', contextLength: 128000 },
    { id: 'glm-4.7-flash', name: 'GLM-4.7 Flash', description: 'Fast model (free)', contextLength: 128000 },
    { id: 'glm-4.5', name: 'GLM-4.5', description: 'Balanced model', contextLength: 128000 },
    { id: 'glm-4.5v', name: 'GLM-4.5V', description: 'Vision model', contextLength: 128000 },
    { id: 'glm-4', name: 'GLM-4', description: 'Stable production model', contextLength: 128000 },
    { id: 'glm-4-plus', name: 'GLM-4 Plus', description: 'Enhanced GLM-4', contextLength: 128000 },
    { id: 'glm-4-flash', name: 'GLM-4 Flash', description: 'Fast model', contextLength: 128000 },
    { id: 'glm-3-turbo', name: 'GLM-3 Turbo', description: 'Legacy model', contextLength: 128000 }
  ]
}

/**
 * Fetch models from OpenAI-compatible API (OpenAI, custom providers)
 */
async function fetchOpenAIModels(apiKey: string, baseUrl: string): Promise<ModelInfo[]> {
  try {
    const response = await axios.get(`${baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    })

    if (response.data && response.data.data) {
      return response.data.data.map((model: any) => ({
        id: model.id,
        name: model.id,
        description: '',
        contextLength: model.max_tokens || 128000
      }))
    }
    return []
  } catch (error) {
    console.warn(`Failed to fetch models from ${baseUrl}:`, error.message)
    return []
  }
}

/**
 * Fetch models from Anthropic (no models endpoint, use known list)
 */
async function fetchAnthropicModels(): Promise<ModelInfo[]> {
  // Anthropic doesn't have a models endpoint
  return [
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Balanced performance', contextLength: 200000 },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fast and efficient', contextLength: 200000 },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Highest quality', contextLength: 200000 }
  ]
}

/**
 * Fetch models from MiniMax (no models endpoint, use known list)
 * MiniMax does NOT have a /v1/models endpoint
 * Docs: https://platform.minimax.io/docs/guides/models-intro
 *
 * NOTE: The OpenAI-compatible API uses different model names than the native API
 * - OpenAI-compatible: MiniMax-M2.5, MiniMax-M2.1 (api.minimax.io/v1/chat/completions)
 * - Native API: abab6.5s-chat, abab6.5g-chat (api.minimax.chat/v1/text/chatcompletion_v2)
 */
async function fetchMiniMaxModels(): Promise<ModelInfo[]> {
  // Model names for OpenAI-compatible API endpoint
  // Based on official MiniMax platform documentation 2025
  return [
    { id: 'MiniMax-M2.5', name: 'MiniMax M2.5', description: 'Latest flagship model optimized for coding', contextLength: 204800 },
    { id: 'MiniMax-M2.1', name: 'MiniMax M2.1', description: 'Multi-language programming model', contextLength: 204800 },
    { id: 'MiniMax-Text-01', name: 'MiniMax Text 01', description: 'Text generation model', contextLength: 200000 }
  ]
}

/**
 * Fetch models from Ollama (local)
 */
async function fetchOllamaModels(baseUrl: string = 'http://localhost:11434'): Promise<ModelInfo[]> {
  try {
    const response = await axios.get(`${baseUrl}/api/tags`, { timeout: 5000 })
    if (response.data && response.data.models) {
      return response.data.models.map((model: any) => ({
        id: model.name,
        name: model.name,
        description: model.details?.description || '',
        contextLength: model.details?.context_length || 4096
      }))
    }
    return []
  } catch (error) {
    console.warn('Failed to fetch Ollama models:', error.message)
    return []
  }
}

/**
 * Get models for a provider (with caching)
 */
export async function getProviderModels(providerId: string, forceRefresh: boolean = false): Promise<ModelInfo[]> {
  const provider = await Provider.findOne({ providerId, enabled: true })
  if (!provider) {
    throw new Error(`Provider not found or disabled: ${providerId}`)
  }

  // Check cache (valid for 1 hour)
  const cacheAge = provider.modelsLastUpdated ? Date.now() - provider.modelsLastUpdated.getTime() : Infinity
  if (!forceRefresh && provider.cachedModels && cacheAge < 3600000) {
    return provider.cachedModels
  }

  // Fetch models based on provider type
  let models: ModelInfo[] = []

  const apiKey = provider.apiKey || await getCredential(providerId)

  switch (provider.type) {
    case 'openai':
    case 'custom':
      if (provider.providerId === 'zai') {
        models = await fetchZaiModels(apiKey, provider.apiEndpoint)
      } else if (provider.providerId === 'minimax') {
        models = await fetchMiniMaxModels()
      } else {
        models = await fetchOpenAIModels(apiKey, provider.apiEndpoint || 'https://api.openai.com/v1')
      }
      break

    case 'anthropic':
      models = await fetchAnthropicModels()
      break

    case 'ollama':
      models = await fetchOllamaModels(provider.apiEndpoint || 'http://localhost:11434')
      break

    case 'google':
      // Google uses similar format to OpenAI
      models = await fetchOpenAIModels(apiKey, provider.apiEndpoint || 'https://generativelanguage.googleapis.com/v1beta')
      break
  }

  // Update cache
  provider.cachedModels = models
  provider.modelsLastUpdated = new Date()
  await provider.save()

  return models
}

/**
 * Refresh all enabled providers' models
 */
export async function refreshAllProviderModels(): Promise<Record<string, ModelInfo[]>> {
  const providers = await Provider.find({ enabled: true })
  const results: Record<string, ModelInfo[]> = {}

  for (const provider of providers) {
    try {
      results[provider.providerId] = await getProviderModels(provider.providerId, true)
    } catch (error) {
      console.error(`Failed to refresh models for ${provider.providerId}:`, error)
      results[provider.providerId] = []
    }
  }

  return results
}

/**
 * Get all enabled providers
 */
export async function getEnabledProviders(): Promise<Provider[]> {
  return Provider.find({ enabled: true }).sort({ name: 1 })
}

/**
 * Create or update a provider
 */
export async function upsertProvider(data: {
  providerId: string
  name: string
  type: 'openai' | 'anthropic' | 'google' | 'ollama' | 'custom'
  apiEndpoint?: string
  apiKey?: string
  defaultModel?: string
  enabled?: boolean
}): Promise<Provider> {
  const provider = await Provider.findOneAndUpdate(
    { providerId: data.providerId },
    {
      $set: {
        name: data.name,
        type: data.type,
        apiEndpoint: data.apiEndpoint,
        apiKey: data.apiKey,
        defaultModel: data.defaultModel,
        enabled: data.enabled !== false
      }
    },
    { upsert: true, new: true }
  )

  return provider
}

/**
 * Delete a provider
 */
export async function deleteProvider(providerId: string): Promise<boolean> {
  const result = await Provider.deleteOne({ providerId })
  return result.deletedCount > 0
}
