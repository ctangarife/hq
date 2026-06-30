# ==============================================================================
# HQ Agent - Orchestrator Runtime (Goose + polling skill)
# ==============================================================================
# Imagen PERSISTENTE para orquestadores: Squad Lead y Auditor.
#
# Diferencia con hq-agent-goose (efímero):
#   - hq-agent-goose: 1 tarea = 1 container, muere al terminar. Para
#     especialistas (researcher, writer, developer, analyst).
#   - hq-agent-orchestrator: proceso Node.js con polling loop continuo. Mantiene
#     estado entre tareas, maneja flujos multi-step (mission_analysis two-step,
#     auditor_review con auto-execute). Invoca Goose como subprocess para cada
#     LLM call.
#
# Arquitectura de dos capas:
#   1. Node.js runtime: ejecuta hq-polling-skill.cjs (loop, HTTP a API HQ,
#      lógica de orquestación, web scraping, streaming).
#   2. Goose CLI: subprocess invocado por el skill para cada inferencia LLM.
#      Recibe el prompt por stdin, devuelve output limpio por stdout.
#
# Todos los LLM calls van a través del proxy LiteLLM centralizado. La virtual
# key se inyecta en runtime como OPENAI_API_KEY.
# ==============================================================================

FROM node:22-bookworm-slim

# Metadatos
LABEL org.opencontainers.image.title="hq-agent-orchestrator"
LABEL org.opencontainers.image.description="Persistent Goose-based orchestrator agent for HQ (Squad Lead, Auditor)"
LABEL org.opencontainers.image.source="https://github.com/ctangarife/hq"

# Dependencias del sistema:
# - ca-certificates: TLS para las llamadas a los providers
# - curl: descargar goose
# - bzip2: el tarball de goose viene en .tar.bz2
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    bzip2 \
    && rm -rf /var/lib/apt/lists/*

# Instalar Goose CLI (binario estático, desde releases oficiales de AAIF).
# Descargamos el tarball directo en vez del script oficial porque este último
# lanza `goose configure` interactivo (abre /dev/tty) que no funciona en build.
# docs: https://goose-docs.ai/docs/getting-started/installation/
ARG GOOSE_RELEASE=stable
RUN mkdir -p /tmp/goose-dl && \
    curl -fsSL -o /tmp/goose-dl/goose.tar.bz2 \
      "https://github.com/aaif-goose/goose/releases/download/${GOOSE_RELEASE}/goose-x86_64-unknown-linux-gnu.tar.bz2" && \
    tar -xjf /tmp/goose-dl/goose.tar.bz2 -C /tmp/goose-dl && \
    install -m 0755 /tmp/goose-dl/goose /usr/local/bin/goose && \
    rm -rf /tmp/goose-dl && \
    goose --version

# Directorio de configuración de Goose
# (XDG_CONFIG_HOME apunta aquí; goose lee ~/.config/goose/config.yaml)
ENV XDG_CONFIG_HOME=/config
RUN mkdir -p /config/goose

# Configuración de Goose: provider=openai apuntando a LiteLLM.
# La virtual key NO va aquí — se inyecta como OPENAI_API_KEY en runtime.
COPY config.yaml /config/goose/config.yaml

# Host del proxy LiteLLM (puede sobreescribirse en runtime si hace falta).
# IMPORTANTE: sin sufijo /v1 — Goose lo añade automáticamente al construir
# la URL (openai-host + /v1/chat/completions). Poner /v1 aquí causaría doble.
ENV OPENAI_HOST=https://litellm.ctangarife.com
ENV GOOSE_MODEL=glm-4.7

# Directorio de la app
WORKDIR /app

# Instalar dependencia del skill: node-fetch (HTTP client para API HQ).
# El skill es CommonJS (.cjs), por eso usamos npm y un package.json mínimo.
COPY package.json /app/package.json
RUN npm install --omit=dev && npm cache clean --force

# Copiar el polling skill + módulos refactorizados + entrypoint
COPY hq-polling-skill.cjs /app/hq-polling-skill.cjs
COPY lib/ /app/lib/
COPY handlers/ /app/handlers/
COPY entrypoint.sh /app/entrypoint.sh
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Workspace efímero (donde goose escribe si la tarea genera archivos)
RUN mkdir -p /workspace
WORKDIR /workspace

# El entrypoint arranca el polling skill como proceso principal.
# El skill vive indefinidamente (polling loop) y spawnea Goose por tarea.
ENTRYPOINT ["/app/entrypoint.sh"]
