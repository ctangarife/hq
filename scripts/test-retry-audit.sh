#!/bin/bash
# Test Script for Phase 7: Retry & Auditor System
#
# This script runs end-to-end tests for the retry and audit functionality.
# Usage: ./scripts/test-retry-audit.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}======================================${NC}"
echo -e "${CYAN}Phase 7: Retry & Auditor Tests${NC}"
echo -e "${CYAN}======================================${NC}"
echo ""

# Check if API is running
echo -e "${BLUE}Checking if API is running...${NC}"
if ! docker-compose ps api | grep -q "Up"; then
    echo -e "${RED}Error: API container is not running${NC}"
    echo "Please start the system with: docker-compose up -d"
    exit 1
fi
echo -e "${GREEN}✓ API is running${NC}"
echo ""

# Wait for API to be ready
echo -e "${BLUE}Waiting for API to be ready...${NC}"
sleep 3

# Option 1: Run manual test script inside container
echo -e "${CYAN}Running manual E2E tests...${NC}"
docker-compose exec -T api node src/scripts/test-retry-flow.cjs

echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}Tests completed!${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo -e "${BLUE}Check the results above to verify:${NC}"
echo -e "  • Tasks can be marked as failed"
echo -e "  • Retry count increments correctly"
echo -e "  • Audit is triggered at max retries"
echo -e "  • Auditor decisions are processed"
echo -e "  • Task status updates correctly"
echo ""
echo -e "${YELLOW}Note: Test data was created in MongoDB.${NC}"
echo -e "You can clean it up by restarting the containers or manually deleting."
echo ""
