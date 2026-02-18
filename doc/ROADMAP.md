# HQ - Roadmap de Desarrollo

Este documento describe las características planificadas y mejoras futuras del sistema HQ.

## Estado Actual (2026-02-17)

### ✅ Completado

- **OpenClaw Integration** - Agentes con sincronización de credenciales desde MongoDB
- **Provider Management** - Configuración dinámica de providers (Z.ai, MiniMax, Anthropic, OpenAI, Google, Ollama)
- **Squad Lead Orchestration** - Orquestación automática de misiones
- **Human Input Flow** - Solicitudes de información del Squad Lead al usuario
- **Activity View** - Visualización isométrica de agentes en zonas
- **Mission Creation UI** - Formulario básico de misiones
- **Task Management** - Kanban de tareas con filtros por misión
- **Agent Metrics Dashboard** - Métricas básicas de agentes
- **Phase 6** ✅ - Archivos y Entregables COMPLETO
  - 6.1: Estructura de archivos y volumen Docker
  - 6.2: Modelos Resource y Attachment
  - 6.3: Frontend FileUploader component

---

## Roadmap - Próximas Fases

### 🔥 Phase 6: Archivos y Entregables (PRIORIDAD ALTA)

**Objetivo**: Permitir que las misiones generen entregables tangibles (PDF, código, datos) con soporte para uploads de archivos.

#### 6.1 Estructura de Archivos y Volumen Docker ✅
- [x] Crear volumen Docker `/data/hq-files` para persistencia de archivos
- [x] Implementar estructura de carpetas:
  ```
  /data/hq-files/
  ├── missions/
  │   ├── {mission_id}/
  │   │   ├── metadata.json
  │   │   ├── inputs/           # Archivos subidos por usuario
  │   │   ├── tasks/
  │   │   │   └── {task_id}/
  │   │   │       ├── input.json
  │   │   │       ├── output.json
  │   │   │       ├── artifacts/
  │   │   │       └── logs/
  │   │   └── outputs/          # Entregables finales
  ```
- [x] Crear servicio `file-management.service.ts`
- [x] Montar volumen en contenedores de agentes (read-only inputs, write tasks)

**Archivos**: `api/src/services/file-management.service.ts`, `docker-compose.yml` ✅ Done

#### 6.2 Modelo Resource/Attachment ✅
- [x] Crear modelo `Resource.ts` para archivos adjuntos
- [x] Crear modelo `Attachment.ts` para vincular recursos a misiones/tareas
- [x] Endpoint: `POST /api/attachments/upload` - Subir archivo
- [x] Endpoint: `GET /api/attachments/mission/:id` - Listar adjuntos
- [x] Endpoint: `GET /api/attachments/:id/download` - Descargar archivo
- [x] Endpoint: `DELETE /api/attachments/:id` - Eliminar archivo
- [x] Soporte para: PDF, Markdown, Code (.ts, .js, .py), Excel (.xlsx), CSV, JSON

**Archivos**: `api/src/models/Resource.ts`, `api/src/models/Attachment.ts`, `api/src/routes/resources.ts`, `api/src/routes/attachments.ts` ✅ Done

#### 6.3 Frontend - Upload de Archivos ✅
- [x] Componente `FileUploader.vue` para drag & drop
- [x] Vista previa de archivos (PDF, imágenes, code snippets)
- [x] Indicador de progreso de subida
- [x] Lista de adjuntos en la vista de misión
- [x] Botón "📎 Archivos" en tarjetas de misión

**Archivos**: `data/frontend/src/components/FileUploader.vue`, `data/frontend/src/views/MissionsView.vue`, `data/frontend/src/services/api.ts` ✅ Done

---

### 🔥 Phase 7: Sistema de Reintentos y Auditor Agent (PRIORIDAD ALTA)

**Objetivo**: Manejo robusto de fallos con reintentos automáticos y un agente auditor inteligente.

#### 7.1 Modelo de Reintentos
- [ ] Agregar campos a `Task.ts`:
  - `retryCount: number` - Número de intentos actuales
  - `maxRetries: number` - Máximo de reintentos (default: 3)
  - `retryHistory: Array<{attempt: number, error: string, timestamp: Date}>`
- [ ] Modificar polling del agente para implementar lógica de reintentos
- [ ] Endpoint: `POST /api/tasks/:id/retry` - Reintentar tarea manualmente

**Archivos**: `api/src/models/Task.ts`, `docker/hq-agent-openclaw/hq-polling-skill.cjs`

#### 7.2 Agente Auditor
- [ ] Crear template `auditor` en `agent-templates.ts`
- [ ] Capabilities: `error_analysis`, `task_refinement`, `agent_reassignment`, `human_escalation`
- [ ] System prompt optimizado para análisis de fallos
- [ ] Lógica de decisión:
  - AGENTE_INADECUADO → Reasignar a diferente agente
  - TAREA_MAL_DEFINIDA → Refinar descripción
  - INPUT_FALTANTE → Crear tarea human_input
  - DEPENDENCIA_ROTA → Recrear tarea previa
  - ERROR_TECNICO → Reintentar (hasta 3)

**Archivos**: `api/src/config/agent-templates.ts`

#### 7.3 Flujo de Auditoría
- [ ] Modificar `hq-polling-skill.cjs` para crear tarea de auditoría después de 3 fallos
- [ ] Crear tarea tipo `auditor_review` automáticamente
- [ ] Endpoint: `POST /api/tasks/:id/auditor-decision` - Recibir decisión del auditor
- [ ] Implementar acciones: reassign, refine, escalate_human

**Archivos**: `docker/hq-agent-openclaw/hq-polling-skill.cjs`, `api/src/routes/tasks.ts`

---

### ⚡ Phase 8: Outputs en Tiempo Real (PRIORIDAD MEDIA)

**Objetivo**: Permitir al usuario ver outputs parciales mientras los agentes trabajan.

#### 8.1 Streaming de Outputs
- [ ] Endpoint SSE: `GET /api/tasks/:id/stream` - Output en tiempo real
- [ ] Agregar campo `partialOutput` a `Task.ts`
- [ ] Modificar `hq-polling-skill.cjs` para enviar chunks durante ejecución
- [ ] Frontend: Componente `TaskOutputStream.vue` con actualización en vivo

**Archivos**: `api/src/routes/tasks.ts`, `api/src/models/Task.ts`, `docker/hq-agent-openclaw/hq-polling-skill.cjs`, `data/frontend/src/components/TaskOutputStream.vue`

#### 8.2 Consolidación de Outputs
- [ ] Servicio para consolidar outputs de múltiples tareas
- [ ] Generación de PDF desde Markdown (usando `pdf-kit` o `markdown-pdf`)
- [ ] Endpoint: `POST /api/missions/:id/consolidate` - Generar entregable final
- [ ] Archivo final en `/missions/{id}/outputs/final.pdf`

**Archivos**: `api/src/services/file-management.service.ts`, `api/src/routes/missions.ts`

---

### 🎯 Phase 9: Optimización de Asignación de Agentes (PRIORIDAD MEDIA)

**Objetivo**: Sistema inteligente de puntuación para asignar el mejor agente a cada tarea.

#### 9.1 Sistema de Scoring
- [ ] Servicio `agent-scoring.service.ts` con lógica de puntuación:
  - Match de rol/capacidades (+40)
  - Disponibilidad (+30)
  - Historial de éxito (+20)
  - Carga de trabajo actual (-10 por tarea pendiente)
- [ ] Modificar `orchestration.service.ts` para usar scoring
- [ ] Guardar historial de tareas completadas por agente

**Archivos**: `api/src/services/agent-scoring.service.ts`, `api/src/models/Agent.ts`

#### 9.2 Métricas de Agentes
- [ ] Agregar campos a `Agent.ts`:
  - `tasksCompleted: number`
  - `tasksFailed: number`
  - `successRate: number`
  - `totalDuration: number` - ms acumuladas
  - `averageDuration: number` - ms promedio
- [ ] Endpoint: `GET /api/agents/:id/metrics` - Métricas detalladas
- [ ] Gráficos de rendimiento en la vista de agentes

**Archivos**: `api/src/models/Agent.ts`, `api/src/routes/agents.ts`, `data/frontend/src/views/AgentsView.vue`

---

### 🔧 Phase 10: Mejoras de UX y Flujo de Misiones (PRIORIDAD MEDIA)

**Objetivo**: Hacer más intuitiva la creación y gestión de misiones.

#### 10.1 Creación Optimizada de Misiones
- [ ] Selector de tipo de misión:
  - `AUTO_ORCHESTRATED` - Squad Lead decide todo
  - `TEMPLATE_BASED` - Usa plantilla predefinida
  - `MANUAL` - Usuario define tareas
- [ ] Orquestación automática al crear (con opción de editar)
- [ ] Vista previa del plan antes de lanzar
- [ ] Botón "Editar Plan" antes de ejecutar

**Archivos**: `data/frontend/src/views/MissionsView.vue`

#### 10.2 Plantillas de Misiones
- [ ] Modelo `MissionTemplate.ts` con plantillas predefinidas:
  - "Análisis de Datos"
  - "Generación de Reporte PDF"
  - "Desarrollo de Feature"
  - "Investigación Web"
- [ ] Endpoint: `GET /api/mission-templates` - Listar plantillas
- [ ] Endpoint: `POST /api/missions/from-template/:id` - Crear desde plantilla
- [ ] UI: Selector de plantilla en creación de misión

**Archivos**: `api/src/models/MissionTemplate.ts`, `api/src/routes/mission-templates.ts`

---

### 🔮 Phase 11: Telegram Integration (FUTURO)

**Objetivo**: Control del sistema HQ a través de Telegram.

#### 11.1 Webhook y Comandos Básicos
- [ ] Configuración de webhook de Telegram
- [ ] Comando `/newmission` - Crear misión desde chat
- [ ] Comando `/status` - Estado de misiones activas
- [ ] Comando `/agents` - Listar agentes y estados
- [ ] Notificaciones: Misión completada, tarea fallida, necesita input humano

**Archivos**: `api/src/routes/telegram.ts`, `api/src/services/telegram.service.ts`

#### 11.2 Respuestas Interactivas
- [ ] Botones inline para aprobar/rechazar planes
- [ ] Responder a preguntas de Squad Lead por Telegram
- [ ] Adjuntar archivos desde Telegram
- [ ] Descargar entregables directamente en el chat

**Archivos**: `api/src/services/telegram.service.ts`

---

### 🚀 Phase 12: Features Avanzadas (FUTURO)

#### 12.1 Dependencias entre Tareas
- [ ] Visualizador de grafo de dependencias (DAG)
- [ ] Validación de dependencias circulares
- [ ] Ejecución paralela de tareas independientes

#### 12.2 Multi-Mission Orchestration
- [ ] Misiones que pueden tener sub-misiones
- [ ] Compartir agentes entre misiones
- [ ] Priorización de misiones competitivas

#### 12.3 Aprendizaje Automático
- [ ] Sugerencias de optimización basadas en historial
- [ ] Detección de patrones de fallo
- [ - Auto-ajuste de parámetros de agentes

#### 12.4 Sandbox de Código
- [ ] Ejecución de código generado en contenedores efímeros
- [ ] Timeout y límites de recursos
- [ ] Captura de output y errores

---

## Orden de Implementación Sugerido

1. **Phase 6.1** - Estructura de archivos (fundamento para todo lo demás)
2. **Phase 6.2** - Modelo Resource/Attachment
3. **Phase 7.1** - Modelo de reintentos (simple,blocking)
4. **Phase 7.2** - Agente Auditor template
5. **Phase 7.3** - Flujo de auditoría completo
6. **Phase 6.3** - Frontend upload de archivos
7. **Phase 8.1** - Streaming de outputs
8. **Phase 8.2** - Consolidación de outputs/PDF
9. **Phase 9.1** - Sistema de scoring
10. **Phase 9.2** - Métricas de agentes
11. **Phase 10.1** - Creación optimizada de misiones
12. **Phase 10.2** - Plantillas de misiones
13. **Phase 11** - Telegram integration
14. **Phase 12** - Features avanzadas

---

## Notas de Diseño

### Principios Rectores

1. **Atomicidad** - Las tareas deben ser pequeñas, específicas e independientes
2. **Contexto Rico** - Cada tarea debe tener suficiente contexto para ser ejecutada
3. **Fault Tolerance** - El sistema debe recuperarse de fallos automáticamente
4. **Observabilidad** - El usuario debe ver qué está pasando en tiempo real
5. **Extensibilidad** - Fácil agregar nuevos tipos de tareas y agentes

### Decisiones Técnicas Pendientes

- [ ] ¿Biblioteca para generar PDF? (`pdf-kit` vs `markdown-pdf` vs `puppeteer`)
- [ ] ¿Límite de tamaño de archivos? (sugerido: 50MB)
- [ ] ¿Retención de archivos de misiones completadas? (sugerido: 30 días)
- [ ] ¿Formato de exportación de misiones? (JSON + carpeta comprimida)

---

**Última actualización**: 2026-02-17
