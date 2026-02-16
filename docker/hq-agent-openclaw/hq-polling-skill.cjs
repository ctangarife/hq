#!/usr/bin/env node
/**
 * HQ Polling Skill
 *
 * This skill runs as a background process, polling the HQ API for tasks
 * and executing them using LLM providers with credentials from MongoDB.
 *
 * Usage: Run as a background process when the agent starts
 */

const fs = require('fs');
const fetch = require('node-fetch');

// Configuration from environment
const config = {
  agentId: process.env.AGENT_ID,
  agentName: process.env.AGENT_NAME || 'HQ Agent',
  agentRole: process.env.AGENT_ROLE || 'Assistant',
  llmProvider: process.env.LLM_PROVIDER || 'zai',
  llmModel: process.env.LLM_MODEL || 'glm-4',
  hqApiUrl: process.env.HQ_API_URL || 'http://api:3001/api',
  hqApiToken: process.env.HQ_API_TOKEN || 'hq-agent-token',
  pollInterval: parseInt(process.env.POLL_INTERVAL || '5000', 10),
};

// LLM Providers configuration
const providers = {
  zai: {
    baseUrl: 'https://api.z.ai/api/anthropic/chat/completions',
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

  minimax: {
    baseUrl: 'https://api.minimax.io/v1/chat/completions',
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

// Load auth profiles from OpenClaw's auth-profiles.json
function loadAuthProfiles() {
  try {
    const authProfilesPath = '/home/node/.openclaw/agents/main/agent/auth-profiles.json';
    if (fs.existsSync(authProfilesPath)) {
      const data = fs.readFileSync(authProfilesPath, 'utf8');
      return JSON.parse(data);
    }
    return {};
  } catch (error) {
    console.error('Error loading auth profiles:', error.message);
    return {};
  }
}

// Get API key for provider from auth-profiles or environment
function getApiKey(provider) {
  const authProfiles = loadAuthProfiles();
  const profile = authProfiles[provider];

  if (profile && profile.tokens && profile.tokens.default && profile.tokens.default[0]) {
    return profile.tokens.default[0].value;
  }

  // Fallback to environment variable
  const envVarName = `${provider.toUpperCase()}_API_KEY`;
  return process.env[envVarName];
}

class HQPollingSkill {
  constructor() {
    this.running = false;
    this.currentTask = null;
    this.provider = providers[config.llmProvider];
    if (!this.provider) {
      throw new Error(`Unsupported provider: ${config.llmProvider}`);
    }
    this.apiKey = getApiKey(config.llmProvider);
    if (!this.apiKey) {
      throw new Error(`No API key found for provider: ${config.llmProvider}`);
    }
    console.log(`✅ API Key configurada para ${config.llmProvider}`);
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getNextTask() {
    try {
      const response = await fetch(
        `${config.hqApiUrl}/tasks/agent/${config.agentId}/next`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${config.hqApiToken}`
          }
        }
      );

      if (response.status === 204) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`API error ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching task:', error.message);
      return null;
    }
  }

  async updateTaskStatus(taskId, status) {
    try {
      await fetch(`${config.hqApiUrl}/tasks/${taskId}/start`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.hqApiToken}`,
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      console.error('Error updating task status:', error.message);
    }
  }

  async completeTask(taskId, output) {
    try {
      await fetch(`${config.hqApiUrl}/tasks/${taskId}/complete`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.hqApiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ output })
      });
      console.log(`✅ Tarea completada: ${taskId}`);
    } catch (error) {
      console.error('Error completing task:', error.message);
    }
  }

  async failTask(taskId, error) {
    try {
      await fetch(`${config.hqApiUrl}/tasks/${taskId}/fail`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.hqApiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: error.message || String(error) })
      });
      console.log(`❌ Tarea fallida: ${taskId}`);
    } catch (err) {
      console.error('Error failing task:', err.message);
    }
  }

  async callLLM(messages) {
    const payload = this.provider.formatPayload(config.llmModel, messages);
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

  async executeTaskWithLLM(task) {
    const messages = [
      {
        role: 'system',
        content: `You are ${config.agentName}, ${config.agentRole}. Respond concisely and helpfully.`
      }
    ];

    // Build prompt for the task
    let prompt = `# Task: ${task.title}\n\n`;

    if (task.description) {
      prompt += `Description: ${task.description}\n\n`;
    }

    if (task.input && Object.keys(task.input).length > 0) {
      prompt += `Input Data:\n${JSON.stringify(task.input, null, 2)}\n\n`;
    }

    prompt += `Please execute this task and report the result.`;

    messages.push({ role: 'user', content: prompt });

    const result = await this.callLLM(messages);
    const content = result.choices[0]?.message?.content || result.content || '';

    // Check if the response is asking for more information (human input)
    // This applies to ALL task types, not just mission_analysis
    const isQuestionResponse =
      (content.includes('?') || content.includes('¿')) ||
      (content.length < 500 && (
        content.toLowerCase().includes('necesito') ||
        content.toLowerCase().includes('need') ||
        content.toLowerCase().includes('clarify') ||
        content.toLowerCase().includes('more information') ||
        content.toLowerCase().includes('what is') ||
        content.toLowerCase().includes('cuál') ||
        content.toLowerCase().includes('qué') ||
        content.toLowerCase().includes('por favor') ||
        content.toLowerCase().includes('favor de') ||
        content.toLowerCase().includes('provide')
      ));

    if (isQuestionResponse) {
      console.log('❓ Task response is asking for more information - creating human input task');
      // For non-mission_analysis tasks, we can't use handleNeedsHumanInfo directly
      // because it expects specific structure. Let's create a simpler version.
      const humanTaskResponse = await fetch(`${config.hqApiUrl}/tasks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.hqApiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: `Responder: ${task.title}`,
          description: `El agente necesita información:\n\n${content}\n\nPor favor responde para continuar.`,
          type: 'human_input',
          status: 'pending',
          missionId: task.missionId,
          input: {
            parentTaskId: task._id,
            agentId: config.agentId
          }
        })
      });

      if (humanTaskResponse.ok) {
        const humanTask = await humanTaskResponse.json();
        console.log(`✅ Tarea humana creada: ${humanTask._id}`);

        // Mark current task as awaiting human response
        await fetch(`${config.hqApiUrl}/tasks/${task._id}/status`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.hqApiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            status: 'awaiting_human_response',
            output: { success: true, result: { questions: content, needsHumanInput: true } }
          })
        });

        // Update mission if exists
        if (task.missionId) {
          await fetch(`${config.hqApiUrl}/missions/${task.missionId}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${config.hqApiToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              awaitingHumanTaskId: humanTask._id
            })
          });
        }

        return content; // Return the questions content
      } else {
        console.error('Failed to create human task');
      }
    }

    return content;
  }

  async executeTask(task) {
    const startTime = Date.now();

    try {
      console.log(`📋 Ejecutando tarea: [${task.type}] ${task.title}`);

      await this.updateTaskStatus(task._id, 'in_progress');

      // Special handling for mission_analysis tasks (Squad Lead)
      if (task.type === 'mission_analysis') {
        return await this.executeMissionAnalysis(task, startTime);
      }

      const result = await this.executeTaskWithLLM(task);

      console.log(`💡 Resultado (${Math.round((Date.now() - startTime) / 1000)}s):`);
      console.log(result);
      console.log('');

      // Check if result indicates human input was requested
      // executeTaskWithLLM returns the content directly, and if it created a human task,
      // the task was already marked as awaiting_human_response there
      const isAwaitingHuman = result &&
        (result.includes('?') || result.includes('¿')) &&
        result.length < 500;

      if (!isAwaitingHuman) {
        // Only complete the task if not waiting for human input
        await this.completeTask(task._id, {
          success: true,
          result,
          duration: Date.now() - startTime
        });
      }

      return true;
    } catch (error) {
      console.error(`❌ Error ejecutando tarea: ${error.message}`);

      await this.failTask(task._id, {
        success: false,
        error: error.message
      });

      return false;
    }
  }

  async executeMissionAnalysis(task, startTime) {
    console.log('🎯 Ejecutando análisis de misión (Squad Lead)...');

    const messages = [
      {
        role: 'system',
        content: `You are a Squad Lead agent. Your job is to analyze missions and create execution plans.

CRITICAL RULES:
1. If the mission description is generic, vague, or lacks specific details (like "tarea inicial", "planificar", "analizar"), you MUST ASK QUESTIONS instead of creating a plan.
2. ONLY create a JSON plan when you have specific, actionable information about what needs to be built/done.
3. Generic descriptions like "tarea inicial" or "analizar" are NOT enough - you need more context.
4. When in doubt, ALWAYS ASK QUESTIONS first.

When asking questions, use plain text (NOT JSON). List clearly what information you need.

When you have SPECIFIC details (what to build, specific requirements, clear objectives), create a JSON plan.`
      },
      {
        role: 'user',
        content: `Analyze this mission:

Title: ${task.title}
Description: ${task.description || ''}

Available Agent Templates:
- researcher: web_search, data_analysis, fact_checking
- developer: code_execution, code_review, debugging
- writer: content_generation, editing, documentation
- analyst: data_analysis, statistics, reporting

First, determine if you have ENOUGH SPECIFIC information:
- If the title/description is generic (like "tarea inicial", "analizar", "planificar") → ASK QUESTIONS
- If you don't know WHAT to build/do specifically → ASK QUESTIONS
- If you lack requirements, constraints, or deliverables → ASK QUESTIONS

If you need more information, respond with questions like:
- "¿Cuál es el objetivo específico del proyecto?"
- "¿Qué requisitos funcionales deben cumplirse?"
- "¿Qué tecnologías o herramientas se deben usar?"

ONLY when you have specific, actionable details, create a JSON plan:
{
  "complexity": "low|medium|high|critical",
  "summary": "Brief summary",
  "estimatedDuration": 123,
  "tasks": [
    {
      "id": "task-1",
      "title": "Task title",
      "description": "What needs to be done",
      "type": "web_search|data_analysis|content_generation|code_execution|custom",
      "dependencies": [],
      "priority": "high|medium|low",
      "assignedAgentRole": "researcher|developer|writer|analyst"
    }
  ],
  "agents": [
    {
      "id": "agent-1",
      "name": "Agent name",
      "role": "researcher|developer|writer|analyst",
      "capabilities": ["capability1"]
    }
  ]
}`
      }
    ];

    try {
      const result = await this.callLLM(messages);
      const content = result.choices[0]?.message?.content || result.content || '';

      console.log(`💡 Squad Lead Response (${Math.round((Date.now() - startTime) / 1000)}s):`);
      console.log(content);
      console.log('');

      // First, check if response contains questions (before trying JSON parsing)
      // Signs that this is a request for more information:
      // - Contains question marks
      // - Short response (< 300 chars)
      // - Contains keywords like "need", "clarify", "more information"
      const isQuestionResponse =
        (content.includes('?') || content.includes('¿')) ||
        (content.length < 300 && (
          content.toLowerCase().includes('necesito') ||
          content.toLowerCase().includes('need') ||
          content.toLowerCase().includes('clarify') ||
          content.toLowerCase().includes('more information') ||
          content.toLowerCase().includes('what is') ||
          content.toLowerCase().includes('cuál') ||
          content.toLowerCase().includes('qué') ||
          content.toLowerCase().includes('por favor')
        ));

      if (isQuestionResponse) {
        console.log('❓ Squad Lead is asking for more information');
        return await this.handleNeedsHumanInfo(task, content, startTime);
      }

      // Try to parse as JSON
      let jsonOutput;
      try {
        jsonOutput = JSON.parse(content);
      } catch (e) {
        // Try to extract JSON from markdown code blocks
        const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
        if (jsonMatch) {
          jsonOutput = JSON.parse(jsonMatch[1]);
        } else {
          // Try to find any JSON object in the response
          const objectMatch = content.match(/\{[\s\S]*\}/);
          if (objectMatch) {
            jsonOutput = JSON.parse(objectMatch[0]);
          } else {
            throw new Error('Squad Lead did not return valid JSON or questions. Response was: ' + content.substring(0, 200));
          }
        }
      }

      // Validate structure - MUST have tasks array
      if (!jsonOutput.tasks || !Array.isArray(jsonOutput.tasks)) {
        throw new Error('Invalid JSON: Missing or invalid "tasks" array. Got: ' + JSON.stringify(jsonOutput));
      }

      // Validate structure - MUST have agents array
      if (!jsonOutput.agents || !Array.isArray(jsonOutput.agents)) {
        throw new Error('Invalid JSON: Missing or invalid "agents" array');
      }

      // Validate that tasks array has at least one task
      if (jsonOutput.tasks.length === 0) {
        throw new Error('Invalid JSON: tasks array is empty');
      }

      // Validate that agents array has at least one agent
      if (jsonOutput.agents.length === 0) {
        throw new Error('Invalid JSON: agents array is empty');
      }

      await this.completeTask(task._id, {
        success: true,
        result: jsonOutput,
        duration: Date.now() - startTime
      });

      // Auto-process Squad Lead output
      try {
        await this.processSquadOutput(task._id, jsonOutput);
        console.log('✅ Squad Lead output processed successfully');
      } catch (processError) {
        console.error(`⚠️ Failed to process Squad Lead output: ${processError.message}`);
      }

      return true;
    } catch (error) {
      console.error(`❌ Mission analysis failed: ${error.message}`);
      await this.failTask(task._id, error);
      return false;
    }
  }

  async processSquadOutput(taskId, output) {
    const response = await fetch(`${config.hqApiUrl}/tasks/${taskId}/process-squad-output`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.hqApiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ output })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to process squad output: ${error}`);
    }

    return await response.json();
  }

  /**
   * Handle when Squad Lead needs human input
   * Creates a task for the human to answer questions
   */
  async handleNeedsHumanInfo(task, questionsContent, startTime) {
    console.log('❓ Squad Lead necesita información del humano');

    // Mark current task as awaiting human response
    try {
      await fetch(`${config.hqApiUrl}/tasks/${task._id}/status`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.hqApiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status: 'awaiting_human_response',
          output: {
            success: true,
            result: { questions: questionsContent, needsHumanInput: true },
            duration: Date.now() - startTime
          }
        })
      });

      // Create a task for the human to answer
      const humanTaskResponse = await fetch(`${config.hqApiUrl}/tasks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.hqApiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: `Responder preguntas de Squad Lead: ${task.title}`,
          description: `Squad Lead necesita información:\n\n${questionsContent}\n\nPor favor responde estas preguntas para que el Squad Lead pueda continuar con la misión.`,
          type: 'human_input',
          status: 'pending',
          missionId: task.missionId,
          input: {
            parentTaskId: task._id,
            agentId: config.agentId
          }
        })
      });

      if (!humanTaskResponse.ok) {
        throw new Error('Failed to create human task');
      }

      const humanTask = await humanTaskResponse.json();
      console.log(`✅ Tarea creada para humano: ${humanTask._id}`);

      // Store the human task ID in the mission for later resume
      await fetch(`${config.hqApiUrl}/missions/${task.missionId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${config.hqApiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          awaitingHumanTaskId: humanTask._id
        })
      });

      console.log('⏸️ Tarea en espera de respuesta humana');
      return true;
    } catch (error) {
      console.error('Error creating human task:', error);
      await this.failTask(task._id, error);
      return false;
    }
  }

  async run() {
    console.log('');
    console.log('🔄 HQ Polling Skill - Iniciando');
    console.log('================================');
    console.log(`📋 Agente: ${config.agentName}`);
    console.log(`🆔 ID: ${config.agentId || 'N/A'}`);
    console.log(`🔗 HQ API: ${config.hqApiUrl}`);
    console.log(`🤖 Modelo: ${config.llmProvider}/${config.llmModel}`);
    console.log(`⏱️  Poll Interval: ${config.pollInterval}ms`);
    console.log('================================');
    console.log('');

    this.running = true;

    while (this.running) {
      try {
        const task = await this.getNextTask();

        if (task) {
          await this.executeTask(task);
        } else {
          process.stdout.write('.');
          await this.sleep(config.pollInterval);
        }
      } catch (error) {
        console.error(`\n❌ Error en loop principal: ${error.message}`);
        await this.sleep(config.pollInterval);
      }
    }
  }

  stop() {
    console.log('\n👋 Deteniendo HQ Polling Skill...');
    this.running = false;
  }
}

// Run if called directly
if (require.main === module) {
  const skill = new HQPollingSkill();

  process.on('SIGTERM', () => skill.stop());
  process.on('SIGINT', () => skill.stop());

  skill.run().catch(console.error);
}

module.exports = { HQPollingSkill };
