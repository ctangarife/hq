/**
 * Resolución de prompts editables desde MongoDB (con cache + fallback).
 *
 * El skill no tiene los prompts hardcodeados: los resuelve desde la API HQ
 * (colección `prompts`), que hace la resolución por capas
 * (project → workspace → global) y reemplaza las variables {{var}}.
 *
 * Si la API falla o no hay prompt seedeado, devuelve el `fallback` embebido
 * por el caller — así el skill nunca se bloquea por resolución de prompt.
 */
'use strict';

const fetch = require('node-fetch');
const { config } = require('./config.cjs');

// Cache en memoria. Se invalida por TTL para capturar ediciones del admin
// sin reiniciar el container.
const promptCache = new Map();
const PROMPT_CACHE_TTL_MS = 60_000; // 1 min

/**
 * Resolver un prompt desde MongoDB vía la API HQ.
 *
 * @param {string} key - 'mission_analysis', 'auditor_review', etc.
 * @param {string} fallback - prompt embebido (usado si la API falla)
 * @param {object} variables - { agentName, missionTitle, workspaceId, ... }
 * @returns {Promise<string>} content con variables reemplazadas
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

module.exports = { resolvePrompt };
