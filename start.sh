#!/bin/bash
# HQ - Quick Start Script

set -e

echo "🦞 HQ - AI Agent Headquarters"
echo "================================"

# Check if .env exists
if [ ! -f .env ]; then
  echo "⚠️  .env not found. Creating from template..."
  cp env.template .env
  echo "✅ Created .env file. Please edit it with your configuration:"
  echo "   - UI_SECRET (required)"
  echo "   - MONGODB_ROOT_PASSWORD (required)"
  echo "   - TELEGRAM_BOT_TOKEN (optional)"
  echo ""
  read -p "Press Enter to continue after editing .env..."
fi

# Create necessary directories
echo "📁 Creating data directories..."
mkdir -p data/mongodb data/static data/frontend

# Start services
echo "🚀 Starting services..."
docker compose up -d --build

echo ""
echo "✅ Services started!"
echo ""
echo "📍 Access URLs:"
echo "   - Dashboard:  http://localhost"
echo "   - API:       http://localhost/api"
echo "   - Health:     http://localhost:8080/nginx-health"
echo ""
echo "📊 View logs with: docker compose logs -f"
echo "🛑 Stop services with: docker compose down"
