# HQ - Roadmap de Desarrollo

Este documento describe las características planificadas y mejoras futuras del sistema HQ.

## Estado Actual (2026-02-18)

### ✅ Completado

- **OpenClaw Integration** - Agentes con sincronización de credenciales desde MongoDB
- **Provider Management** - Configuración dinámica de providers (Z.ai, MiniMax, Anthropic, OpenAI, Google, Ollama)
- **Squad Lead Orchestration** - Orquestación automática de misiones
- **Human Input Flow** - Solicitudes de información del Squad Lead al usuario
- **Activity View** - Visualización isométrica de agentes en zonas
- **Task Management** - Kanban de tareas con filtros por misión
- **Agent Metrics Dashboard** - Métricas básicas de agentes
- **Phase 6** ✅ - Archivos y Entregables COMPLETO
  - 6.1: Estructura de archivos y volumen Docker
  - 6.2: Modelos Resource y Attachment
  - 6.3: Frontend FileUploader component
- **Phase 7** ✅ - Sistema de Reintentos y Auditor Agent COMPLETO
  - 7.1: Modelo de Reintentos (retryCount, maxRetries, retryHistory)
  - 7.2: Agente Auditor (template con 5 categorías de análisis)
  - 7.3: Flujo de Auditoría (creación automática de tareas de auditoría)
  - 7.4: Frontend - Visualización (badges clickeables, modal de historial)
  - 7.5: Pruebas End-to-End (test suite completo)
- **Phase 10.1** ✅ - Creación Optimizada de Misiones COMPLETO
  - Selector de tipo de misión (AUTO_ORCHESTRATED, TEMPLATE_BASED, MANUAL)
  - Campos de contexto adicionales (context, audience, deliverableFormat, successCriteria, constraints, tone)
  - Modal con scroll interno para pantallas pequeñas
  - Vista previa del plan antes de ejecutar
  - Info contextual para cada tipo
- **Phase 8.1** ✅ - Streaming de Outputs COMPLETO
  - Endpoint SSE para streaming en tiempo real del output de tareas
  - Simulación de streaming con chunks de 200 caracteres
  - Componente TaskOutputStream con indicador Live 🔴
  - Botón "📡 Ver Output Live" en tarjetas de tareas
- **Phase 8.2** ✅ - Consolidación de Outputs COMPLETO
  - Generación de PDF desde Markdown usando PDFKit
  - Botón "📄 Consolidar" en tarjetas de misión
  - Archivos: final_report.md y final_report.pdf en /missions/{id}/outputs/
- **Phase 9** ✅ - Optimización de Asignación de Agentes COMPLETO
  - Sistema de Scoring con 4 factores (rol, disponibilidad, éxito, workload)
  - Métricas de agentes almacenadas en modelo (tasksCompleted, tasksFailed, successRate, totalDuration, averageDuration)
  - Endpoints: GET /api/agents/:id/metrics, POST /api/agents/score, GET /api/agents/:id/score
  - Actualización automática de métricas al completar/fallar tareas
  - Orchestration usa scoring para seleccionar mejor agente
- **Phase 10.2** ✅ - Plantillas de Misiones COMPLETO
  - 6 plantillas del sistema (Análisis de Datos, Reporte PDF, Desarrollo, Investigación, Contenido, Automatización)
  - Modelo MissionTemplate con configuración completa
  - Endpoints: GET /api/mission-templates, POST /api/mission-templates, POST /mission-templates/from-template/:id
  - Frontend: Selector visual de plantillas con iconos y tags
  - Creación rápida de misiones con placeholders reemplazables

---

## Roadmap - Próximas Fases

### 📋 Phase 8: Outputs en Tiempo Real (PRIORIDAD MEDIA)

**Objetivo**: Permitir al usuario ver outputs parciales mientras los agentes trabajan.

#### 8.1 Streaming de Outputs ✅
- [x] Endpoint SSE: `GET /api/tasks/:id/stream` - Output en tiempo real
- [x] Agregar campo `partialOutput` a `Task.ts`
- [x] Modificar `hq-polling-skill.cjs` para enviar chunks durante ejecución
- [x] Frontend: Componente `TaskOutputStream.vue` con actualización en vivo

**Archivos**: `api/src/routes/tasks.ts`, `api/src/models/Task.ts`, `docker/hq-agent-openclaw/hq-polling-skill.cjs`, `data/frontend/src/components/TaskOutputStream.vue`, `api/src/services/task-events.service.ts` ✅ Done

**Cambios Implementados**:
- Endpoint SSE para streaming en tiempo real del output de tareas
- Simulación de streaming: Agente envía output en chunks de 200 caracteres
- Componente frontend con indicador Live 🔴 y cursor parpadeante
- Botón "📡 Ver Output Live" en tarjetas de tareas in_progress/completed
- Modal con panel de output stream en tiempo real

#### 8.2 Consolidación de Outputs ✅
- [x] Servicio para consolidar outputs de múltiples tareas
- [x] Generación de PDF desde Markdown (usando `pdfkit`)
- [x] Endpoint: `POST /api/resources/mission/:missionId/consolidate` - Generar entregable final
- [x] Archivo final en `/missions/{id}/outputs/final_report.pdf`

**Archivos**: `api/src/services/file-management.service.ts`, `api/src/routes/resources.ts`, `data/frontend/src/views/MissionsView.vue` ✅ Done

**Cambios Implementados**:
- Implementación real de `generatePDF()` usando PDFKit
- Convierte markdown a PDF con formato (títulos, código, listas, separadores)
- Botón "📄 Consolidar" en tarjetas de misión (visible cuando status es completed/active)
- Guarda PDF y Markdown en `/missions/{id}/outputs/`

---

### 🎯 Phase 9: Optimización de Asignación de Agentes (PRIORIDAD MEDIA)

**Objetivo**: Sistema inteligente de puntuación para asignar el mejor agente a cada tarea.

#### 9.1 Sistema de Scoring ✅
- [x] Servicio `agent-scoring.service.ts` con lógica de puntuación:
  - Match de rol/capacidades (+40)
  - Disponibilidad (+30)
  - Historial de éxito (+20)
  - Carga de trabajo actual (-10 por tarea pendiente)
- [x] Modificar `orchestration.service.ts` para usar scoring
- [x] Guardar historial de tareas completadas por agente

**Archivos**: `api/src/services/agent-scoring.service.ts`, `api/src/models/Agent.ts`, `api/src/services/orchestration.service.ts` ✅ Done

#### 9.2 Métricas de Agentes ✅
- [x] Agregar campos a `Agent.ts`:
  - `tasksCompleted: number`
  - `tasksFailed: number`
  - `successRate: number`
  - `totalDuration: number` - ms acumuladas
  - `averageDuration: number` - ms promedio
- [x] Endpoint: `GET /api/agents/:id/metrics` - Métricas detalladas
- [x] Endpoint: `POST /api/agents/score` - Score agentes para una tarea
- [x] Actualización automática de métricas al completar/fallar tareas

**Archivos**: `api/src/models/Agent.ts`, `api/src/routes/agents.ts`, `api/src/routes/tasks.ts`, `api/src/services/agents-metrics.service.ts` ✅ Done

**Cambios Implementados**:
- Sistema de scoring con 4 factores (rol, disponibilidad, éxito, workload)
- Mejor agente seleccionado automáticamente al crear tareas
- Métricas almacenadas en modelo Agent (no calculadas en tiempo real)
- Endpoints para consultar métricas y scoring
- Actualización automática de métricas en /tasks/:id/complete y /tasks/:id/fail

---

### 🔧 Phase 10: Mejoras de UX y Flujo de Misiones (PRIORIDAD MEDIA)

**Objetivo**: Hacer más intuitiva la creación y gestión de misiones.

#### 10.1 Creación Optimizada de Misiones ✅
- [x] Selector de tipo de misión:
  - `AUTO_ORCHESTRATED` - Squad Lead decide todo
  - `TEMPLATE_BASED` - Usa plantilla predefinida
  - `MANUAL` - Usuario define tareas
- [x] Orquestación automática al crear (con opción de editar)
- [x] Vista previa del plan antes de lanzar
- [x] Botón "Editar Plan" antes de ejecutar

**Archivos**: `data/frontend/src/views/MissionsView.vue`, `api/src/models/Mission.ts` ✅ Done

**Cambios Implementados**:
- Nuevo campo `missionType` en Mission model (AUTO_ORCHESTRATED, TEMPLATE_BASED, MANUAL)
- UI con selector visual de 3 tipos de misión con iconos
- Modal de vista previa del plan del Squad Lead
- Botones: Confirmar, Editar, Rechazar plan
- Info contextual para cada tipo de misión

#### 10.2 Plantillas de Misiones ✅
- [x] Modelo `MissionTemplate.ts` con plantillas predefinidas:
  - "Análisis de Datos"
  - "Generación de Reporte PDF"
  - "Desarrollo de Feature"
  - "Investigación Web"
  - "Creación de Contenido"
  - "Automatización de Procesos"
- [x] Endpoint: `GET /api/mission-templates` - Listar plantillas
- [x] Endpoint: `GET /api/mission-templates/:id` - Obtener plantilla
- [x] Endpoint: `POST /api/mission-templates` - Crear plantilla custom
- [x] Endpoint: `POST /api/mission-templates/from-template/:id` - Crear desde plantilla
- [x] Endpoint: `PUT /api/mission-templates/:id` - Actualizar plantilla
- [x] Endpoint: `DELETE /api/mission-templates/:id` - Eliminar plantilla
- [x] Inicialización automática de plantillas del sistema al iniciar API
- [x] UI: Selector de plantilla en creación de misión con iconos y tags

**Archivos**: `api/src/models/MissionTemplate.ts`, `api/src/routes/mission-templates.routes.ts`, `api/src/index.ts`, `data/frontend/src/services/api.ts`, `data/frontend/src/views/MissionsView.vue` ✅ Done

**Cambios Implementados**:
- Modelo MissionTemplate con campos para configuración completa de misión
- 6 plantillas del sistema predefinidas (análisis, reportes, desarrollo, investigación, contenido, automatización)
- Soporte para plantillas custom creadas por usuario
- Frontend: Selector visual de plantillas con iconos, descripciones y tags
- Creación rápida de misiones desde plantilla con placeholders
- Pre-fill de campos de contexto desde plantilla seleccionada

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

1. ✅ **Phase 6.1** - Estructura de archivos (fundamento para todo lo demás) - COMPLETADO
2. ✅ **Phase 6.2** - Modelo Resource/Attachment - COMPLETADO
3. ✅ **Phase 7.1** - Modelo de reintentos (simple,blocking) - COMPLETADO
4. ✅ **Phase 7.2** - Agente Auditor template - COMPLETADO
5. ✅ **Phase 7.3** - Flujo de auditoría completo - COMPLETADO
6. ✅ **Phase 6.3** - Frontend upload de archivos - COMPLETADO
7. ✅ **Phase 10.1** - Creación optimizada de misiones - COMPLETADO
8. **Phase 8.1** - Streaming de outputs
9. **Phase 8.2** - Consolidación de outputs/PDF
10. **Phase 9.1** - Sistema de scoring
11. **Phase 9.2** - Métricas de agentes
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

**Última actualización**: 2026-02-18
