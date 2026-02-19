# Phase 12.1: Task Dependencies DAG

**Fecha de implementación**: 2026-02-19

## Resumen

Implementación completa del sistema de dependencias entre tareas con visualización de grafo DAG (Directed Acyclic Graph). Este sistema permite definir dependencias entre tareas, detectar dependencias circulares, visualizar el flujo de trabajo y identificar tareas que pueden ejecutarse en paralelo.

## Componentes Implementados

### Backend

#### 1. Métodos del Modelo Task (`api/src/models/Task.ts`)

Se agregaron 6 nuevos métodos para manejo de dependencias:

```typescript
// Verificar si todas las dependencias están completadas
taskSchema.methods.areDependenciesCompleted()

// Detectar dependencias circulares
taskSchema.methods.detectCircularDependency()

// Obtener tareas que dependen de esta tarea (downstream)
taskSchema.methods.getDependentTasks()

// Obtener tareas que esta tarea depende (upstream)
taskSchema.methods.getUpstreamTasks()

// Obtener nivel en el DAG (para layout visual)
taskSchema.methods.getDAGLevel()

// Verificar si puede ejecutarse
taskSchema.methods.canExecute()
```

**Fix Importante**: Se corrigió el uso de `Task.findById` dentro de métodos del schema, cambiándolo a `mongoose.model('Task')` para evitar el error "Task is not defined".

#### 2. Servicio de Dependencias (`api/src/services/dependencies.service.ts`)

Nuevo servicio con funcionalidades completas de DAG:

```typescript
interface DAGGraph {
  nodes: TaskNode[]      // Nodos del grafo
  edges: DAGEdge[]       // Aristas del grafo
  levels: number         // Profundidad máxima
  hasCycles: boolean     // Si hay ciclos
  cycles: string[][]     // Ciclos detectados
}

// Métodos principales:
- getMissionDAG(missionId)           // Obtiene grafo completo
- getExecutableTasks(missionId)      // Tareas listas para ejecutar
- getBlockedTasks(missionId)         // Tareas bloqueadas y razones
- getCriticalPath(missionId)         // Camino crítico (longest path)
- getDependencyStats(missionId)      // Estadísticas de dependencias
- validateNoCircularDependencies()   // Validación de DAG
- canMissionProceed(missionId)       // Verificar si misión puede continuar
```

#### 3. Endpoints API (`api/src/routes/tasks.ts`)

7 nuevos endpoints para gestión de dependencias:

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/tasks/mission/:id/dag` | Obtiene grafo DAG completo |
| GET | `/api/tasks/mission/:id/dependencies/stats` | Estadísticas de dependencias |
| GET | `/api/tasks/mission/:id/dependencies/executable` | Tareas ejecutables |
| GET | `/api/tasks/mission/:id/dependencies/blocked` | Tareas bloqueadas |
| GET | `/api/tasks/mission/:id/dependencies/critical-path` | Camino crítico |
| POST | `/api/tasks/:id/dependencies` | Agregar dependencia |
| DELETE | `/api/tasks/:id/dependencies/:depId` | Remover dependencia |

### Frontend

#### 1. Componente TaskDependencyGraph (`data/frontend/src/components/TaskDependencyGraph.vue`)

Nuevo componente con visualización interactiva:

**Características**:
- Canvas HTML5 para renderizado del grafo
- Layout por niveles (left-to-right)
- Nodos con colores según estado:
  - 🟢 Verde: Completada
  - 🔵 Azul: En progreso
  - ⚪ Gris: Pendiente
  - 🟠 Naranja: Bloqueada
  - 🔴 Roja: Fallida
- Flechas con curvas Bezier
- Detección y visualización de ciclos
- Click en nodos para ver detalles
- Estadísticas en tiempo real

**API Response Formato**:
```json
{
  "nodes": [
    {
      "taskId": "...",
      "title": "Tarea A",
      "status": "completed",
      "dependencies": [],
      "level": 0,
      "canExecute": false
    }
  ],
  "edges": [
    {
      "from": "task-id-1",
      "to": "task-id-2",
      "status": "completed"
    }
  ],
  "levels": 3,
  "hasCycles": false,
  "cycles": []
}
```

#### 2. Integración en MissionsView (`data/frontend/src/views/MissionsView.vue`)

- Botón "🔗 DAG" en cada tarjeta de misión
- Modal con visualización del grafo
- Click en nodo navega a detalles de tarea

## Ejemplo de Uso

### Crear tareas con dependencias

```bash
# 1. Crear tareas
TASK1=$(curl -X POST http://localhost:3001/api/tasks \
  -H "Authorization: Bearer hq-agent-token" \
  -d '{"title":"Tarea A","missionId":"...","status":"pending"}')

TASK2=$(curl -X POST http://localhost:3001/api/tasks \
  -H "Authorization: Bearer hq-agent-token" \
  -d '{"title":"Tarea B","missionId":"...","status":"pending"}')

# 2. Agregar dependencia (B depende de A)
curl -X POST http://localhost:3001/api/tasks/$TASK2/dependencies \
  -H "Authorization: Bearer hq-agent-token" \
  -d '{"dependsOnTaskId":"'$TASK1'"}'
```

### Obtener grafo DAG

```bash
curl http://localhost:3001/api/tasks/mission/$MISSION_ID/dag \
  -H "Authorization: Bearer hq-agent-token"
```

### Ver tareas ejecutables

```bash
curl http://localhost:3001/api/tasks/mission/$MISSION_ID/dependencies/executable \
  -H "Authorization: Bearer hq-agent-token"
```

## Arquitectura del DAG

```
Nivel 0:  [Tarea A]           (Sin dependencias)
            ↓     ↓
Nivel 1:  [Tarea B] [Tarea C] (Dependen de A)
            ↓     ↓
              ↘  ↓ ↙
Nivel 2:      [Tarea D]       (Depende de B y C)
```

**Propiedades**:
- `level`: Distancia desde tareas raíz (nivel 0)
- `canExecute`: true si dependencias están completadas
- `edges.status`: 'completed' | 'blocked' | 'valid'

## Algoritmos Implementados

### 1. Detección de Ciclos (DFS)

```typescript
detectCircularDependency(cycle = []): string[] | null {
  if (cycle.includes(this.taskId)) return [...cycle, this.taskId]
  if (!this.dependencies.length) return null

  for (depId of this.dependencies) {
    const cycle = await depTask.detectCircularDependency([...cycle, this.taskId])
    if (cycle) return cycle
  }
  return null
}
```

### 2. Cálculo de Nivel DAG

```typescript
getDAGLevel(): number {
  if (!this.dependencies.length) return 0

  let maxLevel = 0
  for (depId of this.dependencies) {
    const depLevel = await depTask.getDAGLevel()
    maxLevel = Math.max(maxLevel, depLevel + 1)
  }
  return maxLevel
}
```

### 3. Layout de Nodos (por nivel)

```typescript
// Agrupar nodos por nivel
const nodesByLevel = new Map<number, TaskNode[]>()
for (const node of nodes) {
  nodesByLevel.get(node.level).push(node)
}

// Calcular posición (x, y)
const levelWidth = canvasWidth / (totalLevels + 1)
const verticalSpacing = canvasHeight / (nodesInLevel + 1)

x = (level + 1) * levelWidth - levelWidth / 2
y = (index + 1) * verticalSpacing
```

## Estadísticas Disponibles

```json
{
  "totalTasks": 4,
  "tasksWithDependencies": 3,
  "averageDependencies": 1.33,
  "maxDependencies": 2,
  "parallelismPotential": 0,
  "currentBlocking": 0
}
```

- `parallelismPotential`: Tareas que pueden ejecutarse en paralelo ahora
- `currentBlocking`: Tareas bloqueadas por dependencias incompletas

## Correcciones Realizadas

### Error: "Task is not defined"

**Problema**: Los métodos del schema Task usaban `Task.findById` pero Task aún no estaba definido cuando se creaban los métodos.

**Solución**: Cambiar `Task.findById` a `mongoose.model('Task')` en todos los métodos del schema.

**Archivos modificados**:
- `api/src/models/Task.ts` (líneas 157, 185, 207, 224, 243)

## Testing

### Test Manual

```bash
# 1. Crear misión de prueba
MISSION_ID=$(curl -X POST http://localhost:3001/api/missions \
  -H "Authorization: Bearer hq-agent-token" \
  -d '{"title":"DAG Test","status":"draft"}' | jq -r '._id')

# 2. Crear 4 tareas
for i in {A..D}; do
  curl -X POST http://localhost:3001/api/tasks \
    -H "Authorization: Bearer hq-agent-token" \
    -d "{\"title\":\"Task $i\",\"missionId\":\"$MISSION_ID\",\"status\":\"pending\"}"
done

# 3. Agregar dependencias
# B -> A, C -> A, D -> B, D -> C

# 4. Verificar grafo
curl http://localhost:3001/api/tasks/mission/$MISSION_ID/dag \
  -H "Authorization: Bearer hq-agent-token"

# 5. Verificar detección de ciclos
# Intentar crear A -> B (que ya tiene B -> A)
```

## Próximos Pasos (Phase 12.2+)

1. **Multi-Mission Orchestration**: Múltiples misiones ejecutándose concurrentemente
2. **Aprendizaje Automático**: Mejora basada en históricos
3. **Sandbox de Código**: Ejecución segura de código

## Archivos Modificados/Creados

| Archivo | Tipo | Cambios |
|---------|------|---------|
| `api/src/models/Task.ts` | Modificado | +6 métodos de dependencias |
| `api/src/services/dependencies.service.ts` | Nuevo | Servicio DAG completo |
| `api/src/routes/tasks.ts` | Modificado | +7 endpoints |
| `data/frontend/src/components/TaskDependencyGraph.vue` | Nuevo | Visualización DAG |
| `data/frontend/src/views/MissionsView.vue` | Modificado | Integración DAG modal |
| `README.md` | Modificado | Actualización roadmap |

## Referencias

- [Algoritmo de detección de ciclos](https://en.wikipedia.org/wiki/Cycle_detection)
- [DAG Layout algorithms](https://en.wikipedia.org/wiki/Directed_acyclic_graph)
- [Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
