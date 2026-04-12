FROM node:22-alpine AS builder

# Build tools needed to compile node-pty native bindings
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY launchpad/package.json launchpad/package-lock.json ./launchpad/
RUN npm ci --prefix ./launchpad

# ── Runtime image ──────────────────────────────────────────────────────────────
FROM node:22-alpine

# docker CLI for compose commands; libstdc++ needed by node-pty native binary
RUN apk add --no-cache docker-cli docker-compose openssl curl libstdc++

# Mirror the repo layout so require('../scripts/...') works from launchpad/server.js
WORKDIR /app

# Copy compiled node_modules from builder (includes node-pty native .node file)
COPY --from=builder /app/launchpad/node_modules ./launchpad/node_modules

# Copy server and public files
COPY launchpad/server.js ./launchpad/
COPY launchpad/public/ ./launchpad/public/

# Copy scripts (generate-configs.js, deploy.js)
# Build context must be repo root: docker build -f launchpad/Dockerfile .
COPY scripts/ ./scripts/

# Copy service configs — needed at deploy time via REPO_ROOT=/app
COPY core/ ./core/
COPY modules/ ./modules/

EXPOSE 8888

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s \
  CMD wget -qO- http://localhost:8888/health || exit 1

WORKDIR /app/launchpad
CMD ["node", "server.js"]
