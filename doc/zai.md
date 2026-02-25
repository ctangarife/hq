# Z.ai Integration Guide

## Overview

Z.ai (Zhipu AI) es un proveedor de LLMs chino que ofrece modelos como `glm-4-plus`, `glm-4.7`, `glm-4.7-flash`, etc. Este documento documenta la integración completa de Z.ai en el sistema HQ.

## Endpoint Migration (2026-02-16)

### Problem

El endpoint original de Z.ai fue deprecado:
- **Old Endpoint**: `https://open.bigmodel.cn/api/paas/v4`
- **New Endpoint**: `https://api.z.ai/api/anthropic`

### Solution

Se actualizó el endpoint en todos los archivos del sistema que hacían referencia a Z.ai.

## Files Modified

### 1. Docker Container - Entrypoint
**File**: `docker/hq-agent-openclaw/entrypoint.sh`

```bash
# Updated Z.ai baseUrl
ZAI_BASE_URL="${ZAI_BASE_URL:-https://api.z.ai/api/anthropic}"
```

### 2. Docker Container - Polling Skill
**File**: `docker/hq-agent-openclaw/hq-polling-skill.cjs`

```javascript
// Updated Z.ai configuration
const PROVIDER_CONFIG = {
  zai: {
    baseUrl: process.env.ZAI_BASE_URL || 'https://api.z.ai/api/anthropic',
    type: 'openai-compatible'
  }
}
```

### 3. Backend Service - Z.ai Service
**File**: `api/src/services/zai.service.ts`

```typescript
// Updated default endpoint
private readonly ZAI_API_ENDPOINT = process.env.ZAI_API_ENDPOINT || 'https://api.z.ai/api/anthropic';
```

### 4. Backend Service - Provider Models
**File**: `api/src/services/provider-models.service.ts`

```typescript
// Updated fetchZaiModels default URL
const ZAI_DEFAULT_URL = 'https://api.z.ai/api/anthropic';
```

### 5. Initialization Script
**File**: `api/src/scripts/init-providers.ts`

```typescript
// Updated default provider configuration
{
  providerId: 'zai',
  apiEndpoint: 'https://api.z.ai/api/anthropic',
  // ...
}
```

## How Z.ai Works in OpenClaw Container

### Credential Flow

```
1. MongoDB (providers collection)
   ↓ sync-auth-profiles.cjs
2. /app/openclaw/profiles/auth-profiles.json
   ↓ OpenClaw framework loads
3. Agent authenticates with Z.ai API
   ↓ hq-polling-skill.cjs
4. LLM calls via OpenAI-compatible protocol
```

### auth-profiles.json Format

El archivo `auth-profiles.json` es generado dinámicamente por `sync-auth-profiles.cjs`:

```json
{
  "zai": {
    "type": "openai",
    "providerId": "zai",
    "name": "Z.ai (Zhipu AI)",
    "tokens": {
      "default": [
        {
          "type": "api-key",
          "value": "<api_key_from_mongodb>"
        }
      ]
    }
  }
}
```

### LLM Call Example

El agente usa el protocolo OpenAI-compatible:

```javascript
const response = await fetch('https://api.z.ai/api/anthropic/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'glm-4-plus',
    messages: [...],
    stream: true
  })
})
```

## Available Models

| Model | Description | Use Case |
|-------|-------------|----------|
| `glm-5` | Latest flagship | Complex reasoning, coding |
| `glm-4.7` | High performance | General purpose |
| `glm-4.7-flash` | Faster responses | Quick responses |
| `glm-4.5` | Balanced | Cost-effective |
| `glm-4.5v` | Vision capable | Image understanding |
| `glm-4-plus` | Enhanced | Squad Lead recommended |
| `glm-4` | Standard | General tasks |
| `glm-4-flash` | Fast | Simple queries |
| `glm-3-turbo` | Legacy | Basic tasks |

## Model Fetching

Z.ai soporta el endpoint `/models`:

```bash
curl https://api.z.ai/api/anthropic/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

Respuesta:
```json
{
  "object": "list",
  "data": [
    {"id": "glm-4-plus", "object": "model"},
    {"id": "glm-4.7", "object": "model"},
    // ...
  ]
}
```

**Fallback**: Si el endpoint `/models` falla, el sistema usa una lista hardcoded de modelos conocidos.

## Agent Configuration

### Squad Lead (Recomendado: glm-4-plus)

```json
{
  "name": "Squad Lead",
  "role": "squad_lead",
  "provider": "zai",
  "model": "glm-4-plus"
}
```

### Specialist Agents (Recomendado: glm-4)

```json
{
  "name": "Researcher",
  "role": "researcher",
  "provider": "zai",
  "model": "glm-4"
}
```

## Troubleshooting

### Issue: "ECONNREFUSED" when calling Z.ai

**Cause**: El endpoint está incorrecto o el API key es inválido.

**Solution**:
1. Verificar el endpoint en MongoDB:
```bash
docker exec hq-mongodb mongosh "mongodb://root:password@localhost:27017/hq?authSource=admin" \
  --eval 'db.providers.findOne({providerId: "zai"}, {apiEndpoint:1, apiKey:1})'
```

2. Si el endpoint es el antiguo, actualizar:
```bash
docker exec hq-mongodb mongosh "mongodb://root:password@localhost:27017/hq?authSource=admin" \
  --eval 'db.providers.updateOne({providerId: "zai"}, {$set: {apiEndpoint: "https://api.z.ai/api/anthropic"}})'
```

3. Reiniciar el contenedor del agente:
```bash
docker restart <agent-container-id>
```

### Issue: "Model not found: xxx"

**Cause**: Nombre del modelo incorrecto.

**Solution**:
1. Listar modelos disponibles:
```bash
curl http://localhost:3001/api/providers/zai/models?refresh=true
```

2. Usar solo modelos de la lista oficial:
   - ✅ `glm-4-plus`
   - ❌ `glm4-plus` (sin guion)

### Issue: Agent container has old endpoint

**Cause**: El contenedor se creó antes del cambio de endpoint.

**Solution**:
```bash
# 1. Eliminar el contenedor
docker rm -f <agent-container-id>

# 2. La API recreará el contenedor con la configuración actualizada
# cuando se asigne una nueva tarea
```

## Environment Variables

```bash
# Optional: Override default Z.ai endpoint
ZAI_BASE_URL=https://api.z.ai/api/anthropic

# Optional: Override in API service
ZAI_API_ENDPOINT=https://api.z.ai/api/anthropic
```

## Testing

### 1. Test API Key
```bash
curl https://api.z.ai/api/anthropic/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### 2. Test Chat Completion
```bash
curl https://api.z.ai/api/anthropic/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-4-plus",
    "messages": [{"role": "user", "content": "Hola"}]
  }'
```

### 3. Test via HQ API
```bash
# Create a test agent
curl -X POST http://localhost:3001/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Z.ai Agent",
    "role": "developer",
    "provider": "zai",
    "model": "glm-4-plus"
  }'

# Create a test task
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "type": "custom",
    "title": "Test Z.ai",
    "description": "Say hello",
    "assignedTo": "<agent-container-id>"
  }'
```

## Related Files

| File | Purpose |
|------|---------|
| `docker/hq-agent-openclaw/sync-auth-profiles.cjs` | Syncs Z.ai API key from MongoDB |
| `docker/hq-agent-openclaw/hq-polling-skill.cjs` | Makes LLM calls to Z.ai |
| `api/src/services/zai.service.ts` | Backend service for Z.ai |
| `api/src/services/provider-models.service.ts` | Fetches available models |
| `api/src/models/Provider.ts` | MongoDB schema for providers |

## References

- [Z.ai Official Documentation](https://open.bigmodel.cn/dev/api)
- [OpenAI-Compatible API](https://api.z.ai/api/anthropic/v1)
- [GLM Model List](https://open.bigmodel.cn/dev/howuse/model)
