#!/bin/sh
set -e

echo "[HQ Entrypoint] Iniciando configuración de agente..."

# Variables de entorno
AGENT_NAME="${AGENT_NAME:-HQ-Agent}"
AGENT_ROLE="${AGENT_ROLE:-Assistant}"
AGENT_PERSONALITY="${AGENT_PERSONALITY:-You are a helpful AI assistant.}"
LLM_MODEL="${LLM_MODEL:-glm-4}"
LLM_PROVIDER="${LLM_PROVIDER:-zai}"

# Configuración de OpenClaw dentro del contenedor
OPENCLAW_DIR="/home/node/.openclaw"
AUTH_PROFILES_FILE="$OPENCLAW_DIR/auth-profiles.json"
CONFIG_FILE="$OPENCLAW_DIR/openclaw.json"

echo "[HQ Entrypoint] Configuración:"
echo "  Agent: $AGENT_NAME"
echo "  Role: $AGENT_ROLE"
echo "  Model: $LLM_MODEL"
echo "  Provider: $LLM_PROVIDER"

# Crear directorios necesarios
mkdir -p "$OPENCLAW_DIR/agents/main/agent"

# Función para obtener API key desde variables de entorno o credenciales guardadas
get_api_key() {
  local provider="$1"

  case "$provider" in
    zai)
      if [ -n "$ZAI_API_KEY" ]; then
        echo "$ZAI_API_KEY"
      else
        echo ""
      fi
      ;;
    anthropic)
      if [ -n "$ANTHROPIC_API_KEY" ]; then
        echo "$ANTHROPIC_API_KEY"
      else
        echo ""
      fi
      ;;
    openai)
      if [ -n "$OPENAI_API_KEY" ]; then
        echo "$OPENAI_API_KEY"
      else
        echo ""
      fi
      ;;
    *)
      echo ""
      ;;
  esac
}

# Obtener API key para el provider actual
API_KEY=$(get_api_key "$LLM_PROVIDER")

if [ -z "$API_KEY" ]; then
  echo "[HQ Entrypoint] WARNING: No API key found for provider $LLM_PROVIDER"
fi

# Crear auth-profiles.json para OpenClaw
echo "[HQ Entrypoint] Creando auth-profiles.json..."
cat > "$AUTH_PROFILES_FILE" << EOF
{
  "profiles": [
    {
      "id": "$LLM_PROVIDER",
      "provider": "$LLM_PROVIDER",
      "apiKey": "$API_KEY",
      "baseUrl": "",
      "models": []
    }
  ]
}
EOF

# Crear openclaw.json con configuración básica
echo "[HQ Entrypoint] Creando openclaw.json..."
cat > "$CONFIG_FILE" << EOF
{
  "gateway": {
    "token": "${OPENCLAW_GATEWAY_TOKEN:-hq-gateway-token}"
  },
  "agent": {
    "name": "$AGENT_NAME",
    "role": "$AGENT_ROLE",
    "description": "$AGENT_PERSONALITY"
  },
  "models": {
    "default": "$LLM_MODEL",
    "providers": {
      "$LLM_PROVIDER": {
        "id": "$LLM_PROVIDER",
        "models": [
          {
            "id": "$LLM_MODEL",
            "name": "$LLM_MODEL",
            "provider": "$LLM_PROVIDER"
          }
        ]
      }
    }
  }
}
EOF

echo "[HQ Entrypoint] Configuración completada"
echo "[HQ Entrypoint] auth-profiles.json:"
ls -la "$AUTH_PROFILES_FILE" 2>/dev/null || echo "  No creado"
echo "[HQ Entrypoint] openclaw.json:"
ls -la "$CONFIG_FILE" 2>/dev/null || echo "  No creado"

# Ejecutar el comando original (OpenClaw o el agente real)
echo "[HQ Entrypoint] Ejecutando agente..."
if [ -n "$*" ]; then
  exec node "$@"
else
  # Si no hay argumentos, iniciar el agente OpenClaw por defecto
  exec node /home/node/.openclaw/agents/main/agent/index.js
fi
