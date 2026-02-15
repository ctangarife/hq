/**
 * Initialize default providers in MongoDB
 * Run this script to populate the providers collection
 */

import mongoose from 'mongoose'
import Provider from '../models/Provider.js'
import { dotenv } from '../config/env.js'

const DEFAULT_PROVIDERS = [
  {
    providerId: 'zai',
    name: 'Z.ai (Zhipu AI)',
    type: 'openai',
    enabled: true,
    apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4'
  },
  {
    providerId: 'minimax',
    name: 'MiniMax',
    type: 'openai',
    enabled: false,
    apiEndpoint: 'https://api.minimax.io/v1',
    defaultModel: 'abab6.5s-chat'
  },
  {
    providerId: 'anthropic',
    name: 'Anthropic (Claude)',
    type: 'anthropic',
    enabled: false,
    apiEndpoint: 'https://api.anthropic.com',
    defaultModel: 'claude-3-5-sonnet-20241022'
  },
  {
    providerId: 'openai',
    name: 'OpenAI',
    type: 'openai',
    enabled: false,
    apiEndpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini'
  },
  {
    providerId: 'google',
    name: 'Google (Gemini)',
    type: 'openai',
    enabled: false,
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-1.5-flash'
  },
  {
    providerId: 'ollama',
    name: 'Ollama (Local)',
    type: 'ollama',
    enabled: false,
    apiEndpoint: 'http://localhost:11434',
    defaultModel: 'llama3.2'
  }
]

export async function initializeProviders() {
  console.log('Initializing default providers...')

  for (const providerData of DEFAULT_PROVIDERS) {
    const existing = await Provider.findOne({ providerId: providerData.providerId })

    if (!existing) {
      const provider = new Provider(providerData)
      await provider.save()
      console.log(`✓ Created provider: ${providerData.name}`)
    } else {
      console.log(`- Provider already exists: ${providerData.name}`)
    }
  }

  console.log('Provider initialization complete!')
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  await initializeProviders()
  await mongoose.connection.close()
}
