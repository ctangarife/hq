/**
 * Handler de tareas auditor_review.
 *
 * El auditor analiza una tarea fallida y decide la acción de recuperación:
 * reassign / refine / escalate_human / retry. La decisión se auto-ejecuta
 * vía la API (auditor-decision endpoint).
 *
 * También incluye createAuditTask: cuando una tarea fallida agota los
 * reintentos, el polling loop crea una tarea auditor_review para que este
 * handler la procese.
 */
'use strict';

const fetch = require('node-fetch');
const { callGoose } = require('../lib/goose.cjs');
const { resolvePrompt } = require('../lib/prompts.cjs');
const { completeTask, failTask, executeAuditorDecision } = require('../lib/hq-api.cjs');
const { config } = require('../lib/config.cjs');

function authHeaders() {
  return {
    'Authorization': `Bearer ${config.hqApiToken}`,
    'Content-Type': 'application/json',
  };
}

// Fallback embebido del system prompt del auditor
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

/**
 * Ejecutar una tarea auditor_review: analizar la tarea fallida y decidir.
 */
async function executeAuditReview(task, startTime) {
  console.log('🔍 Ejecutando revisión de auditoría...');

  const failedTaskId = task.input?.failedTaskId;
  if (!failedTaskId) {
    throw new Error('Audit task missing failedTaskId in input');
  }

  // Resolver el system prompt del auditor desde MongoDB, fallback al embebido
  const systemPrompt = await resolvePrompt('auditor_review', AUDIT_FALLBACK, {
    agentName: config.agentName,
  });

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: task.description + '\n\nResponde en español con el JSON de decisión.',
    },
  ];

  try {
    const result = await callGoose(messages);
    const content = result.choices[0]?.message?.content || '';

    console.log(`💡 Auditor Response (${Math.round((Date.now() - startTime) / 1000)}s):`);
    console.log(content);

    const decision = parseDecision(content);

    // Validar el campo decision
    if (!decision.decision || !['reassign', 'refine', 'escalate_human', 'retry'].includes(decision.decision)) {
      throw new Error('Invalid decision: must be reassign, refine, escalate_human, or retry');
    }

    // Completar la tarea de auditoría con la decisión
    await completeTask(task._id, {
      success: true,
      result: decision,
      duration: Date.now() - startTime,
    });

    // Ejecutar la decisión sobre la tarea fallida
    console.log(`🎬 Ejecutando decisión del auditor: ${decision.decision}`);
    await executeAuditorDecision(failedTaskId, decision);

    return true;
  } catch (error) {
    console.error(`❌ Audit review failed: ${error.message}`);
    await failTask(task._id, error);
    return false;
  }
}

/** Parsear la decisión JSON del output del auditor (tolerante a markdown). */
function parseDecision(content) {
  try {
    return JSON.parse(content);
  } catch {}

  const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch {}
  }

  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {}
  }

  throw new Error('Auditor did not return valid JSON. Response was: ' + content.slice(0, 200));
}

/**
 * Crear una tarea auditor_review para una tarea fallida que agotó reintentos.
 * (Llamado por el polling loop cuando failTask devuelve needsAudit.)
 */
async function createAuditTask(failedTask, error) {
  try {
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
        retryCount: retryHistory.length,
      },
    };

    const response = await fetch(`${config.hqApiUrl}/tasks`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(auditTask),
    });

    if (response.ok) {
      const auditTaskData = await response.json();
      console.log(`✅ Tarea de auditoría creada: ${auditTaskData._id}`);

      // Linkear la tarea fallida con la de auditoría
      await fetch(`${config.hqApiUrl}/tasks/${failedTask._id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ auditorReviewId: auditTaskData._id }),
      });
    } else {
      console.error('❌ Error creando tarea de auditoría');
    }
  } catch (err) {
    console.error('Error creating audit task:', err.message);
  }
}

module.exports = { executeAuditReview, createAuditTask };
