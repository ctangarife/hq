#!/usr/bin/env node
/**
 * HQ Polling Skill - Orchestrator (Goose runtime)
 *
 * Proceso persistente para orquestadores (Squad Lead, Auditor). Hace polling
 * de tareas y las ejecuta. Cada LLM call va a Goose como subprocess (runtime
 * de inferencia), que a su vez habla al proxy LiteLLM centralizado.
 *
 * Este archivo es ahora el ORCHESTRADOR DELGADO: solo el polling loop + el
 * dispatch por tipo de tarea + la ejecución genérica. Toda la lógica de
 * negocio vive en módulos separados:
 *
 *   lib/goose.cjs        - subprocess de Goose (callGoose, cleanGooseOutput)
 *   lib/hq-api.cjs       - cliente HTTP de la API HQ (tasks, status, etc.)
 *   lib/prompts.cjs      - resolución de prompts editables desde MongoDB
 *   lib/web-scrape.cjs   - scraping para tareas web_search
 *   handlers/mission-analysis.cjs - two-step Squad Lead (NEED_INFO/CREATE_PLAN)
 *   handlers/auditor.cjs          - auditoría de tareas fallidas
 *   handlers/human-input.cjs      - pedir input humano
 *
 * Uso: arrancado por entrypoint.sh como PID 1 (proceso persistente).
 */
'use strict';

const fetch = require('node-fetch');
const { config } = require('./lib/config.cjs');
const { callGoose } = require('./lib/goose.cjs');
const {
  getNextTask, updateTaskStatus, completeTask, sendPartialOutput, failTask,
} = require('./lib/hq-api.cjs');
const { extractUrls, fetchWebContent } = require('./lib/web-scrape.cjs');
const { executeMissionAnalysis } = require('./handlers/mission-analysis.cjs');
const { executeAuditReview, createAuditTask } = require('./handlers/auditor.cjs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class HQPollingSkill {
  constructor() {
    this.running = false;
    console.log('✅ Polling skill inicializado (orchestrator mode, LLM via Goose subprocess → LiteLLM proxy)');
  }

  // ===================================================================
  // Ejecución de tareas
  // ===================================================================

  /**
   * Ejecutar una tarea según su tipo. Dispatch:
   *   - mission_analysis → handler de Squad Lead (two-step)
   *   - auditor_review  → handler del Auditor
   *   - demás           → ejecución genérica con LLM (+web scraping si web_search)
   */
  async executeTask(task) {
    const startTime = Date.now();

    try {
      console.log(`📋 Ejecutando tarea: [${task.type}] ${task.title}`);
      await updateTaskStatus(task._id);

      if (task.type === 'mission_analysis') {
        return await executeMissionAnalysis(task, startTime);
      }

      if (task.type === 'auditor_review') {
        return await executeAuditReview(task, startTime);
      }

      // Ejecución genérica
      const result = await this.executeTaskWithLLM(task);

      console.log(`💡 Resultado (${Math.round((Date.now() - startTime) / 1000)}s):`);
      console.log(result);
      console.log('');

      await completeTask(task._id, {
        success: true,
        result,
        duration: Date.now() - startTime,
      });

      return true;
    } catch (error) {
      console.error(`❌ Error ejecutando tarea: ${error.message}`);
      const failData = await failTask(task._id, { message: error.message });

      // Si la API dice que se agotaron los reintentos → crear auditoría
      if (failData.needsAudit && failData.task) {
        console.log(`🔍 Tarea alcanzó máximo de reintentos - Creando auditoría`);
        await createAuditTask(failData.task, { message: error.message });
      }

      return false;
    }
  }

  /**
   * Ejecutar una tarea genérica vía Goose, con web scraping para web_search.
   * Combina la personalidad del agente con los datos de la tarea.
   */
  async executeTaskWithLLM(task) {
    // Instrucción de entrega PRIMERO (máximo peso): el modelo debe entregar
    // el contenido final, no planificarlo. Sin esto glm-4.7+Goose responde
    // con planes/TODOs en vez del entregable.
    let prompt = `ENTREGA DIRECTAMENTE EL CONTENIDO FINAL PEDIDO. Tu respuesta ES el entregable — no un plan, no un análisis, no una propuesta.

`;
    prompt += `# Tarea: ${task.title}\n\n`;
    if (task.description) prompt += `Descripción: ${task.description}\n\n`;
    if (task.input && Object.keys(task.input).length > 0) {
      prompt += `Datos de entrada:\n${JSON.stringify(task.input, null, 2)}\n\n`;
    }
    prompt += `Por favor ejecuta esta tarea y reporta SOLO el resultado final en español.`;

    const messages = [
      {
        role: 'system',
        content: config.agentPersonality ||
          `Eres ${config.agentName}, ${config.agentRole}. Responde SIEMPRE en español de forma concisa y útil.`,
      },
    ];

    // Web scraping para web_search
    prompt = await this.enrichWithWebContent(task, prompt);

    messages.push({ role: 'user', content: prompt });

    const result = await callGoose(messages);
    const content = result.choices[0]?.message?.content || result.content || '';

    // Streaming simulation: enviar partial output en chunks
    if (content && content.length > 100) {
      console.log(`📤 Enviando partial output (${content.length} caracteres)...`);
      const chunks = this.splitIntoChunks(content, 200);
      for (let i = 0; i < chunks.length; i++) {
        await sendPartialOutput(task._id, chunks[i]);
        if (i < chunks.length - 1) await sleep(100);
      }
    }

    return content;
  }

  /**
   * Para tareas web_search: extraer URLs del task + recursos de la misión,
   * scrapearlas, y devolver el prompt enriquecido con el contenido.
   */
  async enrichWithWebContent(task, prompt) {
    if (task.type !== 'web_search') return prompt;

    console.log('🔍 Web search task detected - looking for URLs...');
    const urls = new Set();

    // De la descripción
    extractUrls(task.description || '').forEach((u) => urls.add(u));

    // Del input
    if (task.input) {
      if (Array.isArray(task.input.urls)) task.input.urls.forEach((u) => urls.add(u));
      if (task.input.url) urls.add(task.input.url);
      Object.values(task.input).forEach((v) => {
        if (typeof v === 'string') extractUrls(v).forEach((u) => urls.add(u));
      });
    }

    // De los recursos de la misión
    if (task.missionId) {
      try {
        const missionResponse = await fetch(`${config.hqApiUrl}/missions/${task.missionId}`, {
          headers: { Authorization: `Bearer ${config.hqApiToken}` },
        });
        if (missionResponse.ok) {
          const mission = await missionResponse.json();
          if (Array.isArray(mission.resources)) {
            console.log(`📦 Found ${mission.resources.length} mission resources`);
            mission.resources.forEach((r) => {
              if (r.type === 'url' && Array.isArray(r.content)) {
                r.content.forEach((u) => urls.add(u));
              } else if (r.type === 'url' && typeof r.content === 'string') {
                urls.add(r.content);
              }
            });
          }
        }
      } catch (e) {
        console.log(`⚠️ Could not fetch mission resources: ${e.message}`);
      }
    }

    if (urls.size === 0) {
      console.log('ℹ️ No URLs found in task - proceeding without web scraping');
      return prompt;
    }

    console.log(`🌐 Found ${urls.size} URLs to scrape: ${Array.from(urls).join(', ')}`);
    const scraped = await fetchWebContent(Array.from(urls));

    if (scraped.length === 0) {
      console.log('⚠️ No content could be scraped from URLs');
      return prompt;
    }

    let webContent = '\n\n# Contenido Web Extraído\n\n';
    scraped.forEach((item, i) => {
      webContent += `## Fuente ${i + 1}: ${item.title || item.url}\n`;
      webContent += `URL: ${item.url}\n\n`;
      webContent += `${item.content?.substring(0, 5000)}...\n\n`;
    });

    console.log(`✅ Web content added: ${webContent.length} chars`);
    return webContent + '\n\n# Tarea Original\n\n' + prompt;
  }

  splitIntoChunks(text, chunkSize) {
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
  }

  // ===================================================================
  // Loop principal
  // ===================================================================

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
        const task = await getNextTask();

        if (task) {
          await this.executeTask(task);
        } else {
          process.stdout.write('.');
          await sleep(config.pollInterval);
        }
      } catch (error) {
        console.error(`\n❌ Error en loop principal: ${error.message}`);
        await sleep(config.pollInterval);
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
