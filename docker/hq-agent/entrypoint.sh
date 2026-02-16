#!/usr/bin/env sh
# HQ Agent Entry Point
# Sincroniza API keys desde MongoDB y ejecuta el agente

set -e

echo "🦞 HQ Agent - Iniciando..."

# Variables de entorno por defecto
MONGO_URI="${MONGO_URI:-mongodb://root:1nt3r4ct1v3@mongodb:27017/hq?authSource=admin}"
# If MONGO_URI is not set, try building from individual components
if [ -z "$MONGO_URI" ] && [ -n "$MONGODB_USERNAME" ] && [ -n "$MONGODB_PASSWORD" ]; then
  MONGO_URI="mongodb://${MONGODB_USERNAME}:${MONGODB_PASSWORD}@mongodb:27017/${MONGODB_DATABASE:-hq}?authSource=admin"
fi
HQ_API_URL="${HQ_API_URL:-http://api:3001/api}"

echo "📡 MongoDB URI: ${MONGO_URI}"

# Función para generar y cargar variables de entorno
load_and_export_keys() {
  echo "🔑 Sincronizando API keys desde MongoDB..."

  # Crear archivo .env temporal
  ENV_FILE="/tmp/hq-agent.env"

  if MONGO_URI="$MONGO_URI" node /app/generate-env-from-mongo.cjs > "$ENV_FILE" 2>/dev/null; then
    echo "✅ API keys sincronizadas"

    # Cargar las variables de entorno
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        \#*|'') continue ;;
      esac
      if echo "$line" | grep -q "^export "; then
        var_def="${line#export }"
        var_name="${var_def%%=*}"
        var_value="${var_def#*=}"
        var_value="${var_value%\"}"
        var_value="${var_value#\"}"
        export "$var_name=$var_value"
      fi
    done < "$ENV_FILE"

    rm -f "$ENV_FILE"
  else
    echo "⚠️  No se pudieron sincronizar API keys (continuando con env vars del sistema)"
  fi
}

# Cargar API keys antes de iniciar el agente
load_and_export_keys

# Verificar configuración
echo "🤖 Agente: ${AGENT_NAME:-HQ Agent}"
echo "📊 Modelo: ${LLM_PROVIDER:-zai}/${LLM_MODEL:-glm-4}"
echo "🔗 HQ API: ${HQ_API_URL}"

# Iniciar el agente
exec node /app/index.js
