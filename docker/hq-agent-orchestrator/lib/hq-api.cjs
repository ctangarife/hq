/**
 * Cliente HTTP para la API HQ.
 *
 * Todas las llamadas a la API desde el skill (polling de tareas, actualizar
 * status, completar/fallar, procesar output, decisiones del auditor, pedir
 * input humano) viven aquí. Centraliza auth y error handling.
 *
 * Es deliberadamente "fire-and-forget" para operaciones no críticas (logs,
 * partial output) y lanza para las críticas (complete/fail) — igual que el
 * comportamiento original.
 */
'use strict';

const fetch = require('node-fetch');
const { config } = require('./config.cjs');

function authHeaders() {
  return {
    'Authorization': `Bearer ${config.hqApiToken}`,
    'Content-Type': 'application/json',
  };
}

/** Obtener la siguiente tarea pending para este agente (o null si no hay). */
async function getNextTask() {
  try {
    const response = await fetch(
      `${config.hqApiUrl}/tasks/agent/${config.agentId}/next`,
      { method: 'GET', headers: { 'Authorization': `Bearer ${config.hqApiToken}` } }
    );

    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`API error ${response.status}`);

    return await response.json();
  } catch (error) {
    console.error('Error fetching task:', error.message);
    return null;
  }
}

/** Marcar tarea como in_progress. */
async function updateTaskStatus(taskId) {
  try {
    await fetch(`${config.hqApiUrl}/tasks/${taskId}/start`, {
      method: 'POST', headers: authHeaders(),
    });
  } catch (error) {
    console.error('Error updating task status:', error.message);
  }
}

/** Completar tarea con output. */
async function completeTask(taskId, output) {
  try {
    await fetch(`${config.hqApiUrl}/tasks/${taskId}/complete`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ output }),
    });
    console.log(`✅ Tarea completada: ${taskId}`);
  } catch (error) {
    console.error('Error completing task:', error.message);
  }
}

/** Enviar partial output (streaming simulation). Silent fail si cae. */
async function sendPartialOutput(taskId, chunk) {
  try {
    await fetch(`${config.hqApiUrl}/tasks/${taskId}/partial-output`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ chunk, append: true }),
    });
  } catch (error) {
    console.error('Error sending partial output:', error.message);
  }
}

/**
 * Marcar tarea como fallida. Devuelve { needsAudit, task } para que el caller
 * decida si crear una tarea de auditoría (cuando se agotan los reintentos).
 */
async function failTask(taskId, error) {
  try {
    const response = await fetch(`${config.hqApiUrl}/tasks/${taskId}/fail`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ error: error.message || String(error) }),
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`❌ Tarea fallida: ${taskId}`);
      return data; // { needsAudit?: boolean, task?: object }
    }
  } catch (err) {
    console.error('Error failing task:', err.message);
  }
  return {};
}

/** Enviar el output del Squad Lead para que la API cree agentes y tareas. */
async function processSquadOutput(taskId, output) {
  const response = await fetch(`${config.hqApiUrl}/tasks/${taskId}/process-squad-output`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ output }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to process squad output: ${error}`);
  }

  return await response.json();
}

/** Ejecutar la decisión del auditor sobre la tarea fallida. */
async function executeAuditorDecision(failedTaskId, decision) {
  try {
    const response = await fetch(`${config.hqApiUrl}/tasks/${failedTaskId}/auditor-decision`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(decision),
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

module.exports = {
  getNextTask,
  updateTaskStatus,
  completeTask,
  sendPartialOutput,
  failTask,
  processSquadOutput,
  executeAuditorDecision,
};
