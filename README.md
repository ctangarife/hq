# HQ - AI Agent Headquarters

Sistema de gestión de squads de agentes de IA para coordinación y ejecución de tareas complejas.

## Características

- **Gestión de Misiones** - Define objetivos y squads de IA
- **Agentes Especializados** - Crea personalidades con roles específicos
- **Tablero de Tareas** - Kanban para seguimiento visual de tareas
- **Integración Telegram** - Coordinación vía chat
- **Auto-deployment** - Cada agente en su propio contenedor Docker
- **Dashboard Integrado** - Panel único de control centralizado

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
| Anthropic | claude-3.5-haiku, claude-3.5-sonnet |
| OpenAI | gpt-4, gpt-4-turbo, o1, o3-mini |
| Google | gemini-2.0-flash, gemini-1.5-pro |
| MiniMax | abab6.5s, abab6-chat |
| Moonshot | moonshot-v1-8k |
| Synthenic | claude-3.5-sonnet |
| Ollama | llama3.2, mistral, codexlama |
| OpenCode | open-codex-llm-7b |

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
