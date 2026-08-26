# ==============================================================================
# HQ Agent - Goose Runtime (via LiteLLM proxy)
# ==============================================================================
# Container efímero para tareas especializadas (researcher, writer, developer,
# analyst). Cada container ejecuta UNA tarea via `goose run` y muere.
#
# Patrón: levantar → ejecutar → apagar (sin estado, sin polling, sin daemon).
#
# Todos los LLM calls van a través del proxy LiteLLM centralizado
# (litellm.ctangarife.com) con budget tracking, rate limiting y fallback.
# La virtual key se inyecta en runtime como OPENAI_API_KEY.
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

# Configuración de Goose: provider=openai apuntando a LiteLLM.
# La virtual key NO va aquí — se inyecta como OPENAI_API_KEY en runtime.
COPY config.yaml /config/goose/config.yaml

# Host del proxy LiteLLM (puede sobreescribirse en runtime si hace falta).
# IMPORTANTE: sin sufijo /v1 — Goose lo añade automáticamente al construir
# la URL (openai-host + /v1/chat/completions). Poner /v1 aquí causaría doble.
ENV OPENAI_HOST=https://litellm.ctangarife.com
ENV GOOSE_MODEL=glm-4.7

# Desactivar las developer/file tools de Goose (write/edit/todo):
# el efímero debe responder SOLO con texto. Con tools activas, el modelo
# "planifica" y escribe archivos — el stdout captura el proceso en vez del
# entregable (validado empíricamente: con GOOSE_FILE=false el output es el
# contenido limpio).
ENV GOOSE_FILE=false

# Desactivar también la SHELL tool: kimi-k3 la usaba para contar caracteres
# del copy (python3/wc) y el proceso de bash contaminaba el output. Validado
# en misión Club Estantería: "Posts de Instagram" llegó con bloques de
# command/EOF mezclados con el entregable.
ENV GOOSE_SHELL=false

# Workspace efímero (donde goose escribe si la tarea genera archivos)
RUN mkdir -p /workspace
WORKDIR /workspace

# Punto de entrada: goose run no-interactivo, prompt por STDIN.
#
# Pasamos el prompt por STDIN (-i -) porque es la forma validada que da
# output limpio con el provider openai-compatible (LiteLLM). La API de HQ
# hace: docker run -i hq-agent-goose < prompt.txt
#
# --no-session: container efímero, una sola tarea, sin persistir sesión.
# --output-format text: stdout = texto plano de la respuesta del modelo.
ENTRYPOINT ["goose", "run", "--no-session", "--output-format", "text", "-i", "-"]
