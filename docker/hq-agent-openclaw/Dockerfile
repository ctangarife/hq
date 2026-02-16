# HQ Agent - OpenClaw-based image
# Based on molbot's OpenClaw integration

# -----------------------------------------------------------------------------
# Stage 1: clone and build OpenClaw
# -----------------------------------------------------------------------------
FROM node:22-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /src

ARG OPENCLAW_REPO=https://github.com/openclaw/openclaw.git
ARG OPENCLAW_REF=main
RUN git clone --depth 1 --branch "${OPENCLAW_REF}" "${OPENCLAW_REPO}" .

RUN pnpm install --frozen-lockfile
RUN OPENCLAW_A2UI_SKIP_MISSING=1 pnpm build
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

# -----------------------------------------------------------------------------
# Stage 2: runtime image
# -----------------------------------------------------------------------------
FROM node:22-bookworm

COPY --from=builder --chown=node:node /src /app
WORKDIR /app

# Copy HQ-specific scripts
COPY --chown=node:node entrypoint.sh /app/entrypoint.sh
COPY --chown=node:node sync-auth-profiles.cjs /app/sync-auth-profiles.cjs
COPY --chown=node:node generate-env-from-mongo.cjs /app/generate-env-from-mongo.cjs
COPY --chown=node:node hq-polling-skill.cjs /app/hq-polling-skill.cjs
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Install mongoose and node-fetch for MongoDB sync
RUN corepack enable && pnpm add -w mongoose@^8.0.3 node-fetch@^2.7.0

# Install gosu for user switching
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/*

# Create alias
RUN echo '#!/bin/sh\nexec node /app/dist/index.js "$@"' > /usr/local/bin/openclaw && \
    chmod +x /usr/local/bin/openclaw

ENV NODE_ENV=production

ENTRYPOINT ["/app/entrypoint.sh"]
