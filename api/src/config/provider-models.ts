/**
 * Provider Models Configuration
 * Defines available LLM models for each provider
 */

export interface ModelInfo {
  id: string
  name: string
  description: string
  contextLength: number
  capabilities: string[]
  costLevel?: 'free' | 'low' | 'medium' | 'high'
}

export interface ProviderModels {
  providerId: string
  providerName: string
  models: ModelInfo[]
}

/**
 * Available models per provider
 * Updated: 2026-02-14
 */
export const PROVIDER_MODELS: Record<string, ProviderModels> = {
  // =============================================================================
  // Z.AI (Zhipu AI / BigModel)
  // =============================================================================
  zai: {
    providerId: 'zai',
    providerName: 'Z.ai (Zhipu AI)',
    models: [
      // GLM-5 Series (Latest - 2026)
      {
        id: 'glm-5',
        name: 'GLM-5',
        description: 'Latest flagship model with superior reasoning capabilities',
        contextLength: 128000,
        capabilities: ['chat', 'reasoning', 'function-calling', 'json-mode'],
        costLevel: 'high'
      },
      // GLM-4.7 Series
      {
        id: 'glm-4.7',
        name: 'GLM-4.7',
        description: 'Advanced model with excellent performance',
        contextLength: 128000,
        capabilities: ['chat', 'reasoning', 'function-calling', 'json-mode'],
        costLevel: 'high'
      },
      {
        id: 'glm-4.7-flash',
        name: 'GLM-4.7 Flash',
        description: 'Fast variant optimized for speed',
        contextLength: 128000,
        capabilities: ['chat', 'function-calling'],
        costLevel: 'free'
      },
      // GLM-4.5 Series
      {
        id: 'glm-4.5',
        name: 'GLM-4.5',
        description: 'Balanced model for general use',
        contextLength: 128000,
        capabilities: ['chat', 'reasoning', 'function-calling'],
        costLevel: 'medium'
      },
      {
        id: 'glm-4.5v',
        name: 'GLM-4.5V',
        description: 'Multimodal model with vision capabilities',
        contextLength: 128000,
        capabilities: ['chat', 'vision', 'image-analysis'],
        costLevel: 'medium'
      },
      {
        id: 'glm-4.5-air',
        name: 'GLM-4.5 Air',
        description: 'Lightweight model for simple tasks',
        contextLength: 128000,
        capabilities: ['chat'],
        costLevel: 'low'
      },
      // GLM-4 Series
      {
        id: 'glm-4',
        name: 'GLM-4',
        description: 'Stable production model',
        contextLength: 128000,
        capabilities: ['chat', 'function-calling', 'json-mode'],
        costLevel: 'medium'
      },
      {
        id: 'glm-4-plus',
        name: 'GLM-4 Plus',
        description: 'Enhanced GLM-4 with better reasoning',
        contextLength: 128000,
        capabilities: ['chat', 'reasoning', 'function-calling', 'json-mode'],
        costLevel: 'medium'
      },
      {
        id: 'glm-4-air',
        name: 'GLM-4 Air',
        description: 'Lightweight chat model',
        contextLength: 128000,
        capabilities: ['chat'],
        costLevel: 'low'
      },
      {
        id: 'glm-4-flash',
        name: 'GLM-4 Flash',
        description: 'Ultra-fast model for simple queries',
        contextLength: 128000,
        capabilities: ['chat'],
        costLevel: 'low'
      },
      // Legacy
      {
        id: 'glm-3-turbo',
        name: 'GLM-3 Turbo',
        description: 'Legacy model for compatibility',
        contextLength: 128000,
        capabilities: ['chat'],
        costLevel: 'low'
      }
    ]
  },

  // =============================================================================
  // ANTHROPIC (Claude)
  // =============================================================================
  anthropic: {
    providerId: 'anthropic',
    providerName: 'Anthropic (Claude)',
    models: [
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        description: 'Balanced performance and speed',
        contextLength: 200000,
        capabilities: ['chat', 'reasoning', 'vision', 'function-calling'],
        costLevel: 'medium'
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        description: 'Fast and efficient',
        contextLength: 200000,
        capabilities: ['chat', 'vision', 'function-calling'],
        costLevel: 'low'
      },
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        description: 'Highest quality output',
        contextLength: 200000,
        capabilities: ['chat', 'reasoning', 'vision'],
        costLevel: 'high'
      }
    ]
  },

  // =============================================================================
  // OPENAI
  // =============================================================================
  openai: {
    providerId: 'openai',
    providerName: 'OpenAI',
    models: [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        description: 'Omni model with vision',
        contextLength: 128000,
        capabilities: ['chat', 'reasoning', 'vision', 'function-calling'],
        costLevel: 'high'
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        description: 'Fast and cost-effective',
        contextLength: 128000,
        capabilities: ['chat', 'vision', 'function-calling'],
        costLevel: 'low'
      },
      {
        id: 'gpt-4-turbo',
        name: 'GPT-4 Turbo',
        description: 'Previous flagship model',
        contextLength: 128000,
        capabilities: ['chat', 'reasoning', 'function-calling'],
        costLevel: 'high'
      },
      {
        id: 'o3-mini',
        name: 'o3-mini',
        description: 'Reasoning-focused model',
        contextLength: 200000,
        capabilities: ['chat', 'reasoning', 'function-calling'],
        costLevel: 'medium'
      }
    ]
  },

  // =============================================================================
  // GOOGLE (Gemini)
  // =============================================================================
  google: {
    providerId: 'google',
    providerName: 'Google (Gemini)',
    models: [
      {
        id: 'gemini-2.0-flash-exp',
        name: 'Gemini 2.0 Flash',
        description: 'Latest experimental model',
        contextLength: 1000000,
        capabilities: ['chat', 'reasoning', 'vision', 'function-calling', 'multimodal'],
        costLevel: 'medium'
      },
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        description: 'Production-ready model',
        contextLength: 2000000,
        capabilities: ['chat', 'reasoning', 'vision', 'function-calling', 'audio'],
        costLevel: 'medium'
      },
      {
        id: 'gemini-1.5-flash',
        name: 'Gemini 1.5 Flash',
        description: 'Fast variant',
        contextLength: 1000000,
        capabilities: ['chat', 'vision', 'function-calling'],
        costLevel: 'low'
      }
    ]
  },

  // =============================================================================
  // MINIMAX
  // NOTE: OpenAI-compatible API uses different model names than native API
  // Native API: abab6.5s-chat (api.minimax.chat/v1/text/chatcompletion_v2)
  // OpenAI API: MiniMax-M2.5, MiniMax-M2.1 (api.minimax.io/v1/chat/completions)
  // =============================================================================
  minimax: {
    providerId: 'minimax',
    providerName: 'MiniMax',
    models: [
      {
        id: 'MiniMax-M2.5',
        name: 'MiniMax M2.5',
        description: 'Latest flagship model optimized for coding and tool use',
        contextLength: 204800,
        capabilities: ['chat', 'code', 'reasoning', 'function-calling'],
        costLevel: 'low'
      },
      {
        id: 'MiniMax-M2.1',
        name: 'MiniMax M2.1',
        description: 'Multi-language programming model',
        contextLength: 204800,
        capabilities: ['chat', 'code'],
        costLevel: 'low'
      },
      {
        id: 'MiniMax-Text-01',
        name: 'MiniMax Text 01',
        description: 'Text generation model',
        contextLength: 200000,
        capabilities: ['chat'],
        costLevel: 'low'
      }
    ]
  },

  // =============================================================================
  // OLLAMA (Local models)
  // =============================================================================
  ollama: {
    providerId: 'ollama',
    providerName: 'Ollama (Local)',
    models: [
      {
        id: 'llama3.2',
        name: 'Llama 3.2',
        description: 'Meta Llama 3.2',
        contextLength: 128000,
        capabilities: ['chat'],
        costLevel: 'free'
      },
      {
        id: 'mistral',
        name: 'Mistral',
        description: 'Mistral 7B',
        contextLength: 32768,
        capabilities: ['chat'],
        costLevel: 'free'
      },
      {
        id: 'codellama',
        name: 'Code Llama',
        description: 'Code-focused model',
        contextLength: 16384,
        capabilities: ['chat', 'code'],
        costLevel: 'free'
      }
    ]
  }
}

/**
 * Get all available providers
 */
export function getAvailableProviders(): ProviderModels[] {
  return Object.values(PROVIDER_MODELS)
}

/**
 * Get models for a specific provider
 */
export function getProviderModels(providerId: string): ModelInfo[] {
  const provider = PROVIDER_MODELS[providerId]
  return provider?.models || []
}

/**
 * Get a specific model info
 */
export function getModelInfo(providerId: string, modelId: string): ModelInfo | null {
  const models = getProviderModels(providerId)
  return models.find(m => m.id === modelId) || null
}

/**
 * Get default model for a provider
 */
export function getDefaultModel(providerId: string): string {
  const defaults: Record<string, string> = {
    zai: 'glm-4',
    minimax: 'MiniMax-M2.1',
    anthropic: 'claude-3-5-sonnet-20241022',
    openai: 'gpt-4o-mini',
    google: 'gemini-1.5-flash',
    ollama: 'llama3.2'
  }
  return defaults[providerId] || 'glm-4'
}
