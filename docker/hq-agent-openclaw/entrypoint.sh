#!/usr/bin/env sh
# HQ Agent - OpenClaw Entry Point
# Sincroniza API keys desde MongoDB y ejecuta OpenClaw con configuración HQ

set -e

echo "🦞 HQ Agent (OpenClaw) - Iniciando..."

# Variables de entorno por defecto
MONGO_URI="${MONGO_URI:-mongodb://root:password@mongodb:27017/hq?authSource=admin}"
HQ_API_URL="${HQ_API_URL:-http://api:3001/api}"
HQ_API_TOKEN="${HQ_API_TOKEN:-hq-agent-token}"
AGENT_ID="${AGENT_ID:-}"
AGENT_NAME="${AGENT_NAME:-HQ Agent}"
AGENT_ROLE="${AGENT_ROLE:-Assistant}"
LLM_PROVIDER="${LLM_PROVIDER:-zai}"
LLM_MODEL="${LLM_MODEL:-glm-4.7}"

CONFIG_DIR="${OPENCLAW_CONFIG_DIR:-/home/node/.openclaw}"
CONFIG_FILE="${CONFIG_DIR}/openclaw.json"

echo "📡 MongoDB URI: ${MONGO_URI}"
echo "🤖 Agente: ${AGENT_NAME} (${AGENT_ROLE})"
echo "🔗 HQ API: ${HQ_API_URL}"

# Asegurar permisos del directorio
if [ "$(id -u)" = "0" ]; then
  if [ -d "$CONFIG_DIR" ]; then
    chown -R node:node "$CONFIG_DIR" 2>/dev/null || true
    chmod -R 755 "$CONFIG_DIR" 2>/dev/null || true
  fi

  # Crear directorio de agentes si no existe
  AGENT_DIR="/home/node/.openclaw/agents/main/agent"
  mkdir -p "$AGENT_DIR"
  chown -R node:node "$AGENT_DIR" 2>/dev/null || true
  chmod -R 755 "$AGENT_DIR" 2>/dev/null || true

  # Crear directorios opcionales de OpenClaw para evitar warnings
  # Nota: Estos directorios necesitan permisos especiales porque OpenClaw intenta escribir en ellos
  mkdir -p "/home/node/.openclaw/canvas" 2>/dev/null || true
  mkdir -p "/home/node/.openclaw/cron" 2>/dev/null || true
  mkdir -p "/home/node/.openclaw/workspace" 2>/dev/null || true

  # IMPORTANTE: Dar permisos completos al usuario node sobre estos directorios
  # OpenClaw necesita escribir en ellos durante su ejecución
  chown -R node:node "/home/node/.openclaw/canvas" "/home/node/.openclaw/cron" "/home/node/.openclaw/workspace" 2>/dev/null || true
  chmod -R 775 "/home/node/.openclaw/canvas" "/home/node/.openclaw/cron" "/home/node/.openclaw/workspace" 2>/dev/null || true

  # Verificar permisos de workspace
  if [ -d "/home/node/.openclaw/workspace" ]; then
    # Asegurar que el usuario node pueda escribir
    su node -c "mkdir -p /home/node/.openclaw/workspace/test" 2>/dev/null && rm -rf "/home/node/.openclaw/workspace/test" || {
      echo "⚠️  Warning: node user cannot write to workspace directory"
    }
  fi

  # Sincronizar API keys desde MongoDB a auth-profiles.json
  if [ -f /app/sync-auth-profiles.cjs ]; then
    echo "🔑 Sincronizando API keys desde MongoDB..."
    AGENT_DIR="$AGENT_DIR" \
      OPENCLAW_CONFIG_DIR="/home/node/.openclaw" \
      MONGO_URI="$MONGO_URI" \
      node /app/sync-auth-profiles.cjs || {
      echo "⚠️  Error sincronizando API keys (continuando)"
    }

    if [ -f "/home/node/.openclaw/agents/main/agent/auth-profiles.json" ]; then
      chown node:node "/home/node/.openclaw/agents/main/agent/auth-profiles.json" 2>/dev/null || true
      chmod 644 "/home/node/.openclaw/agents/main/agent/auth-profiles.json" 2>/dev/null || true
    fi
  fi

  # Generar variables de entorno
  ENV_FILE="/home/node/.openclaw/.env"
  if [ -f /app/generate-env-from-mongo.cjs ]; then
    MONGO_URI="$MONGO_URI" \
      node /app/generate-env-from-mongo.cjs > "$ENV_FILE" 2>/dev/null || {
      echo "⚠️  Error generando variables de entorno (continuando)"
    }

    if [ -f "$ENV_FILE" ]; then
      chown node:node "$ENV_FILE" 2>/dev/null || true
      chmod 600 "$ENV_FILE" 2>/dev/null || true
    fi
  fi

  # Configurar openclaw.json con provider y modelo (como root antes de cambiar de usuario)
  node -e "
  const fs = require('fs');
  const path = '$CONFIG_FILE';

  let config = {};
  if (fs.existsSync(path)) {
    config = JSON.parse(fs.readFileSync(path, 'utf8'));
  }

  // Configurar gateway en modo local
  config.gateway = config.gateway || {};
  config.gateway.mode = 'local';
  config.gateway.trustedProxies = ['172.16.0.0/12', '10.0.0.0/8'];
  config.gateway.auth = { mode: 'token', token: 'hq-local-token' };
  config.gateway.remote = { token: 'hq-local-token' };

  // Configurar modelo por defecto
  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {};
  config.agents.defaults.model = config.agents.defaults.model || {};
  config.agents.defaults.model.primary = '$LLM_PROVIDER/$LLM_MODEL';

  config.agents.defaults.models = config.agents.defaults.models || {};
  config.agents.defaults.models['$LLM_PROVIDER/$LLM_MODEL'] = {};

  // Configurar providers custom
  config.models = config.models || {};
  config.models.mode = 'merge';
  config.models.providers = config.models.providers || {};

  // Z.ai provider (OpenAI-compatible) - sin campo 'api'
  config.models.providers.zai = {
    baseUrl: 'https://api.z.ai/api/anthropic/chat/completions',
    models: [
      { id: 'glm-4.7', name: 'GLM-4.7', contextWindow: 128000 },
      { id: 'glm-4.7-flash', name: 'GLM-4.7 Flash', contextWindow: 128000 },
      { id: 'glm-4', name: 'GLM-4', contextWindow: 128000 },
      { id: 'glm-4-plus', name: 'GLM-4 Plus', contextWindow: 128000 },
      { id: 'glm-4-flash', name: 'GLM-4 Flash', contextWindow: 128000 }
    ]
  };

  // MiniMax provider (OpenAI-compatible) - uses different model names than native API
  config.models.providers.minimax = {
    baseUrl: 'https://api.minimax.io/v1/chat/completions',
    models: [
      { id: 'MiniMax-M2.5', name: 'MiniMax M2.5', contextWindow: 204800 },
      { id: 'MiniMax-M2.1', name: 'MiniMax M2.1', contextWindow: 204800 },
      { id: 'MiniMax-Text-01', name: 'MiniMax Text 01', contextWindow: 200000 }
    ]
  };

  fs.writeFileSync(path, JSON.stringify(config, null, 2));
  console.log('✅ OpenClaw configurado');
"

  # Copiar skill de polling HQ si existe
  if [ -f /app/hq-polling-skill.cjs ]; then
    SKILLS_DIR="/home/node/.openclaw/skills"
    mkdir -p "$SKILLS_DIR"
    cp /app/hq-polling-skill.cjs "$SKILLS_DIR/hq-polling.js"
    chown node:node "$SKILLS_DIR/hq-polling.js" 2>/dev/null || true
    chmod 644 "$SKILLS_DIR/hq-polling.js" 2>/dev/null || true
    echo "📦 HQ polling skill instalado"
  fi

  # Crear script de inicio que ejecuta ambos procesos
  cat > /app/start-hq-agent.sh << 'START_SCRIPT'
#!/bin/sh
echo "🦞 Iniciando OpenClaw Gateway..."
node /app/dist/index.js gateway --allow-unconfigured &
OPENCLAW_PID=$!

echo "⏳ Esperando que OpenClaw Gateway esté listo..."
sleep 10

echo "🔄 Iniciando HQ Polling Skill..."
node /app/hq-polling-skill.cjs &
POLLING_PID=$!

echo "✅ Ambos procesos iniciados"

# Manejar señales (usar TERM en lugar de SIGTERM)
cleanup() {
  echo "🛑 Deteniendo procesos..."
  kill $OPENCLAW_PID 2>/dev/null || true
  kill $POLLING_PID 2>/dev/null || true
  wait
  echo "👋 Procesos terminados"
}

trap cleanup TERM INT

# Esperar indefinidamente (los procesos corren en background)
wait
START_SCRIPT

  chmod +x /app/start-hq-agent.sh
  chown node:node /app/start-hq-agent.sh

  # Ahora cambiar al usuario node y ejecutar el script de inicio
  echo "👤 Cambiando al usuario node..."
  exec gosu node /app/start-hq-agent.sh
fi

# Si llegamos aquí, algo salió mal
echo "❌ Error: el script debería haber ejecutado gosu"
exit 1
