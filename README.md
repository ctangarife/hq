# HQ - AI Agent Headquarters

Sistema de gestión de squads de agentes de IA para coordinación y ejecución de tareas complejas.

## Características

- **Gestión de Misiones** - Define objetivos y squads de IA
- **Agentes Especializados** - Crea personalidades con roles específicos
- **Tablero de Tareas** - Kanban para seguimiento visual de tareas
- **Integración Telegram** - Coordinación vía chat
- **Auto-deployment** - Cada agente en su propio contenedor Docker
- **Dashboard Integrado** - Panel único de control centralizado

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
                    ┌───────────┴
                    │  Agent N   │
                    │  Container  │
                    └───────────┘
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
MONGODB_ROOT_USERNAME=mongoadmin
MONGODB_ROOT_PASSWORD=secret
MONGODB_DATABASE=hq_db

# Z.ai - Proveedor LLM principal
ZAI_API_KEY=tu_api_key_aqui
```

### 2. Levantar servicios

```bash
docker compose up -d --build
```

### 3. Acceder a la aplicación

- **Dashboard**: http://localhost
- **API Health**: http://localhost:3001/api/health
- **Nginx Health**: http://localhost:8080/nginx-health

## Estructura del Proyecto

```
hq/
├── docker-compose.yml          # Orquestación de servicios
├── env.template               # Template de variables
├── nginx/                    # Reverse proxy
├── data/                     # Datos persistentes y código fuente
│   ├── frontend/             # Vue 3 Dashboard (mount de desarrollo)
│   ├── static/               # Archivos estáticos compilados
│   └── mongodb/             # Datos de MongoDB
├── api/                      # Backend API
│   ├── src/
│   │   ├── models/          # Modelos Mongoose
│   │   ├── routes/          # Rutas Express
│   │   ├── services/         # Lógica de negocio
│   │   └── middleware/      # Middleware
├── build/                    # Dockerfiles
│   ├── frontend/
│   └── agent-base/
├── doc/                     # Documentación
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
docker exec hq-mongodb mongosh -u root -p secret -eval "
db.missions.find()
db.agents.find()
db.tasks.find()
"
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
| POST | `/api/agents/:id/deploy` | Desplegar contenedor de agente |
| GET | `/api/tasks` | Listar tareas |
| POST | `/api/tasks` | Crear tarea |
| PUT | `/api/tasks/:id` | Actualizar tarea |
| DELETE | `/api/tasks/:id` | Eliminar tarea |
| GET | `/api/tasks/agent/:agentId/next` | Polling: Obtener siguiente tarea |
| POST | `/api/tasks/:id/start` | Marcar tarea en progreso |
| POST | `/api/tasks/:id/complete` | Completar tarea con resultado |
| POST | `/api/tasks/:id/fail` | Marcar tarea como fallida |
| GET | `/api/providers` | Listar todos los providers |
| GET | `/api/providers/enabled` | Listar providers activados |
| POST | `/api/providers` | Crear/actualizar provider |
| PUT | `/api/providers/:providerId` | Actualizar provider |
| DELETE | `/api/providers/:providerId` | Eliminar provider |
| POST | `/api/providers/:providerId/toggle` | Activar/desactivar provider |
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

El proyecto soporta múltiples proveedores de LLM.

### Z.ai (GLM - Chinese LLM)

```bash
# API Key
ZAI_API_KEY=tu_api_key_aqui

# Endpoint
ZAI_API_ENDPOINT=https://open.bigmodel.cn/api/paas/v4/
```

| Modelo | Serie | Descripción |
|---------|-------|-------------|
| `glm-5` | GLM-5 (2026) | Más capaz, razonamiento complejo |
| `glm-4.7` | GLM-4.7 | Última serie 4.x |
| `glm-4.7-flash` | GLM-4.7 | Modelo flash rápido |
| `glm-4.5` | GLM-4.5 | Serie 2025 |
| `glm-4.5v` | GLM-4.5 | Modelo con visión |
| `glm-4.5-air` | GLM-4.5 | Modelo balanceado |
| `glm-image` | - | Generación de imágenes |
| `cogview-4` | - | CogView |
| `cogview-3-plus` | - | CogView 3+ |
| `glm-4` | GLM-4 | Serie antia (soportado) |
| `glm-4-plus` | GLM-4 | Modelo plus |
| `glm-4-air` | GLM-4 | Aire (chat) |
| `glm-4-flash` | GLM-4 | Flash rápido |
| `glm-3-turbo` | - | Compatible con antiguos |

### Otros Proveedores

| Proveedor | Modelos |
|-----------|---------|
| Anthropic | claude-3.5-haiku, claude-3.5-sonnet, claude-3-opus |
| OpenAI | gpt-4o, gpt-4o-mini, gpt-4-turbo, o3-mini |
| Google | gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash |
| Ollama | llama3.2, mistral, codellama |

### Gestión de Providers y Modelos

Los providers se gestionan dinámicamente desde MongoDB. Los modelos se obtienen en tiempo real desde cada provider API y se cachean por 1 hora.

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

# 4. Forzar refresco de modelos desde el API del provider
curl "http://localhost:3001/api/providers/zai/models?refresh=true" \
  -H "Authorization: Bearer hq-agent-token"

# 5. Activar/desactivar un provider
curl -X POST http://localhost:3001/api/providers/openai/toggle \
  -H "Authorization: Bearer hq-agent-token" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'

# 6. Refrescar todos los providers
curl -X POST http://localhost:3001/api/providers/refresh-all \
  -H "Authorization: Bearer hq-agent-token"
```

### Crear Agente con Provider y Modelo

```bash
curl -X POST http://localhost:3001/api/agents \
  -H "Authorization: Bearer hq-agent-token" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mi Agente",
    "role": "researcher",
    "provider": "zai",
    "llmModel": "glm-4-flash",
    "personality": "Eres un asistente de investigación útil."
  }'
```

### Providers Configurados por Defecto

| Provider ID | Nombre | Tipo | Estado | Endpoint |
|-------------|--------|------|--------|----------|
| `zai` | Z.ai (Zhipu AI) | openai | ✅ Activo | https://open.bigmodel.cn/api/paas/v4 |
| `minimax` | MiniMax | openai | ❌ Inactivo | https://api.minimax.io/v1 |
| `anthropic` | Anthropic (Claude) | anthropic | ❌ Inactivo | https://api.anthropic.com |
| `openai` | OpenAI | openai | ❌ Inactivo | https://api.openai.com/v1 |
| `google` | Google (Gemini) | openai | ❌ Inactivo | https://generativelanguage.googleapis.com/v1beta |
| `ollama` | Ollama (Local) | ollama | ❌ Inactivo | http://localhost:11434 |

**Nota:** Para usar otros providers, actívalos desde MongoDB o la API y configura sus API keys.

### Modelos MiniMax Disponibles

| Modelo | Descripción | Contexto |
|--------|-------------|----------|
| `mini-max-m2.5` | Latest flagship, optimizado para coding (Feb 2026) | 128K |
| `mini-max-m2.1` | Multi-language coding, app/web dev | 128K |
| `mini-max-m2-her` | 10B activated parameters | 128K |
| `mini-max-m1-80k` | 456B MoE, 80K thinking, 1M context | 1M |
| `mini-max-m1-40k` | Smaller context variant | 128K |
| `mini-max-hailuo-2.3` | Hailuo model | 32K |
| `abab6.5s-chat` | Legacy chat model | 32K |
| `abab6-chat` | Legacy chat model | 32K |

## Seguridad

- Autenticación vía header `X-UI-Secret` (para desarrollo)
- Tokens cifrados en MongoDB (AES-256-GCM)
- Rate limiting por proveedor (pendiente)
- Webhook validation de Telegram (pendiente)

## Roadmap

- [x] Phase 1: Foundation
- [ ] Phase 2: Core Services
- [ ] Phase 3: Dashboard UI completo
- [ ] Phase 4: Container Management
- [ ] Phase 5: Telegram Integration
- [ ] Phase 6: Task Orchestration

## Referencias

- [MissionControlHQ.ai](https://missioncontrolhq.ai/) - Inspiración
- [OpenClaw](https://openclaw.ai/) - Motor de agentes
- [Z.ai API](https://docs.z.ai/) - Proveedor LLM (GLM-4)
- [abhi1693/openclaw-mission-control](https://github.com/abhi1693/openclaw-mission-control) - Referencia de arquitectura
- [ctangarife/openclaw-docker](https://github.com/ctangarife/openclaw-docker) - Referencia de infraestructura

## Licencia

MIT
