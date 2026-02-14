# ==============================================================================
# HQ - AI Agent Headquarters
# Frontend Dockerfile (Vue 3 + Vite)
# ==============================================================================
# Similar a openclaw-docker: código se monta como volumen, build in-container

FROM node:20-alpine

WORKDIR /app

EXPOSE 3000

# Install dependencies (para cache en capa separada)
# Nota: El código fuente se monta como volumen en docker-compose
# CMD ["sh", "-c", "npm install && npm run dev"]
