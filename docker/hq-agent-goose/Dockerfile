# ==============================================================================
# HQ Agent - Goose Runtime
# ==============================================================================
# Container efímero para tareas especializadas (researcher, writer, developer,
# analyst). Cada container ejecuta UNA tarea via `goose run --headless` y muere.
#
# Patrón: levantar → ejecutar → apagar (sin estado, sin polling, sin daemon).
#
# Providers configurados:
#   - Z.ai (anthropic-compatible) → glm-4.7
#   - LiteLLM proxy (openai-compatible) → cualquier modelo del proxy central
#   - Anthropic nativo (opcional)
# ==============================================================================

FROM debian:bookworm-slim

# Metadatos
LABEL org.opencontainers.image.title="hq-agent-goose"
LABEL org.opencontainers.image.description="Ephemeral Goose-based task runner for HQ"
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

# Configuración de providers (sin API keys — se inyectan por ENV en runtime)
# Z.ai es anthropic-compatible; el polling skill actual ya lo usa así.
COPY config.yaml /config/goose/config.yaml

# Workspace efímero (donde goose escribe si la tarea genera archivos)
RUN mkdir -p /workspace
WORKDIR /workspace

# Punto de entrada: goose run en modo no-interactivo.
# Goose 1.x: `run` es no-interactivo por defecto cuando se pasa -t/--text y no
# hay TTY. -q/--quiet hace que stdout tenga SOLO la respuesta del modelo
# (sin logs de tool calls), lo que permite capturar el output limpio.
# --no-session evita persistir sesión (container efímero, una sola tarea).
# Los argumentos reales (-t "prompt", --profile, etc.) los pasa la API de HQ.
ENTRYPOINT ["goose", "run", "--quiet", "--no-session", "--output-format", "text"]
