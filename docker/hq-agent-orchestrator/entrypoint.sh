#!/bin/sh
# HQ Agent Orchestrator - Entry Point
#
# Arranca el polling skill como proceso principal. Mucho más simple que el
# entrypoint de hq-agent-openclaw: sin gateway HTTP, sin sync de auth-profiles,
# sin gosu. El skill habla directo a la API HQ para tareas y prompts, y spawnea
# Goose como subprocess para cada LLM call.
#
# Variables de entorno esperadas (pasadas por docker.service.createAgentContainer):
#   AGENT_ID, AGENT_NAME, AGENT_ROLE, AGENT_PERSONALITY
#   LLM_MODEL, LLM_PROVIDER
#   OPENAI_API_KEY (virtual key de LiteLLM, resuelta por la API desde MongoDB)
#   OPENAI_HOST (host del proxy LiteLLM)
#   HQ_API_URL, HQ_API_TOKEN
#   POLL_INTERVAL (ms, default 5000)

set -e

echo "🤖 HQ Agent Orchestrator - Iniciando..."
echo "   Agente: ${AGENT_NAME:-HQ Agent} (${AGENT_ROLE:-orchestrator})"
echo "   Modelo: ${LLM_MODEL:-glm-4.7}"
echo "   HQ API: ${HQ_API_URL:-http://api:3001/api}"

# Goose ya está instalado y configurado. El skill lo invoca por subprocess.
# Verificación rápida (no bloquea el arranque si falla por algo cosmético).
if command -v goose >/dev/null 2>&1; then
  echo "   Goose: $(goose --version 2>&1 | head -1)"
else
  echo "   ⚠️  Goose no encontrado en PATH — las tareas LLM fallarán"
fi

echo ""

# El skill maneja SIGTERM/SIGINT internamente para cerrar graceful.
# exec reemplaza el shell con el proceso Node (PID 1 = skill).
exec node /app/hq-polling-skill.cjs
