/**
 * Setup para tests de integración de la API.
 *
 * Construye una app Express idéntica a src/index.ts PERO sin el side-effect
 * `start()` (que arranca el server, conecta Mongo y hace listen). Así los
 * tests pueden importar la app sin que se levante un puerto.
 *
 * Los tests deben conectar Mongo ellos mismos (beforeAll) en una DB de test
 * aislada, y mockear los servicios externos (dockerService, litellmService).
 */
import express from 'express'
import cors from 'cors'

// Routes (importan solo el router, sin side-effects)
import missionRoutes from '../routes/missions.js'
import taskRoutes from '../routes/tasks.js'
import agentRoutes from '../routes/agents.js'
import promptRoutes from '../routes/prompts.js'
import workspaceRoutes from '../routes/workspaces.js'
import llmConfigRoutes from '../routes/llm-config.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { authMiddleware } from '../middleware/auth.js'

/**
 * Construir la app Express de test.
 *
 * Auth: usa el MISMO middleware JWT-only de prod (authMiddleware). Los tests
 * deben firmar un JWT válido con API_JWT_SECRET — ver smoke-flow.test.ts.
 */
export function buildTestApp() {
  const app = express()

  app.use(cors())
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  // Health (no auth)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'hq-api-test' })
  })

  // Auth middleware (el de prod: acepta Bearer o x-ui-secret)
  app.use('/api', authMiddleware)

  // API Routes (las que el flujo core necesita)
  app.use('/api/missions', missionRoutes)
  app.use('/api/tasks', taskRoutes)
  app.use('/api/agents', agentRoutes)
  app.use('/api/prompts', promptRoutes)
  app.use('/api/workspaces', workspaceRoutes)
  app.use('/api/llm-config', llmConfigRoutes)

  app.use(errorHandler)

  return app
}
