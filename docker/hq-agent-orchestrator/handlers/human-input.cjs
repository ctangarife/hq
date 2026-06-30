/**
 * Handler de pedidos de input humano.
 *
 * Cuando el Squad Lead dice NEED_INFO (o su respuesta parece una pregunta),
 * este handler marca la tarea como awaiting_human_response y crea una tarea
 * human_input para que el usuario responda en la UI.
 */
'use strict';

const fetch = require('node-fetch');
const { config } = require('../lib/config.cjs');
const { failTask } = require('../lib/hq-api.cjs');

function authHeaders() {
  return {
    'Authorization': `Bearer ${config.hqApiToken}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Marcar la tarea como awaiting_human_response y crear una tarea human_input
 * para que el usuario responda. Guarda el ID en la misión para el resume.
 *
 * @param {object} task - la tarea mission_analysis que necesita info
 * @param {string} questionsContent - las preguntas formateadas para el humano
 * @param {number} startTime - timestamp de inicio (para duración)
 * @returns {Promise<boolean>} true si quedó en espera
 */
async function handleNeedsHumanInfo(task, questionsContent, startTime) {
  console.log('❓ Squad Lead necesita información del humano');

  try {
    // 1. Marcar tarea actual como awaiting_human_response
    await fetch(`${config.hqApiUrl}/tasks/${task._id}/status`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        status: 'awaiting_human_response',
        output: {
          success: true,
          result: { questions: questionsContent, needsHumanInput: true },
          duration: Date.now() - startTime,
        },
      }),
    });

    // 2. Crear tarea human_input para que el usuario responda
    const humanTaskResponse = await fetch(`${config.hqApiUrl}/tasks`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        title: `Responder preguntas de Squad Lead: ${task.title}`,
        description: `Squad Lead necesita información:\n\n${questionsContent}\n\nPor favor responde estas preguntas para que el Squad Lead pueda continuar con la misión.`,
        type: 'human_input',
        status: 'pending',
        missionId: task.missionId,
        input: { parentTaskId: task._id, agentId: config.agentId },
      }),
    });

    if (!humanTaskResponse.ok) {
      throw new Error('Failed to create human task');
    }

    const humanTask = await humanTaskResponse.json();
    console.log(`✅ Tarea creada para humano: ${humanTask._id}`);

    // 3. Guardar el ID en la misión para el flujo de resume
    await fetch(`${config.hqApiUrl}/missions/${task.missionId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ awaitingHumanTaskId: humanTask._id }),
    });

    console.log('⏸️ Tarea en espera de respuesta humana');
    return true;
  } catch (error) {
    console.error('Error creating human task:', error);
    await failTask(task._id, error);
    return false;
  }
}

module.exports = { handleNeedsHumanInfo };
