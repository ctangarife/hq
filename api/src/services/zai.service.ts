import axios from 'axios'

// Z.ai API Configuration
// Docs: https://docs.z.ai/api-reference/introduction

const ZAI_API_KEY = process.env.ZAI_API_KEY || ''
const ZAI_API_ENDPOINT = process.env.ZAI_API_ENDPOINT || 'https://api.z.ai/api/anthropic/'

interface ZaiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ZaiCompletionRequest {
  model: string
  messages: ZaiMessage[]
  temperature?: number
  max_tokens?: number
  stream?: boolean
}

interface ZaiCompletionResponse {
  id: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

class ZaiService {
  private client: ReturnType<typeof axios.create>

  constructor() {
    this.client = axios.create({
      baseURL: ZAI_API_ENDPOINT,
      headers: {
        'Authorization': `Bearer ${ZAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    })
  }

  /**
   * Generate chat completion
   */
  async chat(params: ZaiCompletionRequest): Promise<ZaiCompletionResponse> {
    try {
      const response = await this.client.post<ZaiCompletionResponse>(
        'chat/completions',
        {
          model: params.model,
          messages: params.messages,
          temperature: params.temperature || 0.7,
          max_tokens: params.max_tokens || 4096,
          stream: params.stream || false
        }
      )
      return response.data
    } catch (error: any) {
      console.error('Z.ai API error:', error.response?.data || error.message)
      throw new Error(error.response?.data?.error?.message || 'Z.ai API request failed')
    }
  }

  /**
   * Generate completion with system prompt (for agent personalities)
   */
  async chatWithSystem(
    systemPrompt: string,
    userMessage: string,
    model: string = 'glm-4-plus'
  ): Promise<string> {
    const messages: ZaiMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ]

    const response = await this.chat({ model, messages })

    return response.choices[0]?.message?.content || ''
  }

  /**
   * Stream chat completion (for real-time responses)
   */
  async *chatStream(
    messages: ZaiMessage[],
    model: string = 'glm-4-plus'
  ): AsyncGenerator<string> {
    try {
      const response = await this.client.post(
        'chat/completions',
        {
          model,
          messages,
          stream: true
        },
        { responseType: 'stream' }
      )

      for await (const chunk of response.data) {
        const lines = chunk.toString().split('\n').filter((line: string) => line.trim())
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') return

            try {
              const parsed = JSON.parse(data)
              const content = parsed.choices[0]?.delta?.content
              if (content) yield content
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Z.ai stream error:', error.message)
      throw error
    }
  }

  /**
   * List available models
   */
  getAvailableModels(): string[] {
    return [
      'glm-4-plus',      // Most capable model
      'glm-4-air',       // Balanced model
      'glm-4-flash',     // Fast model
      'glm-4-flashx',    // Ultra fast model
      'glm-3-turbo'      // Legacy model
    ]
  }

  /**
   * Validate API key
   */
  async validateApiKey(): Promise<boolean> {
    try {
      await this.chat({
        model: 'glm-4-flash',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1
      })
      return true
    } catch {
      return false
    }
  }
}

export default new ZaiService()
