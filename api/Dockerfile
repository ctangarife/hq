# =============================================================================
# HQ - AI Agent Headquarters
# API Backend (Node.js/Express) - Development Mode
# =============================================================================

FROM node:20-alpine

WORKDIR /app

# Instalar TypeScript y tsx
RUN apk add --no-cache python3 py3-pip && npm install -g typescript tsx

# Copiar package.json primero para mejor cache
COPY package*.json ./
COPY tsconfig.json ./
COPY tsconfig.dev.json ./tsconfig.dev.json

# Instalar dependencias
RUN npm install

# Copiar código fuente (se sobreescribe con volume mount en desarrollo)
COPY src/ ./src/

# Exponer puerto
EXPOSE 3001

# Set development environment
ENV NODE_ENV=development

# Comando por defecto - desarrollo con hot reload
CMD ["npm", "run", "dev"]
