#!/usr/bin/env node

/**
 * HQ Agent - Agente AI personalizado
 * Se conecta directamente a LLM providers sin depender de OpenClaw/molbot
 * Modo de operación: POLLING DE TAREAS desde API HQ
 */

import fetch from 'node-fetch';

// Configuración desde variables de entorno
const config = {
  // Información del agente
  agentName: process.env.AGENT_NAME || 'HQ Agent',
  agentRole: process.env.AGENT_ROLE || 'Assistant',
  agentPersonality: process.env.AGENT_PERSONALITY || 'Helpful AI assistant',
  agentId: process.env.AGENT_ID, // ID del agente en HQ

  // Configuración del modelo LLM
  llmModel: process.env.LLM_MODEL || process.env.OPENCLAW_LLM_MODEL || 'glm-4-plus',
  llmProvider: process.env.LLM_PROVIDER || process.env.OPENCLAW_LLM_PROVIDER || 'zai',

  // Configuración de API HQ para polling
  hqApiUrl: process.env.HQ_API_URL || 'http://api:3001/api',
  pollInterval: parseInt(process.env.POLL_INTERVAL || '5000', 10), // 5 segundos por defecto
};

// Mapeo de provider -> variable de entorno API key
const providerKeys = {
  zai: process.env.ZAI_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
  openai: process.env.OPENAI_API_KEY,
};

// Obtener API key para el provider
const getApiKey = (provider) => {
  const key = providerKeys[provider.toLowerCase()];
  if (!key) {
    throw new Error(`No API key found for provider: ${provider}`);
  }
  return key;
};

// Endpoints de LLM providers
const providers = {
  zai: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    getHeaders: (apiKey) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }),
    formatPayload: (model, messages) => ({
      model,
      messages,
      stream: false
    })
  },

  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1/messages',
    getHeaders: (apiKey) => ({
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }),
    formatPayload: (model, messages) => ({
      model,
      max_tokens: 4096,
      messages
    })
  },

  openai: {
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    getHeaders: (apiKey) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }),
    formatPayload: (model, messages) => ({
      model,
      messages
    })
  }
};

// Clase principal del Agente
class HQAgent {
  constructor(config) {
    this.config = config;
    this.provider = providers[config.llmProvider];
    if (!this.provider) {
      throw new Error(`Unsupported provider: ${config.llmProvider}`);
    }
    this.apiKey = getApiKey(config.llmProvider);
    this.messages = [];
    this.running = false;
  }

  // Inicializar conversación
  initialize() {
    this.messages.push({
      role: 'system',
      content: `Eres ${this.config.agentName}, ${this.config.agentRole}.
${this.config.agentPersonality}

Modelo: ${this.config.llmModel}
Provider: ${this.config.llmProvider}

Responde de manera concisa y útil.`
    });
  }

  // Enviar mensaje al LLM
  async sendMessage(userMessage) {
    this.messages.push({
      role: 'user',
      content: userMessage
    });

    try {
      const response = await this.callLLM();
      const assistantMessage = response.content[0]?.text || response.content || '';

      this.messages.push({
        role: 'assistant',
        content: assistantMessage
      });

      return assistantMessage;
    } catch (error) {
      console.error('Error calling LLM:', error.message);
      throw error;
    }
  }

  // Llamada al proveedor LLM
  async callLLM() {
    const payload = this.provider.formatPayload(this.config.llmModel, this.messages);
    const headers = this.provider.getHeaders(this.apiKey);

    const response = await fetch(this.provider.baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM error ${response.status}: ${error}`);
    }

    return await response.json();
  }

  // Obtener próxima tarea desde API HQ (polling)
  async getNextTask() {
    try {
      const response = await fetch(`${this.config.hqApiUrl}/tasks/agent/${this.config.agentId}/next`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.HQ_API_TOKEN || 'hq-token'}`
        }
      });

      if (response.status === 204) {
        return null; // No tareas disponibles
      }

      if (!response.ok) {
        throw new Error(`API error ${response.status}: ${await response.text()}`);
      }

      const task = await response.json();
      console.log(`📋 Tarea asignada: [${task.type || 'custom'}] ${task.title}`);
      return task;
    } catch (error) {
      console.error('Error fetching task:', error.message);
      return null;
    }
  }

  // Ejecutar una tarea
  async executeTask(task) {
    const startTime = Date.now();

    try {
      // Marcar tarea como in_progress
      await this.updateTaskStatus(task._id, 'in_progress');

      // Construir prompt con la tarea
      const taskPrompt = this.buildTaskPrompt(task);
      const response = await this.sendMessage(taskPrompt);

      console.log('');
      console.log(`💡 Respuesta (${Math.round((Date.now() - startTime) / 1000)}s):`);
      console.log(response);
      console.log('');

      // Marcar tarea como completada con el resultado
      await this.completeTask(task._id, {
        success: true,
        result: response,
        duration: Date.now() - startTime
      });

      return true;
    } catch (error) {
      console.error(`❌ Error ejecutando tarea: ${error.message}`);

      // Marcar tarea como fallida
      await this.failTask(task._id, {
        success: false,
        error: error.message
      });

      return false;
    }
  }

  // Construir prompt para la tarea
  buildTaskPrompt(task) {
    let prompt = `# Tarea: ${task.title}\n\n`;

    if (task.description) {
      prompt += `Descripción: ${task.description}\n\n`;
    }

    if (task.input && Object.keys(task.input).length > 0) {
      prompt += `Datos de entrada:\n${JSON.stringify(task.input, null, 2)}\n\n`;
    }

    prompt += `Por favor ejecuta esta tarea y reporta el resultado.`;

    return prompt;
  }

  // Actualizar estado de tarea
  async updateTaskStatus(taskId, status) {
    try {
      await fetch(`${this.config.hqApiUrl}/tasks/${taskId}/start`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.HQ_API_TOKEN || 'hq-token'}`,
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      console.error('Error updating task status:', error.message);
    }
  }

  // Completar tarea
  async completeTask(taskId, data) {
    try {
      await fetch(`${this.config.hqApiUrl}/tasks/${taskId}/complete`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.HQ_API_TOKEN || 'hq-token'}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ output: data })
      });
      console.log(`✅ Tarea completada: ${taskId}`);
    } catch (error) {
      console.error('Error completing task:', error.message);
    }
  }

  // Marcar tarea como fallida
  async failTask(taskId, data) {
    try {
      await fetch(`${this.config.hqApiUrl}/tasks/${taskId}/fail`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.HQ_API_TOKEN || 'hq-token'}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: data.error })
      });
      console.log(`❌ Tarea fallida: ${taskId}`);
    } catch (error) {
      console.error('Error failing task:', error.message);
    }
  }

  // Loop principal de polling y ejecución
  async run() {
    console.log('');
    console.log('🤖 HQ Agent - Iniciando (Modo Polling)');
    console.log('================================');
    console.log(`📋 Configuración:`);
    console.log(`   Agente: ${this.config.agentName}`);
    console.log(`   ID: ${this.config.agentId || 'N/A'}`);
    console.log(`   Rol: ${this.config.agentRole}`);
    console.log(`   Modelo: ${this.config.llmModel}`);
    console.log(`   Provider: ${this.config.llmProvider}`);
    console.log(`   API HQ: ${this.config.hqApiUrl}`);
    console.log(`   Poll Interval: ${this.config.pollInterval}ms`);
    console.log(`   API Key: ${this.apiKey ? '✅ Configurada' : '❌ No configurada'}`);
    console.log('================================');
    console.log('');

    this.running = true;
    this.initialize();

    while (this.running) {
      try {
        // 1. Buscar próxima tarea
        const task = await this.getNextTask();

        if (task) {
          // 2. Ejecutar tarea
          await this.executeTask(task);
        } else {
          // 3. Esperar si no hay tareas
          process.stdout.write('.');
          await this.sleep(this.config.pollInterval);
        }
      } catch (error) {
        console.error(`\n❌ Error en loop principal: ${error.message}`);
        await this.sleep(this.config.pollInterval);
      }
    }
  }

  // Utilidad: sleep
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Detener agente
  stop() {
    console.log('\n👋 Deteniendo agente...');
    this.running = false;
  }
}

// Ejecutar agente
if (import.meta.url === `file://${process.argv[1]}`) {
  const agent = new HQAgent(config);

  // Manejar señales de terminación
  process.on('SIGTERM', () => agent.stop());
  process.on('SIGINT', () => agent.stop());

  agent.run().catch(console.error);
}
