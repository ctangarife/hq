/**
 * Retry & Auditor System - End-to-End Tests
 *
 * Pruebas automatizadas para verificar el flujo completo de:
 * 1. Reintentos automáticos
 * 2. Creación de tarea de auditoría
 * 3. Procesamiento de auditoría
 * 4. Ejecución de decisiones del auditor
 *
 * Ejecutar: npm run test:retry-audit
 */

import { describe, it, beforeAll, afterAll, expect, beforeEach } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import Task from '../models/Task.js'
import Mission from '../models/Mission.js'
import Agent from '../models/Agent.js'
import app from '../index.js'

const API_URL = 'http://localhost:3001'
const API_TOKEN = 'hq-agent-token'

// Test data
let testMission: any
let testAgent: any
let testTask: any
let auditTask: any

describe('Phase 7: Retry & Auditor System - E2E Tests', () => {
  beforeAll(async () => {
    // Connect to test database
    await mongoose.connect(process.env.MONGODB_TEST_URI || 'mongodb://root:password@localhost:27017/hq_test?authSource=admin')
  })

  afterAll(async () => {
    // Cleanup and disconnect
    await Task.deleteMany({})
    await Mission.deleteMany({})
    await Agent.deleteMany({})
    await mongoose.disconnect()
  })

  beforeEach(async () => {
    // Clean up before each test
    await Task.deleteMany({})
    await Mission.deleteMany({})
  })

  describe('1. Task Model - Retry System', () => {
    it('should create a task with retry fields', async () => {
      const task = await Task.create({
        missionId: 'test-mission-1',
        title: 'Test Task',
        description: 'Test description',
        type: 'custom',
        status: 'pending',
        retryCount: 0,
        maxRetries: 3
      })

      expect(task.retryCount).toBe(0)
      expect(task.maxRetries).toBe(3)
      expect(task.retryHistory).toEqual([])
    })

    it('should record retry attempts', async () => {
      const task = await Task.create({
        missionId: 'test-mission-2',
        title: 'Test Task',
        status: 'pending'
      })

      // Record first retry
      await task.recordRetry('Connection timeout', 'agent-123')

      expect(task.retryCount).toBe(1)
      expect(task.retryHistory).toHaveLength(1)
      expect(task.retryHistory![0].error).toBe('Connection timeout')
      expect(task.retryHistory![0].agentId).toBe('agent-123')

      // Record second retry
      await task.recordRetry('API rate limit', 'agent-123')

      expect(task.retryCount).toBe(2)
      expect(task.retryHistory).toHaveLength(2)
    })

    it('should determine if task needs retry', async () => {
      const task = await Task.create({
        missionId: 'test-mission-3',
        title: 'Test Task',
        status: 'failed',
        retryCount: 1,
        maxRetries: 3
      })

      expect(task.needsRetry()).toBe(true)

      // Mark max retries
      task.retryCount = 3
      await task.save()

      expect(task.needsRetry()).toBe(false)
    })

    it('should request audit correctly', async () => {
      const task = await Task.create({
        missionId: 'test-mission-4',
        title: 'Test Task',
        status: 'failed',
        retryCount: 3,
        maxRetries: 3
      })

      await task.requestAudit('audit-task-123')

      expect(task.auditorReviewId).toBe('audit-task-123')
      expect(task.status).toBe('pending')
    })
  })

  describe('2. API Endpoints - Fail & Retry', () => {
    let createdTask: any

    beforeEach(async () => {
      createdTask = await Task.create({
        missionId: 'test-mission-api',
        title: 'API Test Task',
        description: 'Test task for API endpoints',
        type: 'custom',
        status: 'pending'
      })
    })

    it('POST /api/tasks/:id/fail - should mark task as failed and record retry', async () => {
      const response = await request(app)
        .post(`/api/tasks/${createdTask._id}/fail`)
        .set('Authorization', `Bearer ${API_TOKEN}`)
        .send({ error: 'Test failure' })

      expect(response.status).toBe(200)
      expect(response.body.task.status).toBe('failed')
      expect(response.body.task.error).toBe('Test failure')
      expect(response.body.retryCount).toBe(1)
    })

    it('POST /api/tasks/:id/fail - should indicate when audit is needed', async () => {
      // Set up task at max retries
      createdTask.retryCount = 2
      createdTask.maxRetries = 3
      await createdTask.save()

      const response = await request(app)
        .post(`/api/tasks/${createdTask._id}/fail`)
        .set('Authorization', `Bearer ${API_TOKEN}`)
        .send({ error: 'Final failure' })

      expect(response.status).toBe(200)
      expect(response.body.needsAudit).toBe(true)
      expect(response.body.retryCount).toBe(3)
    })

    it('POST /api/tasks/:id/retry - should retry failed task', async () => {
      createdTask.status = 'failed'
      createdTask.retryCount = 1
      await createdTask.save()

      const response = await request(app)
        .post(`/api/tasks/${createdTask._id}/retry`)
        .set('Authorization', `Bearer ${API_TOKEN}`)

      expect(response.status).toBe(200)
      expect(response.body.task.status).toBe('pending')
      expect(response.body.task.retryCount).toBe(2)
    })

    it('POST /api/tasks/:id/retry - should reject if at max retries', async () => {
      createdTask.status = 'failed'
      createdTask.retryCount = 3
      createdTask.maxRetries = 3
      await createdTask.save()

      const response = await request(app)
        .post(`/api/tasks/${createdTask._id}/retry`)
        .set('Authorization', `Bearer ${API_TOKEN}`)

      expect(response.status).toBe(400)
      expect(response.body.needsAudit).toBe(true)
    })
  })

  describe('3. Auditor Decision Flow', () => {
    let failedTask: any
    let auditorAgent: any

    beforeEach(async () => {
      // Create an auditor agent
      auditorAgent = await Agent.create({
        name: 'Test Auditor',
        role: 'auditor',
        status: 'idle',
        containerId: 'auditor-container-123'
      })

      // Create a failed task at max retries
      failedTask = await Task.create({
        missionId: 'test-mission-audit',
        title: 'Failed Task',
        description: 'This task needs audit',
        type: 'custom',
        status: 'failed',
        retryCount: 3,
        maxRetries: 3,
        retryHistory: [
          { attempt: 1, error: 'First error', timestamp: new Date() },
          { attempt: 2, error: 'Second error', timestamp: new Date() },
          { attempt: 3, error: 'Third error', timestamp: new Date() }
        ]
      })
    })

    it('POST /api/tasks/:id/auditor-decision - should handle REASSIGN decision', async () => {
      // Create a developer agent to reassign to
      const developerAgent = await Agent.create({
        name: 'Developer',
        role: 'developer',
        status: 'idle',
        containerId: 'dev-container-456'
      })

      const response = await request(app)
        .post(`/api/tasks/${failedTask._id}/auditor-decision`)
        .set('Authorization', `Bearer ${API_TOKEN}`)
        .send({
          decision: 'reassign',
          reason: 'Wrong agent type assigned',
          suggestedAgentRole: 'developer'
        })

      expect(response.status).toBe(200)
      expect(response.body.decision).toBe('reassign')

      // Verify task was reassigned
      const updatedTask = await Task.findById(failedTask._id)
      expect(updatedTask?.status).toBe('pending')
      expect(updatedTask?.auditorReviewId).toBeUndefined()
    })

    it('POST /api/tasks/:id/auditor-decision - should handle REFINE decision', async () => {
      const response = await request(app)
        .post(`/api/tasks/${failedTask._id}/auditor-decision`)
        .set('Authorization', `Bearer ${API_TOKEN}`)
        .send({
          decision: 'refine',
          reason: 'Task description unclear',
          refinedDescription: 'Clear and specific task description'
        })

      expect(response.status).toBe(200)
      expect(response.body.decision).toBe('refine')

      const updatedTask = await Task.findById(failedTask._id)
      expect(updatedTask?.description).toBe('Clear and specific task description')
      expect(updatedTask?.status).toBe('pending')
    })

    it('POST /api/tasks/:id/auditor-decision - should handle ESCALATE_HUMAN decision', async () => {
      const response = await request(app)
        .post(`/api/tasks/${failedTask._id}/auditor-decision`)
        .set('Authorization', `Bearer ${API_TOKEN}`)
        .send({
          decision: 'escalate_human',
          reason: 'Missing required information',
          questionForHuman: 'What is the API endpoint URL?'
        })

      expect(response.status).toBe(200)
      expect(response.body.decision).toBe('escalate_human')

      // Verify human task was created
      const humanTasks = await Task.find({ type: 'human_input' })
      expect(humanTasks.length).toBeGreaterThan(0)

      // Verify original task is awaiting human response
      const updatedTask = await Task.findById(failedTask._id)
      expect(updatedTask?.status).toBe('awaiting_human_response')
    })

    it('POST /api/tasks/:id/auditor-decision - should handle RETRY decision', async () => {
      const response = await request(app)
        .post(`/api/tasks/${failedTask._id}/auditor-decision`)
        .set('Authorization', `Bearer ${API_TOKEN}`)
        .send({
          decision: 'retry',
          reason: 'Temporary network error, should work now'
        })

      expect(response.status).toBe(200)
      expect(response.body.decision).toBe('retry')

      const updatedTask = await Task.findById(failedTask._id)
      expect(updatedTask?.status).toBe('pending')
      expect(updatedTask?.retryCount).toBe(0) // Reset
      expect(updatedTask?.maxRetries).toBe(4) // Increased
    })
  })

  describe('4. Complete Retry Flow Simulation', () => {
    it('should simulate full retry lifecycle', async () => {
      // 1. Create task
      const task = await Task.create({
        missionId: 'test-mission-full',
        title: 'Full Flow Task',
        description: 'Task to test full retry flow',
        type: 'custom',
        status: 'pending',
        maxRetries: 3
      })

      expect(task.retryCount).toBe(0)

      // 2. First failure
      await task.recordRetry('Error 1: Connection timeout', 'agent-1')
      task.status = 'failed'
      await task.save()

      expect(task.retryCount).toBe(1)
      expect(task.retryHistory?.length).toBe(1)

      // 3. Simulate retry (reset to pending)
      task.status = 'pending'
      await task.save()

      // 4. Second failure
      await task.recordRetry('Error 2: API rate limit', 'agent-1')
      task.status = 'failed'
      await task.save()

      expect(task.retryCount).toBe(2)

      // 5. Simulate another retry
      task.status = 'pending'
      await task.save()

      // 6. Third and final failure
      await task.recordRetry('Error 3: Service unavailable', 'agent-1')
      task.status = 'failed'
      await task.save()

      expect(task.retryCount).toBe(3)
      expect(task.retryHistory?.length).toBe(3)

      // 7. Verify needsAudit returns false (already at max)
      expect(task.needsRetry()).toBe(false)

      // 8. Create audit task
      const auditTask = await Task.create({
        missionId: task.missionId,
        title: `Audit: ${task.title}`,
        description: 'Analyze this failed task',
        type: 'auditor_review',
        status: 'pending',
        input: {
          failedTaskId: task._id,
          error: task.error,
          retryHistory: task.retryHistory
        }
      })

      // 9. Link audit task
      await task.requestAudit(auditTask._id.toString())

      expect(task.auditorReviewId).toBe(auditTask._id.toString())

      // 10. Verify audit task exists
      const foundAuditTask = await Task.findById(auditTask._id)
      expect(foundAuditTask?.type).toBe('auditor_review')
    })
  })

  describe('5. Edge Cases', () => {
    it('should handle task with no retry history', async () => {
      const task = await Task.create({
        missionId: 'test-edge-1',
        title: 'Edge Case Task',
        status: 'failed'
      })

      expect(task.retryCount).toBe(0)
      expect(task.retryHistory).toEqual([])
      expect(task.needsRetry()).toBe(true) // Can retry
    })

    it('should prevent retry when under audit', async () => {
      const task = await Task.create({
        missionId: 'test-edge-2',
        title: 'Under Audit Task',
        status: 'failed',
        retryCount: 3,
        maxRetries: 3,
        auditorReviewId: 'some-audit-id'
      })

      expect(task.needsRetry()).toBe(false)
    })

    it('should handle custom maxRetries value', async () => {
      const task = await Task.create({
        missionId: 'test-edge-3',
        title: 'Custom Max Retries',
        status: 'failed',
        retryCount: 4,
        maxRetries: 5
      })

      expect(task.needsRetry()).toBe(true) // 4 < 5
    })

    it('should handle zero maxRetries (no retry)', async () => {
      const task = await Task.create({
        missionId: 'test-edge-4',
        title: 'No Retry Task',
        status: 'failed',
        retryCount: 0,
        maxRetries: 0
      })

      expect(task.needsRetry()).toBe(false) // 0 >= 0
    })
  })
})
