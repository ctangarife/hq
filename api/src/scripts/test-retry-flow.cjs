#!/usr/bin/env node
/**
 * Manual E2E Test Script for Retry & Auditor System
 *
 * This script tests the complete retry and audit flow without requiring Jest.
 * Run: node api/src/scripts/test-retry-flow.cjs
 */

const http = require('http');

const API_HOST = process.env.API_HOST || 'localhost';
const API_PORT = process.env.API_PORT || '3001';
const API_TOKEN = 'hq-agent-token';

// Helper function for HTTP requests
function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'cyan');
  console.log('='.repeat(60));
}

function logTest(name) {
  console.log(`\n📋 ${name}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

// Test data storage
let testMissionId = null;
let testTaskId = null;
let auditTaskId = null;

// Main test flow
async function runTests() {
  logSection('🧪 Phase 7: Retry & Auditor System - Manual E2E Tests');

  try {
    // ============================================================
    // TEST 1: Create a test mission
    // ============================================================
    logSection('TEST 1: Create Test Mission');
    logTest('Creating mission...');

    const missionResponse = await makeRequest('POST', '/api/missions', {
      title: 'Test Mission for Retry Flow',
      description: 'Mission to test retry and audit system',
      objective: 'Verify all retry and audit functionality',
      status: 'active'
    });

    if (missionResponse.status === 201) {
      testMissionId = missionResponse.data._id;
      logSuccess(`Mission created: ${testMissionId}`);
    } else {
      logError(`Failed to create mission: ${JSON.stringify(missionResponse.data)}`);
      return;
    }

    // ============================================================
    // TEST 2: Create a task that will fail
    // ============================================================
    logSection('TEST 2: Create Test Task');
    logTest('Creating task...');

    const taskResponse = await makeRequest('POST', '/api/tasks', {
      missionId: testMissionId,
      title: 'Test Task for Retries',
      description: 'This task will be failed multiple times to test retry logic',
      type: 'custom',
      status: 'pending',
      maxRetries: 3
    });

    if (taskResponse.status === 201) {
      testTaskId = taskResponse.data._id;
      logSuccess(`Task created: ${testTaskId}`);
    } else {
      logError(`Failed to create task: ${JSON.stringify(taskResponse.data)}`);
      return;
    }

    // ============================================================
    // TEST 3: Simulate first failure
    // ============================================================
    logSection('TEST 3: First Failure');
    logTest('Failing task (attempt 1)...');

    const fail1Response = await makeRequest('POST', `/api/tasks/${testTaskId}/fail`, {
      error: 'Connection timeout - Attempt 1'
    });

    if (fail1Response.status === 200) {
      logSuccess('Task marked as failed');
      logInfo(`Retry count: ${fail1Response.data.retryCount}`);
      logInfo(`Needs audit: ${fail1Response.data.needsAudit ? 'Yes' : 'No'}`);
    } else {
      logError(`Failed to mark task as failed: ${JSON.stringify(fail1Response.data)}`);
    }

    // ============================================================
    // TEST 4: Simulate second failure
    // ============================================================
    logSection('TEST 4: Second Failure');
    logTest('Failing task again (attempt 2)...');

    const fail2Response = await makeRequest('POST', `/api/tasks/${testTaskId}/fail`, {
      error: 'API rate limit - Attempt 2'
    });

    if (fail2Response.status === 200) {
      logSuccess('Task marked as failed again');
      logInfo(`Retry count: ${fail2Response.data.retryCount}`);
      logInfo(`Needs audit: ${fail2Response.data.needsAudit ? 'Yes' : 'No'}`);
    } else {
      logError(`Failed to mark task as failed: ${JSON.stringify(fail2Response.data)}`);
    }

    // ============================================================
    // TEST 5: Simulate third and final failure
    // ============================================================
    logSection('TEST 5: Third Failure (Max Retries)');
    logTest('Failing task final time (attempt 3)...');

    const fail3Response = await makeRequest('POST', `/api/tasks/${testTaskId}/fail`, {
      error: 'Service unavailable - Attempt 3'
    });

    if (fail3Response.status === 200) {
      logSuccess('Task marked as failed (max retries reached)');
      logInfo(`Retry count: ${fail3Response.data.retryCount}`);
      logInfo(`Max retries: ${fail3Response.data.maxRetries}`);
      logInfo(`Needs audit: ${fail3Response.data.needsAudit ? 'Yes' : 'No'}`);

      if (fail3Response.data.needsAudit) {
        logSuccess('✓ System correctly identified that audit is needed!');
      }
    } else {
      logError(`Failed to mark task as failed: ${JSON.stringify(fail3Response.data)}`);
    }

    // ============================================================
    // TEST 6: Try manual retry (should fail - at max retries)
    // ============================================================
    logSection('TEST 6: Manual Retry Attempt (Should Fail)');
    logTest('Attempting to retry task at max retries...');

    const retryResponse = await makeRequest('POST', `/api/tasks/${testTaskId}/retry`);

    if (retryResponse.status === 400) {
      logSuccess('Manual retry correctly rejected');
      logInfo(`Reason: ${retryResponse.data.error}`);
      if (retryResponse.data.needsAudit) {
        logSuccess('✓ System indicates audit is required!');
      }
    } else {
      logError('Manual retry should have been rejected!');
    }

    // ============================================================
    // TEST 7: Create audit task manually
    // ============================================================
    logSection('TEST 7: Create Audit Task');
    logTest('Creating auditor_review task...');

    const getTaskResponse = await makeRequest('GET', `/api/tasks/${testTaskId}`);

    if (getTaskResponse.status === 200) {
      const taskData = getTaskResponse.data;

      const auditResponse = await makeRequest('POST', '/api/tasks', {
        missionId: testMissionId,
        title: `Audit: ${taskData.title}`,
        description: `
TAREA ORIGINAL:
- Título: ${taskData.title}
- Descripción: ${taskData.description || 'Sin descripción'}
- Tipo: ${taskData.type}

ERROR:
${taskData.error}

HISTORIAL DE REINTENTOS (${taskData.retryCount || 0}/${taskData.maxRetries || 3}):
${taskData.retryHistory ? taskData.retryHistory.map((r, i) =>
  `Intento ${i + 1}: ${r.error} (${new Date(r.timestamp).toISOString()})`
).join('\n') : 'Sin historial'}

ANALIZA y decide la mejor acción:
1. ¿El agente no tiene las habilidades necesarias? → REASSIGN
2. ¿La tarea está mal definida? → REFINE
3. ¿Falta información/archivos? → ESCALATE_HUMAN
4. ¿Una tarea previa falló? → RECREATE
5. ¿Error temporal (timeout, red)? → RETRY

Responde SOLO con JSON (sin markdown):
{
  "decision": "reassign|refine|escalate_human|retry",
  "reason": "Breve explicación",
  "suggestedAgentRole": "researcher|developer|writer|analyst|null",
  "refinedDescription": "Descripción mejorada",
  "questionForHuman": "Qué información necesitas?"
}
        `,
        type: 'auditor_review',
        status: 'pending',
        priority: 'high',
        input: {
          failedTaskId: testTaskId,
          originalTaskType: taskData.type,
          originalAssignedTo: taskData.assignedTo,
          error: taskData.error,
          retryHistory: taskData.retryHistory,
          retryCount: taskData.retryCount
        }
      });

      if (auditResponse.status === 201) {
        auditTaskId = auditResponse.data._id;
        logSuccess(`Audit task created: ${auditTaskId}`);
      } else {
        logError(`Failed to create audit task: ${JSON.stringify(auditResponse.data)}`);
      }
    }

    // ============================================================
    // TEST 8: Test auditor decision - RETRY
    // ============================================================
    logSection('TEST 8: Auditor Decision - RETRY');
    logTest('Processing auditor decision: retry...');

    const retryDecisionResponse = await makeRequest('POST', `/api/tasks/${testTaskId}/auditor-decision`, {
      decision: 'retry',
      reason: 'Temporary network error, should work now'
    });

    if (retryDecisionResponse.status === 200) {
      logSuccess('Auditor decision processed');
      logInfo(`Decision: ${retryDecisionResponse.data.decision}`);
      logInfo(`Message: ${retryDecisionResponse.data.message}`);
      logInfo(`New max retries: ${retryDecisionResponse.data.newMaxRetries}`);
    } else {
      logError(`Failed to process auditor decision: ${JSON.stringify(retryDecisionResponse.data)}`);
    }

    // ============================================================
    // TEST 9: Verify task can be retried again
    // ============================================================
    logSection('TEST 9: Verify Task Can Be Retried');
    logTest('Checking task status after audit decision...');

    const verifyResponse = await makeRequest('GET', `/api/tasks/${testTaskId}`);

    if (verifyResponse.status === 200) {
      const task = verifyResponse.data;
      logSuccess('Task retrieved successfully');
      logInfo(`Status: ${task.status}`);
      logInfo(`Retry count: ${task.retryCount}`);
      logInfo(`Max retries: ${task.maxRetries}`);
      logInfo(`Auditor review ID: ${task.auditorReviewId || 'None'}`);

      if (task.status === 'pending' && task.retryCount === 0 && task.maxRetries === 4) {
        logSuccess('✓ Task correctly reset for retry!');
      }
    }

    // ============================================================
    // TEST 10: Test auditor decision - REFINE
    // ============================================================
    logSection('TEST 10: Auditor Decision - REFINE');
    logTest('Testing refine decision...');

    // Create another task for refine test
    const refineTaskResponse = await makeRequest('POST', '/api/tasks', {
      missionId: testMissionId,
      title: 'Vague Task',
      description: 'Do something',
      type: 'custom',
      status: 'failed',
      retryCount: 3,
      maxRetries: 3
    });

    if (refineTaskResponse.status === 201) {
      const refineTaskId = refineTaskResponse.data._id;

      const refineDecisionResponse = await makeRequest('POST', `/api/tasks/${refineTaskId}/auditor-decision`, {
        decision: 'refine',
        reason: 'Task description too vague',
        refinedDescription: 'Create a REST API endpoint for user authentication with JWT tokens'
      });

      if (refineDecisionResponse.status === 200) {
        logSuccess('Refine decision processed');

        const verifyRefineResponse = await makeRequest('GET', `/api/tasks/${refineTaskId}`);
        if (verifyRefineResponse.status === 200) {
          const task = verifyRefineResponse.data;
          logInfo(`New description: ${task.description}`);
          if (task.description.includes('REST API endpoint')) {
            logSuccess('✓ Task description successfully refined!');
          }
        }
      }
    }

    // ============================================================
    // SUMMARY
    // ============================================================
    logSection('📊 TEST SUMMARY');
    logSuccess('All tests completed!');
    logInfo(`Test Mission ID: ${testMissionId}`);
    logInfo(`Test Task ID: ${testTaskId}`);
    logInfo(`Audit Task ID: ${auditTaskId}`);
    log('\n' + '='.repeat(60));
    log('🎉 Retry & Auditor System E2E Tests Completed!', 'green');
    log('='.repeat(60) + '\n');

  } catch (error) {
    logError(`Test failed with error: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Run tests
log('\n🚀 Starting Retry & Auditor System Tests...\n');
runTests().then(() => {
  process.exit(0);
}).catch((error) => {
  logError(`Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
