#!/usr/bin/env node
/**
 * HQ Polling Skill - Orchestrator (Goose runtime)
 *
 * Port 1:1 de docker/hq-agent-openclaw/hq-polling-skill.cjs, adaptado para
 * correr como proceso persistente que invoca Goose como subprocess para cada
 * LLM call (en vez de callLLM directo a providers).
 *
 * Qué hace este skill:
 *   - Polling loop: consulta GET /tasks/agent/:id/next cada POLL_INTERVAL ms.
 *   - Ejecuta tareas de orquestación: mission_analysis (Squad Lead two-step),
 *     auditor_review (con auto-execute de decisiones).
 *   - Web scraping para web_search vía /resources/browser/extract de la API HQ.
 *   - Streaming simulation (partial output en chunks).
 *
 * Diferencias con el skill de openclaw:
 *   1. callLLM() → callGoose(): spawn `goose run --no-session --output-format
 *      text -i -`, pasa el prompt por stdin, captura stdout, filtra banner.
 *   2. System prompts se resuelven de MongoDB vía GET /api/prompts/resolve/:key
 *      (con fallback al prompt embebido si la API falla).
 *   3. Eliminado todo el boilerplate de providers/auth-profiles/openclaw
 *      gateway: Goose + LiteLLM proxy centraliza credenciales y modelos.
 *
 * Uso: arrancado por entrypoint.sh como PID 1 (proceso persistente).
 */

const { spawn } = require('child_process');
const fetch = require('node-fetch');

// Configuration from environment
const config = {
  agentId: process.env.AGENT_ID,
  agentName: process.env.AGENT_NAME || 'HQ Agent',
  agentRole: process.env.AGENT_ROLE || 'orchestrator',
  agentPersonality: process.env.AGENT_PERSONALITY || '',
  llmProvider: process.env.LLM_PROVIDER || 'litellm',
  llmModel: process.env.LLM_MODEL || process.env.GOOSE_MODEL || 'glm-4.7',
  hqApiUrl: process.env.HQ_API_URL || 'http://api:3001/api',
  hqApiToken: process.env.HQ_API_TOKEN || 'hq-agent-token',
  pollInterval: parseInt(process.env.POLL_INTERVAL || '5000', 10),
  // Goose subprocess config
  gooseModel: process.env.GOOSE_MODEL || 'glm-4.7',
  gooseTimeoutMs: parseInt(process.env.GOOSE_TIMEOUT_MS || '300000', 10),
};

// Cache en memoria de prompts resueltos desde MongoDB. Se invalida por TTL
// para capturar ediciones del admin sin reiniciar el container.
const promptCache = new Map();
const PROMPT_CACHE_TTL_MS = 60_000; // 1 min

/**
 * Limpiar el output de Goose: quitar el banner ASCII art y metadata de sesión,
 * dejando solo la respuesta del modelo.
 *
 * Mismo filtrado que docker.service.cleanGooseOutput() en la API — mantenerlos
 * en sync si el banner de Goose cambia.
 *
 * Goose imprime al arrancar:
 *       __( O)>  ● new session · openai glm-4.7
 *      \____)    20260617_1 · /workspace
 *        L L     goose is ready
 */
function cleanGooseOutput(raw) {
  const lines = raw.split('\n');
  const cleaned = [];
  let pastBanner = false;

  for (const line of lines) {
    if (!pastBanner) {
      if (line.includes('goose is ready') || line.includes('new session')) {
        continue;
      }
      if (line.includes('__( O)>') || line.includes('\\____)') || line.includes('L L')) {
        continue;
      }
      pastBanner = true;
    }
    cleaned.push(line);
  }

  return cleaned.join('\n').trim();
}

/**
 * Resolver un prompt desde MongoDB vía la API HQ, con cache y fallback.
 *
 * Endpoint: GET /api/prompts/resolve/:key?workspaceId=...&projectId=...
 * Devuelve { key, content } donde content tiene las variables reemplazadas.
 *
 * Si la API falla o no hay prompt seedeado, devuelve el fallback embebido
 * (para que el skill nunca se bloquee por resolución de prompt).
 *
 * @param key - 'mission_analysis', 'auditor_review', etc.
 * @param fallback - prompt hardcoded del skill (usado si la API falla)
 * @param variables - { agentName, missionTitle, ... } para reemplazar {{var}}
 */
async function resolvePrompt(key, fallback, variables = {}) {
  const cacheKey = `${key}:${variables.workspaceId || ''}:${variables.projectId || ''}`;
  const cached = promptCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < PROMPT_CACHE_TTL_MS) {
    return cached.content;
  }

  try {
    const params = new URLSearchParams();
    if (variables.workspaceId) params.set('workspaceId', variables.workspaceId);
    if (variables.projectId) params.set('projectId', variables.projectId);
    // Pasar variables extra para reemplazo de {{var}} en el prompt
    for (const [k, v] of Object.entries(variables)) {
      if (!['workspaceId', 'projectId'].includes(k) && v != null) {
        params.set(k, String(v));
      }
    }

    const url = `${config.hqApiUrl}/prompts/resolve/${key}?${params}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${config.hqApiToken}` },
    });

    if (response.ok) {
      const data = await response.json();
      if (data.content) {
        promptCache.set(cacheKey, { content: data.content, ts: Date.now() });
        return data.content;
      }
    }
    console.warn(`[prompts] resolve '${key}' returned ${response.status}, using fallback`);
  } catch (err) {
    console.warn(`[prompts] resolve '${key}' failed: ${err.message}, using fallback`);
  }

  return fallback;
}

/**
 * Formatear messages OpenAI (system + user) como un prompt plano para Goose.
 *
 * Goose recibe un solo prompt por stdin (no soporta messages array separado).
 * Concatenamos el system message como contexto inicial y el user como la
 * instrucción principal. Esto preserva el two-step del Squad Lead y el JSON
 * schema del auditor.
 */
function formatMessagesForGoose(messages) {
  let systemParts = [];
  let userParts = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(msg.content);
    } else {
      userParts.push(msg.content);
    }
  }

  let prompt = '';
  if (systemParts.length > 0) {
    prompt += systemParts.join('\n\n') + '\n\n---\n\n';
  }
  prompt += userParts.join('\n\n');
  return prompt;
}

class HQPollingSkill {
  constructor() {
    this.running = false;
    this.currentTask = null;
    console.log('✅ Polling skill inicializado (orchestrator mode, LLM via Goose subprocess → LiteLLM proxy)');
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Llamar al LLM vía Goose subprocess.
   *
   * Reemplaza el callLLM() del skill original que golpeaba /llm-config/chat.
   * Ahora Goose es el runtime de inferencia: recibe el prompt por stdin y
   * devuelve el output limpio por stdout.
   *
   * Devuelve un objeto con la misma forma que el endpoint OpenAI-compatible
   * ({ choices: [{ message: { content } }] }) para mantener compatibilidad con
   * el código existente que hace result.choices[0]?.message?.content.
   */
  async callGoose(messages) {
    const prompt = formatMessagesForGoose(messages);

    console.log(`🪿 Goose subprocess (${messages.length} messages, ${prompt.length} chars prompt)`);

    return new Promise((resolve, reject) => {
      const goose = spawn('goose', [
        'run',
        '--no-session',
        '--output-format', 'text',
        '-i', '-',
      ], {
        env: {
          ...process.env,
          GOOSE_MODEL: config.gooseModel,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { goose.kill('SIGKILL'); } catch {}
          reject(new Error(`Goose subprocess timed out after ${config.gooseTimeoutMs}ms`));
        }
      }, config.gooseTimeoutMs);

      goose.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      goose.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        // Log stderr pero no fallar (Goose imprime info de sesión ahí a veces)
        if (process.env.GOOSE_DEBUG) {
          process.stderr.write(chunk);
        }
      });

      goose.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Failed to spawn goose: ${err.message}`));
        }
      });

      goose.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        const content = cleanGooseOutput(stdout);

        if (code !== 0 && !content) {
          reject(new Error(`Goose exited with code ${code}: ${stderr.slice(0, 500)}`));
          return;
        }

        // Devolver en formato OpenAI-like para compatibilidad con el resto del skill
        resolve({
          choices: [{ message: { content } }],
        });
      });

      // Pasar el prompt por stdin y cerrar (Goose lee con -i -)
      goose.stdin.write(prompt);
      goose.stdin.end();
    });
  }

  /**
   * Split text into chunks for streaming simulation
   */
  splitIntoChunks(text, chunkSize) {
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
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

  /**
   * Send partial output during task execution (for streaming)
   */
  async sendPartialOutput(taskId, chunk) {
    try {
      await fetch(`${config.hqApiUrl}/tasks/${taskId}/partial-output`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.hqApiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ chunk, append: true })
      });
      // Don't log to avoid spam
    } catch (error) {
      // Silent fail - partial output is optional
      console.error('Error sending partial output:', error.message);
    }
  }

  async failTask(taskId, error) {
    try {
      const response = await fetch(`${config.hqApiUrl}/tasks/${taskId}/fail`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.hqApiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: error.message || String(error) })
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`❌ Tarea fallida: ${taskId}`);

        // Check if task needs audit (reached max retries)
        if (data.needsAudit) {
          console.log(`🔍 Tarea alcanzó máximo de reintentos - Creando auditoría`);
          await this.createAuditTask(data.task, error);
        }
      }
    } catch (err) {
      console.error('Error failing task:', err.message);
    }
  }

  /**
   * Create an auditor_review task for a failed task
   */
  async createAuditTask(failedTask, error) {
    try {
      // Get retry history for context
      const retryHistory = failedTask.retryHistory || [];
      const retryInfo = retryHistory.map((r, i) =>
        `Intento ${i + 1}: ${r.error} (${r.timestamp ? new Date(r.timestamp).toISOString() : 'unknown'})`
      ).join('\n');

      const auditTask = {
        title: `Auditoría: ${failedTask.title}`,
        description: `Analizar por qué falló esta tarea y decidir la mejor acción de recuperación.

TAREA ORIGINAL:
- Título: ${failedTask.title}
- Descripción: ${failedTask.description || 'Sin descripción'}
- Tipo: ${failedTask.type}
- Agente asignado: ${failedTask.assignedTo || 'N/A'}
- Rol de agente: ${failedTask.input?.agentRole || 'N/A'}

ERROR:
${error.message || String(error)}

HISTORIAL DE REINTENTOS (${retryHistory.length}/${failedTask.maxRetries || 3}):
${retryInfo}

ANALIZA y decide la mejor acción:
1. ¿El agente no tiene las habilidades necesarias? → REASSIGN
2. ¿La tarea está mal definida? → REFINE
3. ¿Falta información/archivos? → ESCALATE_HUMAN
4. ¿Una tarea previa falló? → RECREATE
5. ¿Error temporal (timeout, red)? → RETRY

Responde SOLO con JSON (sin markdown, sin explicaciones):
{
  "decision": "reassign|refine|escalate_human|retry",
  "reason": "Breve explicación",
  "suggestedAgentRole": "researcher|developer|writer|analyst|null",
  "refinedDescription": "Descripción mejorada de la tarea",
  "questionForHuman": "Qué información necesitas?"
}`,
        type: 'auditor_review',
        status: 'pending',
        missionId: failedTask.missionId,
        priority: 'high',
        input: {
          failedTaskId: failedTask._id,
          originalTaskType: failedTask.type,
          originalAssignedTo: failedTask.assignedTo,
          originalAgentRole: failedTask.input?.agentRole,
          error: error.message,
          retryHistory: retryHistory,
          retryCount: retryHistory.length
        }
      };

      const response = await fetch(`${config.hqApiUrl}/tasks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.hqApiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(auditTask)
      });

      if (response.ok) {
        const auditTaskData = await response.json();
        console.log(`✅ Tarea de auditoría creada: ${auditTaskData._id}`);

        // Link failed task to audit task
        await fetch(`${config.hqApiUrl}/tasks/${failedTask._id}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${config.hqApiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            auditorReviewId: auditTaskData._id
          })
        });
      } else {
        console.error('❌ Error creando tarea de auditoría');
      }
    } catch (err) {
      console.error('Error creating audit task:', err.message);
    }
  }

  /**
   * Extract URLs from text using regex
   */
  extractUrls(text) {
    if (!text) return []
    const urlRegex = /(https?:\/\/[^\s\])}">]+)/gi
    return text.match(urlRegex) || []
  }

  /**
   * Fetch content from URLs using the browser service
   */
  async fetchWebContent(urls) {
    const contents = []
    for (const url of urls) {
      try {
        console.log(`🌐 Fetching content from: ${url}`)
        const response = await fetch(`${config.hqApiUrl}/resources/browser/extract`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.hqApiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ url, options: { wait: 2000 } })
        })

        if (response.ok) {
          const data = await response.json()
          if (data.success) {
            contents.push({
              url: data.url,
              title: data.title,
              content: data.content
            })
            console.log(`✅ Fetched ${data.content?.length || 0} chars from ${url}`)
          }
        } else {
          console.log(`⚠️ Failed to fetch ${url}: ${response.statusText}`)
        }
      } catch (error) {
        console.log(`⚠️ Error fetching ${url}: ${error.message}`)
      }
    }

    return contents
  }

  /**
   * Execute a task using Goose, with web scraping support for web_search tasks
   */
  async executeTaskWithLLM(task) {
    const messages = [
      {
        role: 'system',
        content: config.agentPersonality ||
          `Eres ${config.agentName}, ${config.agentRole}. Responde SIEMPRE en español de forma concisa y útil.`
      }
    ];

    // Build prompt for the task
    let prompt = `# Tarea: ${task.title}\n\n`;

    if (task.description) {
      prompt += `Descripción: ${task.description}\n\n`;
    }

    if (task.input && Object.keys(task.input).length > 0) {
      prompt += `Datos de entrada:\n${JSON.stringify(task.input, null, 2)}\n\n`;
    }

    prompt += `Por favor ejecuta esta tarea y reporta el resultado en español.`;

    // For web_search tasks, fetch content from URLs first
    let webContent = ''
    if (task.type === 'web_search') {
      console.log('🔍 Web search task detected - looking for URLs...')

      // Extract URLs from multiple sources
      const urls = new Set()

      // From description
      const descUrls = this.extractUrls(task.description || '')
      descUrls.forEach(u => urls.add(u))

      // From input
      if (task.input) {
        // Check for urls array
        if (Array.isArray(task.input.urls)) {
          task.input.urls.forEach(u => urls.add(u))
        }
        // Check for single url string
        if (task.input.url) {
          urls.add(task.input.url)
        }
        // Extract from any text field
        Object.values(task.input).forEach(v => {
          if (typeof v === 'string') {
            this.extractUrls(v).forEach(u => urls.add(u))
          }
        })
      }

      // Fetch mission resources if available
      if (task.missionId) {
        try {
          const missionResponse = await fetch(`${config.hqApiUrl}/missions/${task.missionId}`, {
            headers: { 'Authorization': `Bearer ${config.hqApiToken}` }
          })

          if (missionResponse.ok) {
            const mission = await missionResponse.json()
            if (mission.resources && Array.isArray(mission.resources)) {
              console.log(`📦 Found ${mission.resources.length} mission resources`)
              mission.resources.forEach(r => {
                if (r.type === 'url' && Array.isArray(r.content)) {
                  r.content.forEach(u => urls.add(u))
                } else if (r.type === 'url' && typeof r.content === 'string') {
                  urls.add(r.content)
                }
              })
            }
          }
        } catch (e) {
          console.log(`⚠️ Could not fetch mission resources: ${e.message}`)
        }
      }

      if (urls.size > 0) {
        console.log(`🌐 Found ${urls.size} URLs to scrape: ${Array.from(urls).join(', ')}`)
        const scraped = await this.fetchWebContent(Array.from(urls))

        if (scraped.length > 0) {
          webContent = '\n\n# Contenido Web Extraído\n\n'
          scraped.forEach((item, i) => {
            webContent += `## Fuente ${i + 1}: ${item.title || item.url}\n`
            webContent += `URL: ${item.url}\n\n`
            webContent += `${item.content?.substring(0, 5000)}...\n\n` // Limit to 5000 chars per source
          })

          prompt = webContent + '\n\n# Tarea Original\n\n' + prompt
          console.log(`✅ Web content added: ${webContent.length} chars`)
        } else {
          console.log('⚠️ No content could be scraped from URLs')
        }
      } else {
        console.log('ℹ️ No URLs found in task - proceeding without web scraping')
      }
    }

    messages.push({ role: 'user', content: prompt });

    const result = await this.callGoose(messages);
    const content = result.choices[0]?.message?.content || result.content || '';

    // Simulate streaming by sending partial output in chunks
    // This gives the user visual feedback while the agent is "working"
    if (content && content.length > 100) {
      console.log(`📤 Enviando partial output (${content.length} caracteres)...`);

      // Split content into chunks and send with delays
      const chunks = this.splitIntoChunks(content, 200); // 200 char chunks
      for (let i = 0; i < chunks.length; i++) {
        // Send partial output
        await this.sendPartialOutput(task._id, chunks[i]);

        // Small delay between chunks (100ms) to simulate streaming
        if (i < chunks.length - 1) {
          await this.sleep(100);
        }
      }
    }

    // Simply return the content - question detection is handled elsewhere
    // (in executeMissionAnalysis for squad lead tasks)
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

      // Special handling for auditor_review tasks (Auditor agent)
      if (task.type === 'auditor_review') {
        return await this.executeAuditReview(task, startTime);
      }

      const result = await this.executeTaskWithLLM(task);

      console.log(`💡 Resultado (${Math.round((Date.now() - startTime) / 1000)}s):`);
      console.log(result);
      console.log('');

      // Complete the task with the result
      await this.completeTask(task._id, {
        success: true,
        result,
        duration: Date.now() - startTime
      });

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

    // Check if this is a resume task (with human input)
    const isResumeTask = task.input?.humanResponse || task.input?.originalTaskId;
    console.log('📋 ¿Es tarea de resume con input humano?', isResumeTask ? 'SÍ' : 'NO');

    // Fallbacks embebidos (usados si la API HQ no responde el prompt de MongoDB)
    const NEED_INFO_FALLBACK = `Eres un analista que revisa si hay información suficiente para crear un plan de trabajo.

TU ÚNICA FUNCIÓN: Determinar si la información dada es suficiente para crear tareas específicas.

REGLAS:
1. Responde SOLO "NEED_INFO" si falta información
2. Responde SOLO "CREATE_PLAN" si hay información suficiente

NO generes contenido. NO expliques. SOLO una de las dos palabras.`;

    const PLAN_FALLBACK = `Crea un plan de ejecución detallado para esta misión:

Genera un JSON con este formato:
{
  "needsMoreInfo": false,
  "complexity": "low|medium|high|critical",
  "summary": "Breve resumen del enfoque",
  "estimatedDuration": 123,
  "tasks": [
    {
      "id": "task-1",
      "title": "Título de la tarea",
      "description": "Descripción específica de qué hacer",
      "type": "web_search|data_analysis|content_generation|code_execution|custom",
      "dependencies": [],
      "priority": "high|medium|low",
      "assignedAgentRole": "researcher|developer|writer|analyst"
    }
  ],
  "agents": [
    {
      "id": "agent-1",
      "name": "Nombre del agente",
      "role": "researcher|developer|writer|analyst",
      "capabilities": ["capability1", "capability2"]
    }
  ]
}`;

    const RESUME_FALLBACK = `Eres un agente Squad Lead. Tu trabajo es analizar misiones y crear planes de ejecución.

IMPORTANTE: Ya recibiste información adicional del humano. DEBES crear un plan JSON ahora.

NO hagas más preguntas. La información que tienes es SUFICIENTE.

REGLAS PARA ESTA TAREA:
1. DEBES crear un plan JSON válido
2. NO hagas más preguntas
3. Usa la información proporcionada por el humano
4. Responde SIEMPRE en español

Crea el plan JSON con la siguiente información.`;

    let systemPrompt = '';
    let userPrompt = '';

    if (isResumeTask) {
      // Resolver el prompt de mission_analysis desde MongoDB (resume flow).
      // La API reemplaza {{agentName}} etc. Fallback al embebido.
      systemPrompt = await resolvePrompt('mission_analysis', RESUME_FALLBACK, {
        agentName: config.agentName,
      });

      userPrompt = `Analiza esta misión con la información adicional del humano:

Título: ${task.title}
Descripción: ${task.description || ''}

Plantillas de agentes disponibles:
- researcher: web_search, data_analysis, fact_checking
- developer: code_execution, code_review, debugging
- writer: content_generation, editing, documentation
- analyst: data_analysis, statistics, reporting

DEBES crear un plan JSON ahora. NO hagas preguntas.

Formato del plan JSON:
{
  "complexity": "low|medium|high|critical",
  "summary": "Breve resumen",
  "estimatedDuration": 123,
  "tasks": [
    {
      "id": "task-1",
      "title": "Título de la tarea",
      "description": "Qué se debe hacer",
      "type": "web_search|data_analysis|content_generation|code_execution|custom",
      "dependencies": [],
      "priority": "high|medium|low",
      "assignedAgentRole": "researcher|developer|writer|analyst"
    }
  ],
  "agents": [
    {
      "id": "agent-1",
      "name": "Nombre del agente",
      "role": "researcher|developer|writer|analyst",
      "capabilities": ["capability1"]
    }
  ]
}`;
    } else {
      // For initial mission analysis, use a TWO-STEP approach
      // Step 1: Ask if there's enough info (simple YES/NO question)
      systemPrompt = NEED_INFO_FALLBACK;

      userPrompt = `Analiza esta misión:

Título: ${task.title}
Descripción: ${task.description || ''}

PREGUNTA: ¿Es suficiente esta información para crear tareas específicas?

- "Dar una charla" sin tema específico → NEED_INFO
- "Generar contenido para evento" sin detalles → NEED_INFO
- "Crear una charla sobre Python para principiantes" → CREATE_PLAN
- "Investigar X y generar Y" → CREATE_PLAN

Responde SOLO "NEED_INFO" o "CREATE_PLAN":`;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    try {
      const result = await this.callGoose(messages);
      const content = result.choices[0]?.message?.content || result.content || '';

      console.log(`💡 Squad Lead Response (${Math.round((Date.now() - startTime) / 1000)}s):`);
      console.log(content);
      console.log('');

      // Handle TWO-STEP approach for initial analysis
      const isResumeTask = task.input?.humanResponse || task.input?.originalTaskId;

      if (!isResumeTask) {
        // Step 1: Check if response is NEED_INFO or CREATE_PLAN
        const cleanContent = content.trim().toUpperCase();

        if (cleanContent.includes('NEED_INFO') || cleanContent.includes('NECESITA_MAS_INFO')) {
          // Generate predefined questions based on mission type
          const questions = this.generateQuestionsForMission(task);

          const formattedQuestions = `🙋 El Squad Lead necesita más información para continuar:

${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

💬 Por favor responde estas preguntas para que el Squad Lead pueda generar el plan de ejecución.`;

          return await this.handleNeedsHumanInfo(task, formattedQuestions, startTime);
        }

        if (cleanContent.includes('CREATE_PLAN') || cleanContent.includes('CREAR_PLAN')) {
          // Step 2: Generate the full plan with a second call
          console.log('📋 Información suficiente, generando plan completo...');

          // Resolver el prompt de plan desde MongoDB (mission_analysis), fallback al embebido
          const planSystemPrompt = await resolvePrompt('mission_analysis', PLAN_FALLBACK, {
            agentName: config.agentName,
          });

          const planPrompt = `Crea un plan de ejecución detallado para esta misión:

Título: ${task.title}
Descripción: ${task.description || ''}

${PLAN_FALLBACK}`;

          const secondResult = await this.callGoose([
            { role: 'system', content: planSystemPrompt },
            { role: 'user', content: planPrompt }
          ]);

          const secondContent = secondResult.choices?.[0]?.message?.content || secondResult.content || content;

          // Try to parse the second response
          let jsonOutput;
          try {
            jsonOutput = JSON.parse(secondContent);
          } catch (e) {
            const jsonMatch = secondContent.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
            if (jsonMatch) {
              jsonOutput = JSON.parse(jsonMatch[1]);
            } else {
              const objectMatch = secondContent.match(/\{[\s\S]*\}/);
              if (objectMatch) {
                jsonOutput = JSON.parse(objectMatch[0]);
              } else {
                throw new Error('Failed to generate plan from second call: ' + secondContent.substring(0, 200));
              }
            }
          }

          // Continue to validation below
          // (jsonOutput is now set, validation follows after the parse block)
          return await this.processMissionPlan(task, jsonOutput, startTime);
        } else {
          // Fall through to original JSON parsing
        }
      }

      // FIRST: Try to parse as JSON (Squad Lead should always return JSON for mission analysis)
      let jsonOutput;
      let parseError = null;

      try {
        jsonOutput = JSON.parse(content);
      } catch (e) {
        // Try to extract JSON from markdown code blocks
        const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
        if (jsonMatch) {
          try {
            jsonOutput = JSON.parse(jsonMatch[1]);
          } catch (e2) {
            parseError = e2;
          }
        } else {
          // Try to find any JSON object in the response
          const objectMatch = content.match(/\{[\s\S]*\}/);
          if (objectMatch) {
            try {
              jsonOutput = JSON.parse(objectMatch[0]);
            } catch (e3) {
              parseError = e3;
            }
          } else {
            parseError = e;
          }
        }
      }

      // If JSON parsing succeeded, validate and process
      if (jsonOutput) {
        return await this.processMissionPlan(task, jsonOutput, startTime, content, parseError, isResumeTask);
      }

      // SECOND: If JSON parsing failed, check if this is a question/request for info
      if (!isResumeTask && parseError) {
        // Signs that this is a request for more information (no length limit)
        // Strong indicators that Squad Lead needs more info:
        const questionIndicators = [
          'para poder crear',
          'necesito que respondas',
          'para continuar',
          'respuesta fue:',
          'dato que falta',
          'información que necesito',
          'necesito que me proporciones',
          '¿cuál es el',
          '¿qué es el',
          '¿cuál es tu',
          'what is your',
          'please provide',
          'necesita saber',
          'requiero que',
          'para generar el plan',
          'una vez tenga',
          'responde lo siguiente'
        ];

        const isQuestionResponse = questionIndicators.some(indicator =>
          content.toLowerCase().includes(indicator.toLowerCase())
        );

        if (isQuestionResponse) {
          console.log('❓ Squad Lead is asking for more information');
          return await this.handleNeedsHumanInfo(task, content, startTime);
        }
      }

      // THIRD: If we get here, it's neither valid JSON nor a question
      throw new Error('Squad Lead did not return valid JSON or questions. Response was: ' + content.substring(0, 200));
    } catch (error) {
      console.error(`❌ Mission analysis failed: ${error.message}`);
      await this.failTask(task._id, error);
      return false;
    }
  }

  /**
   * Procesar un plan JSON validado del Squad Lead.
   * Extraído del flujo de executeMissionAnalysis para reducir anidamiento.
   */
  async processMissionPlan(task, jsonOutput, startTime, rawContent, parseError, isResumeTask) {
    // Check if Squad Lead needs more information
    if (jsonOutput.needsMoreInfo === true && jsonOutput.questions && Array.isArray(jsonOutput.questions)) {
      console.log('❓ Squad Lead needs more information:');
      jsonOutput.questions.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));

      const formattedQuestions = `🙋 El Squad Lead necesita más información para continuar:

${jsonOutput.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

💬 Por favor responde estas preguntas para que el Squad Lead pueda generar el plan de ejecución.`;

      return await this.handleNeedsHumanInfo(task, formattedQuestions, startTime);
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
  generateQuestionsForMission(task) {
    // Generate predefined questions based on mission title/description
    const title = (task.title || '').toLowerCase();
    const desc = (task.description || '').toLowerCase();

    // Content creation missions
    if (title.includes('charla') || title.includes('presentacion') || title.includes('presentación') ||
        title.includes('discurso') || title.includes('conferencia') || title.includes('talk')) {
      return [
        "¿Cuál es el tema o tópico específico de la charla?",
        "¿Quién es el perfil de la audiencia (principiantes, desarrolladores, expertos, negocios)?",
        "¿Qué tono prefieres (técnico, informal, inspiracional, educativo)?",
        "¿Requieres algún formato específico (slides, guion, solo speech)?",
        "¿Tienes material de referencia o enlaces base?"
      ];
    }

    // Development/technical missions
    if (title.includes('desarrollar') || title.includes('aplicacion') || title.includes('aplicación') ||
        title.includes('feature') || title.includes('codigo') || title.includes('código')) {
      return [
        "¿Qué tecnologias/frameworks específicos se deben usar?",
        "¿Hay requisitos funcionales específicos?",
        "¿Existe código base o se empieza desde cero?",
        "¿Qué tipo de autenticación/autorización se necesita?",
        "¿Hay restricciones de tiempo o presupuesto?"
      ];
    }

    // Research missions
    if (title.includes('investigar') || title.includes('analizar') || title.includes('buscar')) {
      return [
        "¿Qué aspecto específico se debe investigar?",
        "¿Fuentes de información preferidas o a evitar?",
        "¿Qué nivel de profundidad se necesita (resumen, detallado, técnico)?",
        "¿Hay algo específico que se quiere descubrir o validar?"
      ];
    }

    // Generic questions for other missions
    return [
      "¿Cuál es el objetivo específico de esta misión?",
      "¿Qué entregable concreto se espera?",
      "¿Hay restricciones o preferencias específicas?",
      "¿Qué información adicional me puedes dar para entender mejor qué necesitas?"
    ];
  }

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

  /**
   * Execute an auditor_review task
   * The auditor agent analyzes a failed task and decides on recovery action
   */
  async executeAuditReview(task, startTime) {
    console.log('🔍 Ejecutando revisión de auditoría...');

    const failedTaskId = task.input?.failedTaskId;
    if (!failedTaskId) {
      throw new Error('Audit task missing failedTaskId in input');
    }

    // Fallback embebido del system prompt del auditor (usado si la API no responde)
    const AUDIT_FALLBACK = `Eres un agente Auditor especializado en analizar tareas fallidas y decidir acciones de recuperación.

CRÍTICO: Debes responder SOLO con un objeto JSON válido (sin markdown, sin texto de explicación).

Tu decisión se ejecutará automáticamente, así que sé preciso.

IMPORTANTE: Responde SIEMPRE en español.

Tipos de decisión:
- reassign: Asignar a un tipo de agente diferente (cuando el agente carece de habilidades)
- refine: Reescribir la descripción de la tarea (cuando las instrucciones no son claras)
- escalate_human: Pedir información al usuario (cuando faltan datos)
- retry: Intentar de nuevo con el mismo agente (cuando el error fue temporal)

Formato de respuesta EXACTO:
{
  "decision": "reassign|refine|escalate_human|retry",
  "reason": "Breve explicación",
  "suggestedAgentRole": "researcher|developer|writer|analyst|null",
  "refinedDescription": "Descripción clara de la tarea",
  "questionForHuman": "¿Qué información necesitas?"
}

IMPORTANTE: Incluye solo los campos relevantes para tu decisión:
- reassign: Incluye suggestedAgentRole
- refine: Incluye refinedDescription
- escalate_human: Incluye questionForHuman
- retry: Solo decision y reason son necesarios`;

    // Resolver el system prompt del auditor desde MongoDB, fallback al embebido
    const systemPrompt = await resolvePrompt('auditor_review', AUDIT_FALLBACK, {
      agentName: config.agentName,
    });

    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: task.description + "\n\nResponde en español con el JSON de decisión."
      }
    ];

    try {
      const result = await this.callGoose(messages);
      const content = result.choices[0]?.message?.content || result.content || '';

      console.log(`💡 Auditor Response (${Math.round((Date.now() - startTime) / 1000)}s):`);
      console.log(content);
      console.log('');

      // Try to parse as JSON
      let decision;
      try {
        decision = JSON.parse(content);
      } catch (e) {
        // Try to extract JSON from markdown code blocks
        const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
        if (jsonMatch) {
          decision = JSON.parse(jsonMatch[1]);
        } else {
          // Try to find any JSON object in the response
          const objectMatch = content.match(/\{[\s\S]*\}/);
          if (objectMatch) {
            decision = JSON.parse(objectMatch[0]);
          } else {
            throw new Error('Auditor did not return valid JSON. Response was: ' + content.substring(0, 200));
          }
        }
      }

      // Validate decision field
      if (!decision.decision || !['reassign', 'refine', 'escalate_human', 'retry'].includes(decision.decision)) {
        throw new Error('Invalid decision: must be reassign, refine, escalate_human, or retry');
      }

      // Complete audit task with decision
      await this.completeTask(task._id, {
        success: true,
        result: decision,
        duration: Date.now() - startTime
      });

      // Execute the auditor's decision via API
      console.log(`🎬 Ejecutando decisión del auditor: ${decision.decision}`);
      await this.executeAuditorDecision(failedTaskId, decision);

      return true;
    } catch (error) {
      console.error(`❌ Audit review failed: ${error.message}`);
      await this.failTask(task._id, error);
      return false;
    }
  }

  /**
   * Execute the auditor's decision on the failed task
   */
  async executeAuditorDecision(failedTaskId, decision) {
    try {
      const response = await fetch(`${config.hqApiUrl}/tasks/${failedTaskId}/auditor-decision`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.hqApiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(decision)
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to execute auditor decision: ${error}`);
      }

      const result = await response.json();
      console.log(`✅ Decisión ejecutada: ${result.message}`);
      return result;
    } catch (error) {
      console.error('Error executing auditor decision:', error.message);
      throw error;
    }
  }

  async run() {
    console.log('');
    console.log('🔄 HQ Polling Skill - Iniciando (Orchestrator / Goose)');
    console.log('================================');
    console.log(`📋 Agente: ${config.agentName}`);
    console.log(`🆔 ID: ${config.agentId || 'N/A'}`);
    console.log(`🎭 Rol: ${config.agentRole}`);
    console.log(`🔗 HQ API: ${config.hqApiUrl}`);
    console.log(`🪿 Goose Modelo: ${config.gooseModel}`);
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
