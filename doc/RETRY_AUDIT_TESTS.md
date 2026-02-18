# Phase 7: Retry & Auditor System - Tests

This document describes how to test the Retry and Auditor functionality implemented in Phase 7.

## Quick Test

Run the automated test script:

```bash
./scripts/test-retry-audit.sh
```

This will:
1. Check if the API is running
2. Run the manual E2E test script
3. Display results

## Test Files

### 1. Manual E2E Test (`api/src/scripts/test-retry-flow.cjs`)

**Purpose**: End-to-end testing of the complete retry and audit flow without requiring Jest.

**What it tests**:
- ✓ Creating a mission and task
- ✓ Simulating first failure (retry 1/3)
- ✓ Simulating second failure (retry 2/3)
- ✓ Simulating third failure (retry 3/3 - max reached)
- ✓ Verifying "needs audit" is triggered
- ✓ Attempting manual retry (should be rejected)
- ✓ Creating audit task
- ✓ Processing auditor decision (RETRY)
- ✓ Processing auditor decision (REFINE)
- ✓ Verifying task is reset and can be retried

**Run manually**:
```bash
# From inside the API container
docker exec -it hq-api node src/scripts/test-retry-flow.cjs

# Or from host (if API_PORT is exposed)
node api/src/scripts/test-retry-flow.cjs
```

### 2. Jest Test Suite (`api/src/tests/retry-audit.test.ts`)

**Purpose**: Comprehensive unit and integration tests using Jest.

**What it tests**:
- Task model methods (recordRetry, needsRetry, requestAudit)
- API endpoints (/fail, /retry, /auditor-decision)
- All 4 auditor decisions (reassign, refine, escalate_human, retry)
- Complete retry lifecycle
- Edge cases (no history, under audit, custom maxRetries)

**Run with Jest**:
```bash
cd api
npm run test:retry-audit
```

## Test Coverage

### Task Model Tests

| Test | Description |
|------|-------------|
| `create task with retry fields` | Verifies retryCount, maxRetries, retryHistory |
| `record retry attempts` | Tests recordRetry() method |
| `determine if task needs retry` | Tests needsRetry() method |
| `request audit correctly` | Tests requestAudit() method |

### API Endpoint Tests

| Endpoint | Test |
|----------|------|
| `POST /:id/fail` | Marks task as failed, records retry |
| `POST /:id/fail` | Returns needsAudit when max reached |
| `POST /:id/retry` | Retries failed task |
| `POST /:id/retry` | Rejects retry at max retries |
| `POST /:id/auditor-decision` | Handles REASSIGN |
| `POST /:id/auditor-decision` | Handles REFINE |
| `POST /:id/auditor-decision` | Handles ESCALATE_HUMAN |
| `POST /:id/auditor-decision` | Handles RETRY |

### Auditor Decision Tests

| Decision | Behavior |
|----------|----------|
| `reassign` | Finds new agent, assigns task, sets pending |
| `refine` | Updates task description, sets pending |
| `escalate_human` | Creates human_input task, sets awaiting_human_response |
| `retry` | Resets retryCount, increments maxRetries, sets pending |

## Expected Output

### Successful Test Run

```
======================================
🧪 Phase 7: Retry & Auditor System - Manual E2E Tests
======================================

TEST 1: Create Test Mission
📋 Creating mission...
✅ Mission created: 678abcdef123456

TEST 2: Create Test Task
📋 Creating task...
✅ Task created: 123456abcdef789

TEST 3: First Failure
📋 Failing task (attempt 1)...
✅ Task marked as failed
ℹ️  Retry count: 1
ℹ️  Needs audit: No

TEST 4: Second Failure
📋 Failing task again (attempt 2)...
✅ Task marked as failed again
ℹ️  Retry count: 2
ℹ️  Needs audit: No

TEST 5: Third Failure (Max Retries)
📋 Failing task final time (attempt 3)...
✅ Task marked as failed (max retries reached)
ℹ️  Retry count: 3
ℹ️  Max retries: 3
ℹ️  Needs audit: Yes
✅ ✓ System correctly identified that audit is needed!

TEST 6: Manual Retry Attempt (Should Fail)
📋 Attempting to retry task at max retries...
✅ Manual retry correctly rejected
ℹ️  Reason: Task has reached maximum retries. Use auditor to review.
✅ ✓ System indicates audit is required!

TEST 7: Create Audit Task
📋 Creating auditor_review task...
✅ Audit task created: 987654fedcba321

TEST 8: Auditor Decision - RETRY
📋 Processing auditor decision: retry...
✅ Auditor decision processed
ℹ️  Decision: retry
ℹ️  Message: Task queued for retry with extra attempt
ℹ️  New max retries: 4

TEST 9: Verify Task Can Be Retried
📋 Checking task status after audit decision...
✅ Task retrieved successfully
ℹ️  Status: pending
ℹ️  Retry count: 0
ℹ️  Max retries: 4
ℹ️  Auditor review ID: None
✅ ✓ Task correctly reset for retry!

TEST 10: Auditor Decision - REFINE
📋 Testing refine decision...
✅ Refine decision processed
ℹ️  New description: Create a REST API endpoint...
✅ ✓ Task description successfully refined!

======================================
📊 TEST SUMMARY
======================================
✅ All tests completed!
ℹ️  Test Mission ID: 678abcdef123456
ℹ️  Test Task ID: 123456abcdef789
ℹ️  Audit Task ID: 987654fedcba321

======================================
🎉 Retry & Auditor System E2E Tests Completed!
======================================
```

## Manual Testing with cURL

If you prefer to test manually with cURL:

### 1. Create a task
```bash
curl -X POST http://localhost:3001/api/tasks \
  -H "Authorization: Bearer hq-agent-token" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Retry Task",
    "description": "This task will test retries",
    "type": "custom",
    "status": "pending",
    "maxRetries": 3
  }'
```

### 2. Fail the task (first attempt)
```bash
curl -X POST http://localhost:3001/api/tasks/TASK_ID/fail \
  -H "Authorization: Bearer hq-agent-token" \
  -H "Content-Type: application/json" \
  -d '{"error": "Connection timeout"}'
```

### 3. Fail again (second attempt)
```bash
curl -X POST http://localhost:3001/api/tasks/TASK_ID/fail \
  -H "Authorization: Bearer hq-agent-token" \
  -H "Content-Type: application/json" \
  -d '{"error": "API rate limit"}'
```

### 4. Fail third time (max retries)
```bash
curl -X POST http://localhost:3001/api/tasks/TASK_ID/fail \
  -H "Authorization: Bearer hq-agent-token" \
  -H "Content-Type: application/json" \
  -d '{"error": "Service unavailable"}'
```

### 5. Try to retry (should fail)
```bash
curl -X POST http://localhost:3001/api/tasks/TASK_ID/retry \
  -H "Authorization: Bearer hq-agent-token"
```

Expected response: `{"error":"Task has reached maximum retries. Use auditor to review.","needsAudit":true}`

### 6. Process auditor decision
```bash
curl -X POST http://localhost:3001/api/tasks/TASK_ID/auditor-decision \
  -H "Authorization: Bearer hq-agent-token" \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "retry",
    "reason": "Temporary error, should work now"
  }'
```

## Verifying Results in MongoDB

After running tests, you can verify the data in MongoDB:

```bash
docker exec -it hq-mongodb mongosh \
  "mongodb://root:password@localhost:27017/hq?authSource=admin" \
  --eval '
    db.tasks.find(
      { title: { $in: [/Test Retry Task/, /Audit:/] } },
      { title: 1, status: 1, retryCount: 1, maxRetries: 1, type: 1 }
    ).forEach(printjson)
  '
```

## Cleaning Up Test Data

To remove test data:

```bash
# Option 1: Delete all tasks with "Test" in title
docker exec hq-mongodb mongosh \
  "mongodb://root:password@localhost:27017/hq?authSource=admin" \
  --eval 'db.tasks.deleteMany({ title: /Test/i })'

# Option 2: Delete all test missions
docker exec hq-mongodb mongosh \
  "mongodb://root:password@localhost:27017/hq?authSource=admin" \
  --eval 'db.missions.deleteMany({ title: /Test/i })'

# Option 3: Restart containers (fresh state)
docker-compose restart api
```

## Troubleshooting

### Test fails with "ECONNREFUSED"

**Problem**: API is not running or not accessible.

**Solution**:
```bash
docker-compose up -d api
docker logs hq-api --tail 50
```

### Test fails with "401 Unauthorized"

**Problem**: API token is incorrect.

**Solution**: Check `HQ_API_TOKEN` in `.env` and verify it matches the token in the script.

### Task not found errors

**Problem**: Task ID is incorrect or task was deleted.

**Solution**: Run the test from the beginning to create fresh test data.

### Audit decision not processing

**Problem**: Agent for reassignment doesn't exist.

**Solution**: Create the required agent type first, or use a different decision (refine/retry).

## Next Steps

After running tests successfully:

1. **Phase 8**: Outputs en Tiempo Real (Streaming SSE, Consolidación de outputs)
2. **Phase 9**: Optimización de Asignación de Agentes (Sistema de scoring, Métricas)
3. **Phase 10**: Testing & Documentation completos
