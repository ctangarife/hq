## Rediseño /activity + fixes pendientes de la prueba de agentes

### PARTE 1: Rediseño de /activity — Mapa limpio + panel moderno

Solo `ActivityView.vue`. No se toca `IsometricMap.vue` ni la lógica de datos (SSE, polling, zonas). Sin librerías nuevas.

**1. Header compacto** (reemplaza overlay pesado): barra fina translúcida (backdrop-blur) con título "Actividad HQ", métricas inline (`[● Live] [N activos] [N tareas]`), botones derecha. Se elimina subtítulo inglés, badges de zonas y chips duplicados. El mapa gana toda la pantalla.

**2. Panel lateral: timeline moderna**:
- Filtros por tipo (chips): Todos / 🎯 Misiones / ✓ Tareas / 🤖 Agentes / 📦 Containers
- Agrupación temporal con separadores: "Ahora" / "Hace unos minutos" / "Hace una hora" / fecha
- Timestamps relativos (`timeAgo()`: "hace 30s", "hace 5 min") con refresco cada 30s
- Animaciones de entrada con `<TransitionGroup>` (slide+fade CSS pura)
- Cards con línea vertical color-codificada, hover sutil
- Estado vacío amigable

**3. Detalle agente/zona**: misma lógica, estilos refrescados.

**4. Idioma**: todo español consistente.

### PARTE 2: Fix 1 — Race condition stdin en `runEphemeralTask`

**Bug** (descubierto en la prueba Pentia): `docker.service.ts` hace `container.start()` → `attach()` → `write(prompt)`. Goose arranca leyendo stdin inmediatamente; si el attach conecta después, el prompt se pierde → Goose saluda al vacío → bucle infinito con RestartPolicy. Colgó las 3 tareas de la prueba.

**Fix**: attach ANTES de start. Dockerode lo soporta sobre containers creados con `AttachStdin: true, OpenStdin: true`:
```
createContainer → container.attach(stream) → container.start() → stream.write(prompt) → stream.end()
```
El stdin está conectado antes de que el ENTRYPOINT arranque — la race desaparece.

### PARTE 3: Fix 2 — Output limpio del especialista

**Bug**: Goose usa tools internas (`todo_write`, `delegate`) y devuelve razonamiento + planes mezclados con el entregable. En la prueba: Post #1 salió limpio, #2 devolvió un PLAN (no el post), #3 mezcló razonamiento.

**Fix**: en `task-dispatcher.service.ts` → `buildSpecialistPrompt()`, añadir instrucción explícita de output:
- "Entrega ÚNICAMENTE el contenido final solicitado en tu respuesta"
- "NO incluyas planes, análisis previos, TODOs, ni explicaciones de tu proceso"
- "NO delegues la tarea: ejecútala tú directamente"
- Mantener el "reporta el resultado en español" existente

Esto ataca la causa raíz de los outputs contaminados sin tocar infraestructura.

### Archivos
| Archivo | Cambio |
|---|---|
| `data/frontend/src/views/ActivityView.vue` | Rediseño (Parte 1) |
| `api/src/services/docker.service.ts` | Fix stdin race (Parte 2) |
| `api/src/services/task-dispatcher.service.ts` | Fix output limpio (Parte 3) |

### Validación
1. `npm run build` en `data/frontend/` sin errores
2. Restart frontend container → screenshot del nuevo /activity para confirmar visualmente
3. Smoke test del fix de dispatcher: rebuild no requerido (la API usa tsx en runtime con volumen montado — `podman compose restart api` aplica)
4. Los 3 tests Vitest siguen en verde (`podman compose exec api npm test`)

### Fuera de alcance
- IsometricMap.vue, backend de activity, otras vistas
- Rebuild de imagen hq-agent-goose (el fix del stdin es en la API que spawnea, no en la imagen)