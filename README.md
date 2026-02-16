# HQ - AI Agent Headquarters

Sistema de gestión de squads de agentes de IA para coordinación y ejecución de tareas complejas, basado en **OpenClaw**.

## Características

- **Gestión de Misiones** - Define objetivos y squads de IA
- **Agentes Especializados** - Crea personalidades con roles específicos
- **Tablero de Tareas** - Kanban para seguimiento visual de tareas
- **Integración Telegram** - Coordinación vía chat
- **Auto-deployment** - Cada agente en su propio contenedor Docker basado en OpenClaw
- **Dashboard Integrado** - Panel único de control centralizado
- **Gestión Centralizada de Providers** - API keys sincronizadas desde MongoDB
- **Polling de Tareas** - Agentes que ejecutan tareas automáticamente

## Arquitectura OpenClaw

HQ utiliza **OpenClaw** como base para sus agentes, con sincronización automática de credenciales desde MongoDB:

```
MongoDB (providers collection)
    ↓ sync-auth-profiles.cjs
auth-profiles.json (OpenClaw format)
    ↓ hq-polling-skill.cjs
LLM Provider APIs (Z.ai, MiniMax, Anthropic, etc.)
```

### Componentes OpenClaw

| Componente | Descripción |
|------------|-------------|
| **Dockerfile** | Build desde fuente de OpenClaw + scripts personalizados |
| **entrypoint.sh** | Configura OpenClaw y sincroniza credenciales desde MongoDB |
| **sync-auth-profiles.cjs** | Genera `auth-profiles.json` desde colección `providers` |
| **hq-polling-skill.cjs** | Skill personalizado que hace polling a HQ API y ejecuta tareas |

### Flujo de Autenticación

```
1. Usuario configura Provider en MongoDB (API key incluida)
   ↓
2. Contenedor de agente se inicia
   ↓
3. sync-auth-profiles.cjs lee providers desde MongoDB
   ↓
4. auth-profiles.json se genera con formato OpenClaw
   ↓
5. hq-polling-skill.cjs carga API keys desde auth-profiles.json
   ↓
6. Agente hace llamadas a LLM providers con credenciales correctas
```

## Orquestación Automática con Squad Lead

HQ implementa un sistema de orquestación jerárquico donde un agente **Squad Lead** analiza misiones y coordina equipos de agentes especializados.

### Flujo de Orquestación

```
1. Usuario crea MISIÓN (status: 'draft')
   ↓
2. Usuario llama POST /api/missions/:id/orchestrate
   ↓
3. Sistema selecciona/crea SQUAD LEAD
   ↓
4. Sistema crea TAREA_INICIAL "Analyze Mission"
   ↓
5. SQUAD LEAD ejecuta tarea → responde con JSON plan
   ↓
6. Sistema procesa plan → crea AGENTES y TAREAS
   ↓
7. AGENTES especializados ejecutan tareas (polling)
   ↓
8. Sistema detecta misión completada → marca 'completed'
   ↓
9. SQUAD LEAD se libera (vuelve a idle)
```

### Flujo de Input Humano

Cuando el Squad Lead necesita más información del usuario:

```
1. Squad Lead no tiene suficiente información
   ↓
2. Squad Lead devuelve preguntas (texto) en lugar de JSON plan
   ↓
3. Sistema crea tarea de tipo 'human_input'
   ↓
4. Misión muestra indicador "❓ Esperando tu respuesta"
   ↓
5. Usuario hace clic en "Responder" → modal se abre
   ↓
6. Usuario envía respuesta
   ↓
7. Nueva tarea Squad Lead se crea con la respuesta del humano
   ↓
8. Squad Lead continúa análisis con la información proporcionada
```

### Templates de Agentes

| Template | Rol | Capacidades | LLM |
|----------|-----|-------------|------|
| squad_lead | squad_lead | mission_analysis, task_planning, agent_coordination | glm-4-plus |
| researcher | researcher | web_search, data_analysis, fact_checking | glm-4 |
| developer | developer | code_execution, code_review, debugging | glm-4 |
| writer | writer | content_generation, editing, documentation | glm-4 |
| analyst | analyst | data_analysis, statistics, reporting | glm-4 |

### API de Orquestación

```bash
# Iniciar orquestación automática
curl -X POST http://localhost:3001/api/missions/{missionId}/orchestrate \
  -H "Authorization: Bearer hq-agent-token"

# Ver log de orquestación
curl http://localhost:3001/api/missions/{missionId} \
  -H "Authorization: Bearer hq-agent-token" | jq '.orchestrationLog'
```

### Documentación Completa

Para más detalles sobre el flujo de Squad Lead, ver [doc/SQUAD_LEAD_FLOW.md](./doc/SQUAD_LEAD_FLOW.md)

## Arquitectura

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Vue 3     │     │   Node.js    │     │  MongoDB    │
│  Frontend    │────▶│  API        │────▶│  Database   │
│             │     │            │             │
└─────────────┘     └─────────────┘     └─────────────┘
                            │
                            ▼
                     ┌─────────────┐
                     │   Docker    │
                     │   Engine    │
                     └─────────────┘
                            │
                    ┌───────────┴───────────────┐
                    │   HQ Agent Container    │
                    │  (OpenClaw-based)       │
                    │  - OpenClaw Gateway     │
                    │  - HQ Polling Skill     │
                    │  - auth-profiles.json   │
                    └──────────────────────────┘
                            │
                    LLM Providers (Z.ai, etc.)
```

## Requisitos Previos

- Docker y Docker Compose v2
- Node.js 20+
- MongoDB 8

## Inicio Rápido

### 1. Configurar variables de entorno

```bash
cp env.template .env
```

Edita `.env` y configura al menos:

```bash
# UI Secret para autenticación
UI_SECRET=E9gqo72IikeWG4maTFuZrgbi

# MongoDB
MONGODB_ROOT_USERNAME=root
MONGODB_ROOT_PASSWORD=1nt3r4ct1v3
MONGODB_DATABASE=hq

# Z.ai - Proveedor LLM principal (configurable vía UI)
DEFAULT_LLM_PROVIDER=zai
DEFAULT_LLM_MODEL=glm-4-plus
```

### 2. Levantar servicios

```bash
docker compose up -d --build
```

### 3. Configurar Providers

Accede a http://localhost y navega a **Providers** para configurar tus LLM providers:

1. Selecciona un provider (Z.ai, MiniMax, Anthropic, OpenAI, etc.)
2. Actívalo e ingresa tu API key
3. Los modelos se cargarán automáticamente desde el API del provider

### 4. Crear Agentes

1. Navega a **Agents**
2. Clic en **New Agent**
3. Selecciona el **Provider** y **Modelo** de la lista desplegable
4. Configura nombre, rol y personalidad
5. El agente se despliega automáticamente en un contenedor OpenClaw

### 5. Acceder a la aplicación

- **Dashboard**: http://localhost
- **API Health**: http://localhost:3001/api/health
- **Nginx Health**: http://localhost:8080/nginx-health

## Estructura del Proyecto

```
hq/
├── docker-compose.yml          # Orquestación de servicios
├── .env                       # Variables de entorno
├── nginx/                     # Reverse proxy
├── data/                      # Datos persistentes y código fuente
│   ├── frontend/              # Vue 3 Dashboard (mount de desarrollo)
│   ├── static/                # Archivos estáticos compilados
│   └── mongodb/               # Datos de MongoDB
├── api/                       # Backend API
│   └── src/
│       ├── models/            # Modelos Mongoose
│       ├── routes/            # Rutas Express
│       ├── services/          # Lógica de negocio
│       └── config/            # Configuraciones (agent-templates, etc.)
├── docker/
│   └── hq-agent-openclaw/     # OpenClaw-based agent image
│       ├── Dockerfile         # Build desde fuente OpenClaw
│       ├── entrypoint.sh      # Setup y sincronización de credenciales
│       ├── sync-auth-profiles.cjs  # Sincroniza providers → auth-profiles.json
│       ├── generate-env-from-mongo.cjs  # Genera .env con API keys
│       └── hq-polling-skill.cjs      # Skill de polling a HQ API
├── build/                     # Dockerfiles adicionales
├── doc/                       # Documentación
```

## Desarrollo

### Frontend (Vue 3)

El código fuente está en `data/frontend/` y se monta como volumen en el contenedor.

```bash
# El contenedor ejecuta: npm run dev -- --host
# Los cambios se reflejan en caliente
```

### Backend API

```bash
# Reconstruir imagen
docker compose up -d --build api

# Ver logs
docker compose logs -f api

# Entrar al contenedor
docker compose exec api sh
```

### Base de Datos

```bash
# Entrar a MongoDB shell
docker exec hq-mongodb mongosh -u root -p 1nt3r4ct1v3 --authenticationDatabase admin

# Ver providers configurados
use hq
db.providers.find().pretty()

# Ver agentes
db.agents.find().pretty()

# Ver tareas
db.tasks.find().pretty()
```

### Agente OpenClaw

```bash
# Ver logs del agente (reemplazar con el ID del contenedor)
docker logs <container-id>

# Ver logs en tiempo real
docker logs -f <container-id>

# Entrar al contenedor del agente
docker exec -it <container-id> sh

# Ver auth-profiles.json (credenciales sincronizadas)
docker exec <container-id> cat /home/node/.openclaw/agents/main/agent/auth-profiles.json
```

## Rutas de la API

| Método | Ruta | Descripción |
|---------|-------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/missions` | Listar misiones |
| POST | `/api/missions` | Crear misión |
| POST | `/api/missions/:id/orchestrate` | Iniciar orquestación automática |
| GET | `/api/agents` | Listar agentes |
| POST | `/api/agents` | Crear agente |
| POST | `/api/agents/:id/start` | Iniciar contenedor de agente |
| POST | `/api/agents/:id/stop` | Detener contenedor de agente |
| GET | `/api/tasks` | Listar tareas |
| POST | `/api/tasks` | Crear tarea |
| PUT | `/api/tasks/:id` | Actualizar tarea |
| DELETE | `/api/tasks/:id` | Eliminar tarea |
| GET | `/api/tasks/agent/:agentId/next` | Polling: Obtener siguiente tarea |
| POST | `/api/tasks/:id/start` | Marcar tarea en progreso |
| POST | `/api/tasks/:id/complete` | Completar tarea con resultado |
| POST | `/api/tasks/:id/fail` | Marcar tarea como fallida |
| POST | `/api/tasks/:id/process-squad-output` | Procesar output de Squad Lead |
| POST | `/api/tasks/:id/status` | Actualizar estado de tarea |
| POST | `/api/tasks/:id/human-response` | Enviar respuesta humana |
| GET | `/api/tasks/human/list` | Listar tareas pendientes de input humano |
| GET | `/api/providers` | Listar todos los providers |
| GET | `/api/providers/enabled` | Listar providers activados |
| POST | `/api/providers` | Crear/actualizar provider |
| PUT | `/api/providers/:providerId` | Actualizar provider |
| DELETE | `/api/providers/:providerId` | Eliminar provider |
| POST | `/api/providers/:providerId/toggle` | Activar/desactivar provider (con API key) |
| GET | `/api/providers/:providerId/models` | Listar modelos de un provider |
| POST | `/api/providers/refresh-all` | Refrescar todos los modelos |
| GET | `/api/activity` | Listar actividad |
| GET | `/api/activity/stream` | SSE stream de actividad |
| POST | `/api/telegram/webhook` | Webhook de Telegram |

## Comandos de Telegram

| Comando | Descripción |
|---------|-------------|
| `/newmission` | Crear nueva misión |
| `/status` | Ver estado de misiones activas |
| `/agents` | Listar agentes disponibles |
| `/tasks` | Ver tareas pendientes |

## Proveedores LLM

El proyecto soporta múltiples proveedores de LLM con gestión dinámica desde MongoDB.

### Providers Soportados

| Provider ID | Nombre | Tipo | Endpoint |
|-------------|--------|------|----------|
| `zai` | Z.ai (Zhipu AI) | openai | https://open.bigmodel.cn/api/paas/v4 |
| `minimax` | MiniMax | openai | https://api.minimax.io/v1 |
| `anthropic` | Anthropic (Claude) | anthropic | https://api.anthropic.com |
| `openai` | OpenAI | openai | https://api.openai.com/v1 |
| `google` | Google (Gemini) | openai | https://generativelanguage.googleapis.com/v1beta |
| `ollama` | Ollama (Local) | ollama | http://localhost:11434 |

### Gestión de Providers vía API

```bash
# 1. Listar todos los providers
curl http://localhost:3001/api/providers \
  -H "Authorization: Bearer hq-agent-token"

# 2. Obtener solo providers activados
curl http://localhost:3001/api/providers/enabled \
  -H "Authorization: Bearer hq-agent-token"

# 3. Listar modelos de un provider (usa caché de 1 hora)
curl http://localhost:3001/api/providers/zai/models \
  -H "Authorization: Bearer hq-agent-token"

# 4. Activar provider con API key (autorefresca modelos)
curl -X POST http://localhost:3001/api/providers/zai/toggle \
  -H "Authorization: Bearer hq-agent-token" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "apiKey": "tu_api_key_aqui"}'

# 5. Forzar refresco de modelos
curl "http://localhost:3001/api/providers/zai/models?refresh=true" \
  -H "Authorization: Bearer hq-agent-token"

# 6. Refrescar todos los providers
curl -X POST http://localhost:3001/api/providers/refresh-all \
  -H "Authorization: Bearer hq-agent-token"
```

### Modelos Z.ai Disponibles

| Modelo | Serie | Descripción |
|---------|-------|-------------|
| `glm-5` | GLM-5 (2026) | Más capaz, razonamiento complejo |
| `glm-4.7` | GLM-4.7 | Última serie 4.x |
| `glm-4.5` | GLM-4.5 | Serie 2025 |
| `glm-4.5-air` | GLM-4.5 | Modelo balanceado |
| `glm-4-plus` | GLM-4 | Modelo plus |
| `glm-4` | GLM-4 | Serie base (soportado) |
| `glm-4-flash` | GLM-4 | Flash rápido |

### Modelos MiniMax Disponibles

| Modelo | Descripción | Contexto |
|--------|-------------|----------|
| `MiniMax-M2.5` | Latest flagship, optimizado para coding y tool use | 204K |
| `MiniMax-M2.1` | Multi-language programming model | 204K |
| `MiniMax-Text-01` | Text generation model | 200K |

**Nota**: MiniMax tiene dos APIs diferentes:
- **OpenAI-compatible** (`api.minimax.io/v1/chat/completions`): Usa nombres como `MiniMax-M2.1`
- **Nativa** (`api.minimax.chat/v1/text/chatcompletion_v2`): Usa nombres como `abab6.5s-chat`

HQ usa la API OpenAI-compatible por defecto.

### Crear Agente con Provider y Modelo

```bash
curl -X POST http://localhost:3001/api/agents \
  -H "Authorization: Bearer hq-agent-token" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Investigador",
    "role": "researcher",
    "provider": "zai",
    "llmModel": "glm-4",
    "personality": "Eres un asistente de investigación útil y conciso."
  }'
```

**Nota**: Los agentes obtienen sus API keys automáticamente desde la colección `providers` de MongoDB. No es necesario especificar una API key al crear el agente.

## Seguridad

- Autenticación vía header `X-UI-Secret` (para desarrollo)
- API keys almacenadas en MongoDB (colección `providers`)
- Credenciales sincronizadas a contenedores vía `auth-profiles.json`
- Rate limiting por proveedor (pendiente)
- Webhook validation de Telegram (pendiente)

## Roadmap

- [x] Phase 1: Foundation
- [x] Phase 2: OpenClaw Integration
- [x] Phase 3: Provider Management (MongoDB)
- [x] Phase 4: Squad Lead Orchestration
- [ ] Phase 5: Dashboard UI completo
- [ ] Phase 6: Telegram Integration avanzada
- [ ] Phase 7: Multi-agent collaboration mejorada

## Estado Actual (2026-02-16)

### Funcionalidades Activas
- ✅ OpenClaw-based agents con sincronización de credenciales desde MongoDB
- ✅ Provider management dinámico (enable/disable, API key config)
- ✅ Squad Lead Orchestration para orquestación automática de misiones
- ✅ Agent polling para ejecución automática de tareas
- ✅ Soporte multi-provider: Z.ai, MiniMax, Anthropic, OpenAI, Google, Ollama
- ✅ Human Input Flow - Squad Lead puede solicitar información al usuario
- ✅ Isometric Activity View - Vista visual de agentes en zonas (Work Control, Work Area, Lounge)
- ✅ SSE Activity Stream - Stream de eventos en tiempo real

### Templates de Agentes Disponibles

| Template | Rol | LLM Default | Descripción |
|----------|-----|-------------|-------------|
| squad_lead | squad_lead | glm-4-plus | Analiza misiones, crea plan de tareas y agentes |
| researcher | researcher | glm-4 | Búsqueda web, análisis de datos |
| developer | developer | glm-4 | Ejecución de código, debugging |
| writer | writer | glm-4 | Generación de contenido |
| analyst | analyst | glm-4 | Análisis de datos y estadísticas |

### Agentes Deployados
- **Cabezón** (Squad Lead) - MiniMax M2.1 - Listo para orquestar misiones
- **MiniMax M2.1 Test** (Assistant) - MiniMax M2.1 - Para pruebas

### Próximos Pasos
1. Dashboard UI para crear misiones con orquestación
2. Mejorar gestión de agentes (logs viewer, metrics)
3. Implementar integración Telegram completa
4. Visualización de tareas y dependencias

## Troubleshooting

### hq-agent-openclaw Container Running
If you see a container named `hq-hq-agent-openclaw-1` running with errors:
- This container should NOT be running as a persistent service
- It's a base image for creating dynamic agents
- Stop and remove it:
```bash
docker-compose stop hq-agent-openclaw
docker-compose rm -f hq-agent-openclaw
```

### Agent Polling Error - No API Key Found
If you see `No API key found for provider: zai` in agent logs:
- The provider is not enabled in MongoDB
- Go to Providers page in the UI and enable the provider with your API key
- Or use the API:
```bash
curl -X POST http://localhost:3001/api/providers/zai/toggle \
  -H "Authorization: Bearer hq-agent-token" \
  -d '{"enabled": true, "apiKey": "your_api_key"}'
```

### MiniMax Model Error
Si ves `invalid params, unknown model 'xxx' (2013)`:
- Asegúrate de usar nombres tipo `MiniMax-M2.1` (no `abab6-chat`)
- Refresca los modelos: `POST /api/providers/refresh-all`

### Frontend No Muestra Modelos Actualizados
```bash
# 1. Refrescar modelos en backend
curl -X POST http://localhost:3001/api/providers/refresh-all \
  -H "Authorization: Bearer hq-agent-token"

# 2. Recargar navegador con Ctrl+F5
```

### Agente No Conecta a API (ECONNREFUSED)
```bash
# Reiniciar el contenedor del agente
docker restart <container-id>
```

## Referencias

- [MissionControlHQ.ai](https://missioncontrolhq.ai/) - Inspiración
- [OpenClaw](https://openclaw.ai/) - Motor de agentes base
- [OpenClaw Docs](https://docs.openclaw.ai/) - Documentación oficial
- [Z.ai API](https://docs.z.ai/) - Proveedor LLM (GLM-4)
- [MiniMax API](https://platform.minimax.io/) - Proveedor LLM alternativo
- [molbot](https://github.com/ctangarife/molbot) - Referencia de integración OpenClaw

## Licencia

MIT
