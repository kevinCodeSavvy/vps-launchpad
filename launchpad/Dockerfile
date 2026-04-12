FROM node:22-alpine

# Install docker CLI (for docker compose commands inside the container)
RUN apk add --no-cache docker-cli docker-compose openssl curl

WORKDIR /app

# Copy package files and install production deps only
COPY launchpad/package.json launchpad/package-lock.json ./
RUN npm ci --omit=dev

# Copy server and public files
COPY launchpad/server.js ./
COPY launchpad/public/ ./public/

# Copy scripts (generate-configs.js, deploy.js)
# Build context must be repo root: docker build -f launchpad/Dockerfile .
COPY scripts/ ./scripts/

# Non-root user for defense in depth (docker.sock access is still host-equivalent
# per design spec — mitigated by auto-destroy and token gating)
RUN addgroup -S launchpad && adduser -S launchpad -G launchpad
USER launchpad

EXPOSE 8888

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s \
  CMD wget -qO- http://localhost:8888/health || exit 1

CMD ["node", "server.js"]
