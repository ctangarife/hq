# HQ Agent - Imagen personalizada para agentes AI
# Basada en node:20-alpine con soporte para LLM providers

FROM node:20-alpine

WORKDIR /app

# Copiar código del agente
COPY package*.json ./
COPY index.js ./

# Instalar dependencias
RUN npm install --production

# Directorio para datos del agente
RUN mkdir -p /data && \
    chown -R node:node /data

# Usuario
USER node

# CMD por defecto - inicie el agente
CMD ["node", "index.js"]
