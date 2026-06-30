/**
 * Configuración central del skill — lee de variables de entorno.
 *
 * Un solo objeto `config` compartido por todos los módulos para evitar
 * parseos dispersos de process.env. Centraliza defaults.
 */
'use strict';

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

module.exports = { config };
