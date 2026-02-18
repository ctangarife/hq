# HQ - AI Agent Headquarters

Sistema de gestión de squads de agentes de IA para coordinación y ejecución de tareas complejas, basado en **OpenClaw**.

<img width="1866" height="510" alt="image" src="https://github.com/user-attachments/assets/10538e10-c6c2-4c08-906e-95703aab6a21" />


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

### Sistema de Reintentos y Auditor Agent

HQ implementa un sistema robusto de manejo de fallos con reintentos automáticos y un agente auditor inteligente.

#### Flujo de Reintentos Automáticos

```
1. Tarea falla por primera vez
   ↓
2. Sistema registra reintento (retryCount: 1/3)
   ↓
3. Tarea vuelve a estado 'pending'
   ↓
4. Agente la reintenta automáticamente
   ↓
5. Si falla nuevamente → retryCount: 2/3
   ↓
6. Si falla por tercera vez → retryCount: 3/3 (máximo alcanzado)
   ↓
7. Sistema crea tarea de auditoría automáticamente
   ↓
8. Agente Auditor analiza y decide acción:
   - 🔄 RETRY - Error temporal, dar intento extra
   - ✏️ REFINE - Descripción confusa, mejorarla
   - 👤 REASSIGN - Agente incorrecto, reasignar
   - 👥 ESCALATE_HUMAN - Faltan datos, pedir a usuario
   ↓
9. Decisión se aplica y tarea continúa
```

#### Templates de Agentes

| Template | Rol | Capacidades | LLM |
|----------|-----|-------------|------|
| squad_lead | squad_lead | mission_analysis, task_planning, agent_coordination | glm-4-plus |
| researcher | researcher | web_search, data_analysis, fact_checking | glm-4 |
| developer | developer | code_execution, code_review, debugging | glm-4 |
| writer | writer | content_generation, editing, documentation | glm-4 |
| analyst | analyst | data_analysis, statistics, reporting | glm-4 |
| **auditor** | **auditor** | **error_analysis, task_refinement, agent_reassignment, human_escalation** | **glm-4-plus** |

#### Indicadores Visuales en Frontend

| Indicador | Significado | Acción |
|-----------|-------------|--------|
| 🔁 1/3 (amarillo) | Un reintento fallido | Clic para ver historial |
| 🔁 2/3 (amarillo) | Dos reintentos fallidos | Clic para ver historial |
| 🔁 3/3 (rojo) | Máximo de reintentos alcanzado | Clic para ver historial + acciones |
| 🔍 Auditoría pendiente (parpadeando) | Requiere intervención | Clic para decidir manualmente |
| 🎭 En auditoría | Auditor está revisando | Clic para ver estado |

#### Decisión Manual de Auditoría

Si una tarea alcanza el máximo de reintentos, el usuario puede intervenir como "super auditor":

1. Hacer clic en el badge `🔍 Auditoría pendiente`
2. Se abre el modal de historial con los 3 intentos fallidos
3. Hacer clic en `⚖️ Decidir Manualmente`
4. Seleccionar acción:
   - **🔄 REINTENTAR** - Error temporal de red, timeout, rate limit
   - **✏️ REFINAR** - Tarea mal definida, descripción confusa
   - **👤 REASIGNAR** - Agente no tiene habilidades necesarias
   - **👥 ESCALAR A HUMANO** - Faltan datos, archivos o contexto
5. Proporcionar razón de la decisión
6. Sistema aplica la decisión automáticamente

#### Endpoints de Auditoría

```bash
# Reintentar tarea manualmente
curl -X POST http://localhost:3001/api/tasks/{taskId}/retry \
  -H "Authorization: Bearer hq-agent-token" \
  -H "Content-Type: application/json"

# Procesar decisión de auditor (manual)
curl -X POST http://localhost:3001/api/tasks/{taskId}/auditor-decision \
  -H "Authorization: Bearer hq-agent-token" \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "retry|refine|reassign|escalate_human",
    "reason": "Explicación de la decisión",
    "suggestedAgentRole": "developer",  // solo para reassign
    "refinedDescription": "Nueva descripción",  // solo para refine
    "questionForHuman": "Qué necesitas?"  // solo para escalate_human
  }'
```

### Documentación Completa

Para más detalles, ver:
- [doc/SQUAD_LEAD_FLOW.md](./doc/SQUAD_LEAD_FLOW.md) - Flujo completo de Squad Lead
- [doc/RETRY_AUDIT_TESTS.md](./doc/RETRY_AUDIT_TESTS.md) - Tests del sistema de reintentos

### Templates de Agentes

| Template | Rol | Capacidades | LLM |
|----------|-----|-------------|------|
| squad_lead | squad_lead | mission_analysis, task_planning, agent_coordination | glm-4-plus |
| researcher | researcher | web_search, data_analysis, fact_checking | glm-4 |
| developer | developer | code_execution, code_review, debugging | glm-4 |
| writer | writer | content_generation, editing, documentation | glm-4 |
| analyst | analyst | data_analysis, statistics, reporting | glm-4 |
| auditor | auditor | error_analysis, task_refinement, agent_reassignment | glm-4-plus |

<img width="1856" height="887" alt="image" src="https://github.com/user-attachments/assets/3fcffe1b-82d5-4bd1-8e13-edba28a6004e" />


### Tipos de Misiones

HQ ahora soporta tres tipos de misiones para diferentes flujos de trabajo:

| Tipo | Descripción | Cuándo Usar |
|------|-------------|-------------|
| 🤖 **Auto Orquestada** | Squad Lead analiza, planifica y ejecuta automáticamente | La mayoría de las misiones complejas |
| 📋 **Basada en Plantilla** | Usa plantillas predefinidas para misiones comunes | Misiones repetitivas (próximamente) |
| ✋ **Manual** | Creas las tareas y asignaciones manualmente | Casos muy específicos |

#### Flujo de Misión Auto Orquestada (Mejorado)

```
1. Crear misión → Seleccionar "Auto Orquestada"
2. Marcar "Iniciar orquestación automática"
3. Squad Lead analiza la misión
4. 🎯 Vista previa del plan:
   - Ver agentes que se crearán
   - Ver tareas planificadas
   - Ver dependencias
5. Decidir:
   - ✅ Confirmar y ejecutar
   - ✏️ Editar plan (próximamente)
   - ❌ Rechazar (quedará en borrador)
6. Ejecución automática
```

### 📋 Campos de Contexto de Misión (Mejoras en Planificación)

Además de los campos básicos, HQ ahora soporta **campos opcionales de contexto** que ayudan al Squad Lead a generar mejores planes:

| Campo | Descripción | Ejemplo |
|-------|-------------|---------|
| **Contexto** | Background sobre la empresa/proyecto | "Startup B2B SaaS en etapa de crecimiento" |
| **Audiencia** | Quién consumirá el resultado | "Gerentes de marketing no técnicos" |
| **Formato de Entrega** | Cómo se espera recibir el resultado | "Reporte PDF con gráficos" |
| **Criterios de Éxito** | Qué define que la misión está completa | "Mínimo 5 estrategias accionables con KPIs" |
| **Restricciones** | Límites de tiempo, presupuesto, técnicos | "Sin inversión en ads, máximo 3 páginas" |
| **Tono** | Estilo de comunicación preferido | "Profesional pero accesible" |

**¿Por qué usar estos campos?**
- ✅ **Menos reintentos** - El Squad Lead pide menos información en el flujo de human input
- ✅ **Planes más precisos** - Las tareas están mejor definidas desde el inicio
- ✅ **Resultados mejor alineados** - El output coincide con tus expectativas

### 📡 Streaming de Outputs en Tiempo Real

**¿Qué es?**: Puedes ver el output de las tareas mientras el agente está generándolas, sin esperar a que termine.

**Cómo funciona**:
1. Durante la ejecución de una tarea, el agente envía "chunks" del output
2. El frontend los muestra en tiempo real con un indicador "🔴 Live"
3. Cuando la tarea completa, ves el resultado final

**Cómo usarlo**:
```
1. En la vista de Tareas, busca una tarea en estado "in_progress"
2. Haz clic en el botón "📡 Ver Output Live"
3. Se abre un modal mostrando el output en tiempo real
4. El cursor parpadeante indica que está recibiendo datos
```

**Endpoints**:
```bash
# Stream task output (SSE)
curl http://localhost:3001/api/tasks/{taskId}/stream \
  -H "Authorization: Bearer hq-agent-token"

# Update partial output (llamado por el agente)
# POST /api/tasks/:id/partial-output
```

**Características**:
- 🔴 Indicador "Live" cuando está conectado
- ✅ Cursor parpadeante mostrando actividad
- 📜 Auto-scroll al contenido más reciente
- 🎯 Funciona para tareas en progreso y completadas

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
UI_SECRET=<genera_un_secreto_unico_32_caracteres>

# MongoDB
MONGODB_ROOT_USERNAME=root
MONGODB_ROOT_PASSWORD=<tu_password_seguro>
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

<img width="1867" height="678" alt="image" src="https://github.com/user-attachments/assets/d5eac41e-7357-49f1-8a6c-0093f930aec5" />


### 4. Crear Agentes

1. Navega a **Agents**
2. Clic en **New Agent**
3. Selecciona el **Provider** y **Modelo** de la lista desplegable
4. Configura nombre, rol y personalidad
5. El agente se despliega automáticamente en un contenedor OpenClaw

## Guía Paso a Paso: Squad Lead y Orquestación de Misiones

Esta guía te muestra cómo crear un agente Squad Lead, definir una misión y dejar que el sistema orqueste automáticamente los agentes y tareas necesarios.

### Paso 1: Crear un Agente Squad Lead

El Squad Lead es un agente especial que analiza misiones y coordina equipos de agentes especializados.

1. **Navega a la página Agents**
   - Haz clic en "Agents" en el menú lateral

2. **Crea un nuevo agente**
   - Haz clic en el botón "New Agent"
   - Configura los siguientes campos:

   | Campo | Valor recomendado |
   |-------|-------------------|
   | **Name** | Cabezón (o el nombre que prefieras) |
   | **Role** | Squad Lead |
   | **Provider** | zai (o minimax, anthropic, etc.) |
   | **Model** | glm-4-plus (o el mejor modelo disponible) |
   | **Personality** | "Eres un líder de equipo experimentado que analiza misiones, identifica tareas necesarias y coordina agentes especializados." |

3. **Guarda el agente**
   - Haz clic en "Create"
   - El contenedor del agente se creará automáticamente
   - Espera a que el estado cambie a "Active"

### Paso 2: Crear una Misión

1. **Navega a la página Misions**
   - Haz clic en "Missions" en el menú lateral

2. **Crea una nueva misión**
   - Haz clic en el botón "New Mission"
   - Completa los campos:

   | Campo | Descripción | Ejemplo |
   |-------|-------------|---------|
   | **Title** | Título corto de la misión | "Asistente de traducción técnica" |
   | **Description** | Descripción detallada del objetivo | "Crear un asistente de IA especializado en traducción técnica de documentación de software, con soporte para español, inglés y portugués. El asistente debe mantener terminología consistente y detectar errores comunes." |
   | **Squad Lead** | Selecciona tu Squad Lead | Cabezón |

3. **Guarda la misión**
   - Haz clic en "Create"
   - La misión se creará con estado "draft"

<img width="1867" height="510" alt="image" src="https://github.com/user-attachments/assets/c51aecaa-0110-4f66-9900-59e25d8984c4" />


### Paso 3: Orquestar la Misión

La orquestación es el proceso donde el Squad Lead analiza la misión y crea automáticamente los agentes y tareas necesarios.

1. **Inicia la orquestación**
   - En la tarjeta de la misión, haz clic en el botón "Orchestrate"
   - El sistema creará una tarea inicial de tipo "mission_analysis" para el Squad Lead

2. **Espera el análisis del Squad Lead**
   - El Squad Lead analizará la misión y responderá de dos formas:
     - **Con preguntas**: Si la descripción es muy genérica, creará una tarea `human_input` para pedirte más información
     - **Con un plan JSON**: Si la descripción es clara, creará agentes y tareas automáticamente

### Paso 4: Responder Input Humano (si aplica)

Si el Squad Lead necesita más información:

1. **Verás un indicador en la misión**
   - "❓ Esperando tu respuesta"

2. **Haz clic en "Responder"**
   - Se abrirá un modal con las preguntas del Squad Lead

3. **Escribe tu respuesta**
   - Responde a las preguntas con la mayor claridad posible
   - Haz clic en "Enviar Respuesta"

4. **El Squad Lead continuará el análisis**
   - Con tu información, creará el plan de agentes y tareas

### Paso 5: Ver Tareas Creadas

Una vez completado el análisis, el Squad Lead habrá creado:

1. **Agentes especializados**
   - Researcher: Para investigación y recopilación de información
   - Developer: Para implementación técnica
   - Writer: Para generación de contenido
   - Analyst: Para análisis y validación

2. **Tareas organizadas**
   - Navega a la página "Tasks" para ver el tablero Kanban
   - Las tareas estarán distribuidas por estado:
     - **Pending**: Tareas pendientes de asignación
     - **In Progress**: Tareas que los agentes están ejecutando
     - **Completed**: Tareas finalizadas
     - **Failed**: Tareas que fallaron

3. **Cada tarjeta de tarea muestra**
   - Título y descripción
   - Tipo de tarea (web_search, code_execution, content_generation, etc.)
   - Agente asignado
   - Estado actual
   - Botones para acciones (Start, Complete, Fail)

<img width="1859" height="756" alt="image" src="https://github.com/user-attachments/assets/e9c87894-2e42-49cf-be5d-177ea8a64d14" />


### Paso 6: Monitorear la Actividad

1. **Vista de Actividad Isométrica**
   - Navega a "Activity" en el menú
   - Verás un mapa visual con tres zonas:
     - 🎯 **Work Control**: Agentes con tareas pendientes
     - ⚡ **Work Area**: Agentes ejecutando tareas
     - ☕ **Lounge**: Agentes inactivos/disponibles

2. **Stream de Eventos en Tiempo Real**
   - La vista Activity muestra eventos en tiempo real:
     - Agentes asignados a tareas
     - Tareas completadas
     - Agentes moviéndose entre zonas
     - Nuevos agentes creados

<img width="1509" height="854" alt="image" src="https://github.com/user-attachments/assets/96dedcad-b6a5-422f-ad39-e01c7a0390f3" />


### Paso 7: Ver Resultados

1. **Cuando la misión se completa**
   - El estado de la misión cambiará a "completed"
   - El Squad Lead volverá al estado "idle" (disponible)
   - Los agentes especializados creados quedarán disponibles para futuras misiones

2. **Revisar el log de orquestación**
   - En la página de la misión, expande "Orchestration Log"
   - Verás el historial completo:
     - Cuándo se creó cada agente
     - Qué tareas se generaron
     - El progreso de cada tarea

### Ejemplo Completo: Misión de "Traducción Técnica"

```
1. Creo "Cabezón" como Squad Lead (con modelo glm-4-plus)
2. Creo misión "Asistente de traducción técnica"
3. Hago clic en "Orchestrate"
4. Cabezón analiza y crea:
   - Agente "Researcher" → tarea "investigar_glosarios_tecnicos"
   - Agente "Writer" → tarea "crear_guia_estilo"
   - Agente "Developer" → tarea "implementar_validador"
5. Los agentes ejecutan sus tareas (polling automático)
6. Las tareas se completan y aparecen en "Completed"
7. La misión cambia a estado "completed"
```

### Crear Tareas Manualmente

También puedes crear tareas manualmente sin usar el Squad Lead:

1. **Navega a Tasks**
2. **Haz clic en "New Task"**
3. **Completa los campos**:
   - **Title**: Título de la tarea
   - **Description**: Instrucciones detalladas
   - **Type**: Tipo de tarea (custom, web_search, code_execution, etc.)
   - **Mission**: Misión a la que pertenece (opcional)
   - **Assigned To**: Agente específico (o dejar vacío para que cualquier agente la tome)

4. **La tarea aparecerá en la columna "Pending"**
5. **Un agente la tomará automáticamente** (via polling)

### Asignar Tarea a un Agente Específico

1. **Edita la tarea**
   - Haz clic en el botón de editar en la tarjeta de tarea
2. **Selecciona el agente**
   - En "Assigned To", selecciona el agente de la lista
3. **Guarda los cambios**
4. **El agente asignado ejecutará la tarea** en su próximo ciclo de polling

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
docker exec hq-mongodb mongosh -u root -p <tu_password_seguro> --authenticationDatabase admin

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
| `zai` | Z.ai (Zhipu AI) | openai | https://api.z.ai/api/anthropic |
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
- [x] Phase 5: Dashboard UI
- [x] Phase 6: Archivos y Entregables
- [x] Phase 7: Sistema de Reintentos y Auditor Agent
- [x] Phase 8.1: Streaming de Outputs
- [x] Phase 8.2: Consolidación de Outputs (PDF)
- [x] Phase 9: Optimización de Asignación de Agentes
- [ ] Phase 10: Mejoras de UX
- [ ] Phase 11: Telegram Integration

Ver roadmap completo en [doc/ROADMAP.md](./doc/ROADMAP.md)

## Estado Actual (2026-02-18)

### Funcionalidades Activas
- ✅ OpenClaw-based agents con sincronización de credenciales desde MongoDB
- ✅ Provider management dinámico (enable/disable, API key config)
- ✅ Squad Lead Orchestration para orquestación automática de misiones
- ✅ Agent polling para ejecución automática de tareas
- ✅ Soporte multi-provider: Z.ai, MiniMax, Anthropic, OpenAI, Google, Ollama
- ✅ Human Input Flow - Squad Lead puede solicitar información al usuario
- ✅ Isometric Activity View - Vista visual de agentes en zonas (Work Control, Work Area, Lounge)
- ✅ SSE Activity Stream - Stream de eventos en tiempo real
- ✅ **Task Output Streaming** - Ver outputs de tareas en tiempo real mientras se generan
- ✅ **PDF Consolidation** - Generar entregables PDF consolidados desde outputs de tareas
- ✅ **Agent Scoring System** - Asignación inteligente de agentes basada en rol, disponibilidad, historial de éxito y carga de trabajo
- ✅ **Agent Metrics** - Métricas de rendimiento almacenadas y actualizadas automáticamente
- ✅ **File Management** - Subida y adjuntación de archivos a misiones
- ✅ **Retry & Auditor System** - Reintentos automáticos y agente auditor inteligente

### Templates de Agentes Disponibles

| Template | Rol | LLM Default | Descripción |
|----------|-----|-------------|-------------|
| squad_lead | squad_lead | glm-4-plus | Analiza misiones, crea plan de tareas y agentes |
| researcher | researcher | glm-4 | Búsqueda web, análisis de datos |
| developer | developer | glm-4 | Ejecución de código, debugging |
| writer | writer | glm-4 | Generación de contenido |
| analyst | analyst | glm-4 | Análisis de datos y estadísticas |
| **auditor** | **auditor** | **glm-4-plus** | **Analiza fallos y decide recuperación (reassign/refine/retry/escalate)** |

### Agentes Deployados
- **Cabezón** (Squad Lead) - Z.ai glm-4-plus - Listo para orquestar misiones

### Próximos Pasos (Phase 10)
1. **Plantillas de Misiones** - Misiones predefinidas para casos comunes (Análisis de Datos, Reportes PDF, Desarrollo, Investigación)
2. **Telegram Integration** - Control del sistema HQ vía chat
3. **Features Avanzadas** - Dependencias entre tareas, Multi-mission orquestation

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
