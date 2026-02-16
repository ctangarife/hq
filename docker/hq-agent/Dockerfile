# HQ Agent - Imagen para agentes AI
# Basada en node:20-alpine con soporte para LLM providers

FROM node:20-alpine

WORKDIR /app

# Instalar dependencias necesarias (mongoose para MongoDB)
RUN npm install mongoose@^8.0.0 node-fetch@^2.7.0

# Copiar código del agente
COPY package*.json ./
COPY index.js ./
COPY generate-env-from-mongo.cjs ./
COPY entrypoint.sh ./

# Dar permisos al entrypoint
RUN chmod +x /app/entrypoint.sh

# Directorio para datos del agente
RUN mkdir -p /data && \
    chown -R node:node /data

# Usuario
USER node

# CMD por defecto - ejecutar entrypoint que carga keys e inicia agente
CMD ["/app/entrypoint.sh"]
