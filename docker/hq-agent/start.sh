#!/bin/sh
# HQ Agent - Script de inicio simplificado
# Ejecuta OpenClaw Agent directamente sin gateway/HTTP

set -e

echo "🔧 HQ Agent - Iniciando OpenClaw Agent..."
echo "📋 Configuración:"
echo "   Modelo: ${OPENCLAW_LLM_MODEL}"
echo "   Provider: ${OPENCLAW_LLM_PROVIDER}"

# Verificar que las variables esenciales estén presentes
if [ -z "$OPENCLAW_LLM_MODEL" ] || [ -z "$OPENCLAW_LLM_PROVIDER" ]; then
  echo "❌ Error: Faltan variables esenciales"
  echo "   Required: OPENCLAW_LLM_MODEL, OPENCLAW_LLM_PROVIDER"
  exit 1
fi

# Verificar API key
if [ -n "$ZAI_API_KEY" ]; then
  echo "   ✅ API Key: ZAI (configurada)"
elif [ -n "$ANTHROPIC_API_KEY" ]; then
  echo "   ✅ API Key: ANTHROPIC (configurada)"
elif [ -n "$OPENAI_API_KEY" ]; then
  echo "   ✅ API Key: OPENAI (configurada)"
else
  echo "   ⚠️  API Key: No configurada (usando credenciales de MongoDB)"
fi

echo ""
echo "🚀 Iniciando agente OpenClaw..."
echo ""

# Ejecutar OpenClaw Agent via script run-node
cd /app && exec node scripts/run-node.mjs agent --mode rpc --json "$@"
