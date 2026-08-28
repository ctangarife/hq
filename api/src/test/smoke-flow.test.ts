/**
 * Smoke Test - Flujo core de HQ (end-to-end con mocks)
 *
 * Valida el flujo principal que sustenta los 2 casos de uso del producto:
 *   1. Creación de contenido/estrategia accesible (creador sin agencia)
 *   2. Fact-checking de noticias (verificar si es fake news)
 *
 * Flujo probado:
 *   POST /api/missions  → crea misión
 *   POST /api/missions/:id/orchestrate → dispara selectSquadLead +
 *     createInitialMissionTask (crea agente Squad Lead + tarea mission_analysis)
 *
 * Lo que se mockea (no se ejecuta de verdad):
 *   - dockerService: createAgentContainer / runEphemeralTask (no spawnea containers)
 *   - litellmService: getKey (no lee virtual keys reales)
 *
 * Lo que se ejecuta REAL:
 *   - MongoDB (DB aislada hq_test): modelos Mission, Agent, Task, Prompt
 *   - promptService (resuelve de Mongo, con fallback si no hay prompts)
 *   - Todos los routers y middleware de Express
 *
 * Este test es la red de seguridad: si un refactor rompe el flujo core
 * (crear misión → spawnea Squad Lead con la imagen correcta), el test
 * falla antes de llegar a producción.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import mongoose from 'mongoose'
import request from 'supertest'
import jwt from 'jsonwebtoken'

// Mocks DEBEN ir antes de importar la app (Vitest los aplica al módulo)
// Importamos el mock factory para poder espiar las llamadas.
vi.mock('../services/docker.service.js', () => ({
  dockerService: {
    createAgentContainer: vi.fn().mockResolvedValue('test-container-mock-id'),
    runEphemeralTask: vi.fn().mockResolvedValue('Output simulado del especialista'),
  },
}))

vi.mock('../services/litellm.service.js', () => ({
  // default export (litellmService) y named export
  default: {
    getKey: vi.fn().mockResolvedValue('sk-test-virtual-key'),
    chatCompletion: vi.fn().mockResolvedValue('Respuesta simulada'),
  },
  litellmService: {
    getKey: vi.fn().mockResolvedValue('sk-test-virtual-key'),
    chatCompletion: vi.fn().mockResolvedValue('Respuesta simulada'),
  },
}))

// Importar DESPUÉS de los mocks para que intercepten
import { buildTestApp } from './setup.js'
import { dockerService } from '../services/docker.service.js'
import Agent from '../models/Agent.js'
import Task from '../models/Task.js'

const app = buildTestApp()

// Auth: el middleware de prod verifica JWT firmado con API_JWT_SECRET.
// Firmamos un token de test con el MISMO secret del entorno (valor por
// defecto si el env no lo define) — desde la migración a JWT-only el
// bearer fake 'test-token' da 401.
const TEST_JWT_SECRET = process.env.API_JWT_SECRET || 'hq-dev-secret-change-in-prod'
const AUTH = {
  Authorization:
    'Bearer ' +
    jwt.sign(
      {
        userId: 'test-user-id',
        email: 'test@hq.local',
        name: 'Test Runner',
        role: 'super_admin',
      },
      TEST_JWT_SECRET,
      { expiresIn: '1h' },
    ),
}

// Mongo URI de test (DB aislada, no toca la de prod `hq`)
const MONGO_TEST_URI =
  process.env.MONGODB_TEST_URI ||
  `mongodb://${process.env.MONGODB_USERNAME || 'root'}:${process.env.MONGODB_PASSWORD || ''}@${process.env.MONGODB_HOST || 'mongodb'}:${process.env.MONGODB_PORT || '27017'}/hq_test?authSource=admin`

describe('Smoke: flujo core HQ (misión → Squad Lead)', () => {
  beforeAll(async () => {
    await mongoose.connect(MONGO_TEST_URI)
  })

  afterAll(async () => {
    await mongoose.disconnect()
  })

  beforeEach(async () => {
    // Limpiar colecciones entre tests para aislamiento
    await Promise.all([
      Agent.deleteMany({}),
      Task.deleteMany({}),
      mongoose.connection.collection('missions').deleteMany({}),
    ])
    // Resetear los contadores de llamadas de los mocks
    vi.mocked(dockerService.createAgentContainer).mockClear()
  })

  it('crea una misión y la orquesta (Squad Lead + tarea mission_analysis)', async () => {
    // ── Paso 1: crear misión ──
    const createRes = await request(app)
      .post('/api/missions')
      .set(AUTH)
      .send({
        title: 'Crear contenido para Instagram sobre café de especialidad',
        description:
          'Generar 3 posts para Instagram sobre café de especialidad, ' +
          'dirigidos a una audiencia joven interesada en cultura coffee.',
        objective: 'Producir 3 piezas de contenido para redes',
        priority: 'medium',
      })
      .expect(201)

    const mission = createRes.body
    expect(mission._id).toBeDefined()
    expect(mission.status).toBe('draft')
    const missionId = mission._id

    // ── Paso 2: orquestar (dispara selectSquadLead + createInitialMissionTask) ──
    const orchestrateRes = await request(app)
      .post(`/api/missions/${missionId}/orchestrate`)
      .set(AUTH)
      .expect(200)

    expect(orchestrateRes.body.message).toBe('Mission orchestration started')
    expect(orchestrateRes.body.squadLead.role).toBe('squad_lead')
    const squadLeadId = orchestrateRes.body.squadLead._id

    // ── Paso 3: verificar que el agente Squad Lead se creó en Mongo ──
    const squadLead = await Agent.findById(squadLeadId)
    expect(squadLead).toBeTruthy()
    expect(squadLead!.role).toBe('squad_lead')
    expect(squadLead!.status).toBe('active')

    // ── Paso 4: verificar que se creó la tarea mission_analysis (pending) ──
    const initialTaskId = orchestrateRes.body.initialTask._id
    const analysisTask = await Task.findById(initialTaskId)
    expect(analysisTask).toBeTruthy()
    expect(analysisTask!.type).toBe('mission_analysis')
    expect(analysisTask!.status).toBe('pending')

    // ── Paso 5: verificar que dockerService.createAgentContainer fue llamado ──
    // con el Squad Lead. La imagen se elige por rol (orchestrator para squad_lead).
    expect(dockerService.createAgentContainer).toHaveBeenCalledTimes(1)
    const callArgs = vi.mocked(dockerService.createAgentContainer).mock.calls[0]
    expect(callArgs[0]).toBe(squadLeadId) // agentId
    expect(callArgs[1].role).toBe('squad_lead') // agent config con rol squad_lead
  })

  it('responde 404 al orquestar una misión inexistente', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString()
    await request(app)
      .post(`/api/missions/${fakeId}/orchestrate`)
      .set(AUTH)
      .expect(404)
  })
})
