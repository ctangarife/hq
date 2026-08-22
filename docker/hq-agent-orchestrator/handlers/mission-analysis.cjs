/**
 * Handler de tareas mission_analysis (Squad Lead).
 *
 * Two-step flow:
 *   1. Pregunta al LLM si hay info suficiente (NEED_INFO / CREATE_PLAN).
 *   2. Si CREATE_PLAN → segunda llamada que genera el plan JSON.
 *   Si NEED_INFO → pide input humano (genera preguntas predeterminadas).
 *
 * También soporta tareas de "resume" (con humanResponse ya provista) que
 * saltan directo a generar el plan.
 *
 * BUG FIX vs el original: en el código monolítico, `isResumeTask` se declaraba
 * dos veces (const redeclarada) y `jsonOutput` se usaba antes de declararse en
 * la rama CREATE_PLAN — funcionaba por accidente (hoisting + control de flujo).
 * Aquí el flujo es lineal y sin redeclaraciones.
 */
'use strict';

const { callGoose } = require('../lib/goose.cjs');
const { resolvePrompt } = require('../lib/prompts.cjs');
const { completeTask, failTask, processSquadOutput } = require('../lib/hq-api.cjs');
const { config } = require('../lib/config.cjs');
const { handleNeedsHumanInfo } = require('./human-input.cjs');

// ── Fallbacks embebidos (usados si la API HQ no responde el prompt de Mongo) ──

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

/**
 * Intentar parsear JSON de la respuesta del LLM, tolerante a markdown
 * code blocks, JSON embebido en texto, y trailing commas (un mal habitual
 * de los LLMs que rompe JSON.parse estricto).
 *
 * @returns {object|null} el JSON parseado, o null si no se pudo extraer
 */
function parseJsonFromContent(content) {
  const candidates = [];

  // 1. JSON directo
  candidates.push(content);

  // 2. Code block ```json ... ```
  const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
  if (jsonMatch) candidates.push(jsonMatch[1]);

  // 3. Cualquier objeto { ... } en el texto
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) candidates.push(objectMatch[0]);

  for (const candidate of candidates) {
    // Sanitizar trailing commas: {...,} o [...,] — JSON inválido que los
    // LLMs generan con frecuencia. JSON5-style tolerance mínima.
    const sanitized = candidate.replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(sanitized);
    } catch {}
  }

  return null;
}

/**
 * Generar preguntas predeterminadas según el tipo de misión (por keywords
 * en título). Usado cuando el LLM dice NEED_INFO.
 */
function generateQuestionsForMission(task) {
  const title = (task.title || '').toLowerCase();

  if (title.includes('charla') || title.includes('presentacion') || title.includes('presentación') ||
      title.includes('discurso') || title.includes('conferencia') || title.includes('talk')) {
    return [
      '¿Cuál es el tema o tópico específico de la charla?',
      '¿Quién es el perfil de la audiencia (principiantes, desarrolladores, expertos, negocios)?',
      '¿Qué tono prefieres (técnico, informal, inspiracional, educativo)?',
      '¿Requieres algún formato específico (slides, guion, solo speech)?',
      '¿Tienes material de referencia o enlaces base?',
    ];
  }

  if (title.includes('desarrollar') || title.includes('aplicacion') || title.includes('aplicación') ||
      title.includes('feature') || title.includes('codigo') || title.includes('código')) {
    return [
      '¿Qué tecnologias/frameworks específicos se deben usar?',
      '¿Hay requisitos funcionales específicos?',
      '¿Existe código base o se empieza desde cero?',
      '¿Qué tipo de autenticación/autorización se necesita?',
      '¿Hay restricciones de tiempo o presupuesto?',
    ];
  }

  if (title.includes('investigar') || title.includes('analizar') || title.includes('buscar')) {
    return [
      '¿Qué aspecto específico se debe investigar?',
      '¿Fuentes de información preferidas o a evitar?',
      '¿Qué nivel de profundidad se necesita (resumen, detallado, técnico)?',
      '¿Hay algo específico que se quiere descubrir o validar?',
    ];
  }

  return [
    '¿Cuál es el objetivo específico de esta misión?',
    '¿Qué entregable concreto se espera?',
    '¿Hay restricciones o preferencias específicas?',
    '¿Qué información adicional me puedes dar para entender mejor qué necesitas?',
  ];
}

/**
 * Procesar un plan JSON ya parseado: validar estructura, completar la tarea
 * y disparar el processSquadOutput en la API.
 *
 * Tolerante a dos schemas (el LLM puede seguir cualquiera de los dos):
 *   A) { tasks, agents } en raíz (el que pide PLAN_FALLBACK)
 *   B) { analysis, sufficient_info, plan: { tasks, agents } } (el que define
 *      el prompt seed de MongoDB 'mission_analysis')
 */
async function processMissionPlan(task, rawPlan, startTime) {
  // Normalizar schema B → A: si no hay tasks raíz pero sí plan.tasks, usar el anidado
  const plan = (!Array.isArray(rawPlan.tasks) && rawPlan.plan && Array.isArray(rawPlan.plan.tasks))
    ? { ...rawPlan.plan, needsMoreInfo: rawPlan.needsMoreInfo ?? rawPlan.sufficient_info === false, questions: rawPlan.questions }
    : rawPlan;

  // ¿El plan pide más info explícitamente?
  if (plan.needsMoreInfo === true && Array.isArray(plan.questions)) {
    console.log('❓ Squad Lead needs more information:');
    plan.questions.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));

    const formatted = `🙋 El Squad Lead necesita más información para continuar:

${plan.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

💬 Por favor responde estas preguntas para que el Squad Lead pueda generar el plan de ejecución.`;

    return await handleNeedsHumanInfo(task, formatted, startTime);
  }

  // Validar estructura mínima
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
    throw new Error('Invalid plan: "tasks" array missing or empty. Got: ' + JSON.stringify(rawPlan).slice(0, 200));
  }
  if (!Array.isArray(plan.agents) || plan.agents.length === 0) {
    throw new Error('Invalid plan: "agents" array missing or empty');
  }

  await completeTask(task._id, {
    success: true,
    result: plan,
    duration: Date.now() - startTime,
  });

  // Auto-procesar el output (la API crea agentes y tareas)
  try {
    await processSquadOutput(task._id, plan);
    console.log('✅ Squad Lead output processed successfully');
  } catch (processError) {
    console.error(`⚠️ Failed to process Squad Lead output: ${processError.message}`);
  }

  return true;
}

/**
 * Ejecutar la tarea mission_analysis completa (two-step o resume).
 *
 * @returns {Promise<boolean>} true si la tarea se procesó (completed/awaiting)
 */
async function executeMissionAnalysis(task, startTime) {
  console.log('🎯 Ejecutando análisis de misión (Squad Lead)...');

  const isResumeTask = !!(task.input?.humanResponse || task.input?.originalTaskId);
  console.log('📋 ¿Es tarea de resume con input humano?', isResumeTask ? 'SÍ' : 'NO');

  try {
    if (isResumeTask) {
      // ── Resume: generar plan directo con la info del humano ──
      return await runResumeFlow(task, startTime);
    }

    // ── Two-step: NEED_INFO / CREATE_PLAN ──
    return await runTwoStepFlow(task, startTime);
  } catch (error) {
    console.error(`❌ Mission analysis failed: ${error.message}`);
    await failTask(task._id, error);
    return false;
  }
}

/** Flujo resume: ya hay humanResponse, generar plan directo. */
async function runResumeFlow(task, startTime) {
  const systemPrompt = await resolvePrompt('mission_analysis', RESUME_FALLBACK, {
    agentName: config.agentName,
  });

  const userPrompt = `Analiza esta misión con la información adicional del humano:

Título: ${task.title}
Descripción: ${task.description || ''}

Plantillas de agentes disponibles:
- researcher: web_search, data_analysis, fact_checking
- developer: code_execution, code_review, debugging
- writer: content_generation, editing, documentation
- analyst: data_analysis, statistics, reporting

DEBES crear un plan JSON ahora. NO hagas preguntas.

Formato del plan JSON:
${PLAN_FALLBACK}`;

  const result = await callGoose([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);
  const content = result.choices[0]?.message?.content || '';

  console.log(`💡 Squad Lead Response (${Math.round((Date.now() - startTime) / 1000)}s):`);
  console.log(content);

  const plan = parseJsonFromContent(content);
  if (!plan) {
    throw new Error('Squad Lead (resume) did not return valid JSON. Response was: ' + content.slice(0, 200));
  }

  return await processMissionPlan(task, plan, startTime);
}

/** Flujo two-step: NEED_INFO / CREATE_PLAN. */
async function runTwoStepFlow(task, startTime) {
  // Step 1: ¿hay info suficiente?
  const systemPrompt = NEED_INFO_FALLBACK;
  const userPrompt = `Analiza esta misión:

Título: ${task.title}
Descripción: ${task.description || ''}

PREGUNTA: ¿Es suficiente esta información para crear tareas específicas?

- "Dar una charla" sin tema específico → NEED_INFO
- "Generar contenido para evento" sin detalles → NEED_INFO
- "Crear una charla sobre Python para principiantes" → CREATE_PLAN
- "Investigar X y generar Y" → CREATE_PLAN

Responde SOLO "NEED_INFO" o "CREATE_PLAN":`;

  const result = await callGoose([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);
  const content = result.choices[0]?.message?.content || '';

  console.log(`💡 Squad Lead Response (${Math.round((Date.now() - startTime) / 1000)}s):`);
  console.log(content);

  const cleanContent = content.trim().toUpperCase();

  // NEED_INFO → pedir input humano con preguntas predeterminadas
  if (cleanContent.includes('NEED_INFO') || cleanContent.includes('NECESITA_MAS_INFO')) {
    const questions = generateQuestionsForMission(task);
    const formatted = `🙋 El Squad Lead necesita más información para continuar:

${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

💬 Por favor responde estas preguntas para que el Squad Lead pueda generar el plan de ejecución.`;
    return await handleNeedsHumanInfo(task, formatted, startTime);
  }

  // CREATE_PLAN → segunda llamada para generar el plan completo
  if (cleanContent.includes('CREATE_PLAN') || cleanContent.includes('CREAR_PLAN')) {
    console.log('📋 Información suficiente, generando plan completo...');
    return await generatePlan(task, startTime);
  }

  // Fallback: intentar parsear la primera respuesta como JSON directamente
  const plan = parseJsonFromContent(content);
  if (plan) {
    return await processMissionPlan(task, plan, startTime);
  }

  // Último recurso: ¿parece una pregunta al humano?
  if (looksLikeQuestion(content)) {
    console.log('❓ Squad Lead is asking for more information');
    return await handleNeedsHumanInfo(task, content, startTime);
  }

  throw new Error('Squad Lead did not return valid JSON or questions. Response was: ' + content.slice(0, 200));
}

/** Step 2: segunda llamada que genera el plan JSON. */
async function generatePlan(task, startTime) {
  const planSystemPrompt = await resolvePrompt('mission_analysis', PLAN_FALLBACK, {
    agentName: config.agentName,
  });

  const planPrompt = `Crea un plan de ejecución detallado para esta misión:

Título: ${task.title}
Descripción: ${task.description || ''}

${PLAN_FALLBACK}`;

  const secondResult = await callGoose([
    { role: 'system', content: planSystemPrompt },
    { role: 'user', content: planPrompt },
  ]);
  const secondContent = secondResult.choices?.[0]?.message?.content || '';

  const plan = parseJsonFromContent(secondContent);
  if (!plan) {
    throw new Error('Failed to generate plan from second call: ' + secondContent.slice(0, 200));
  }

  return await processMissionPlan(task, plan, startTime);
}

/** Heurística: ¿la respuesta del LLM parece una pregunta al humano? */
function looksLikeQuestion(content) {
  const indicators = [
    'para poder crear', 'necesito que respondas', 'para continuar',
    'respuesta fue:', 'dato que falta', 'información que necesito',
    'necesito que me proporciones', '¿cuál es el', '¿qué es el',
    '¿cuál es tu', 'what is your', 'please provide', 'necesita saber',
    'requiero que', 'para generar el plan', 'una vez tenga', 'responde lo siguiente',
  ];
  const lower = content.toLowerCase();
  return indicators.some((ind) => lower.includes(ind.toLowerCase()));
}

module.exports = { executeMissionAnalysis };
