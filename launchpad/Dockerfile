FROM node:22-alpine

# Install docker CLI (for docker compose commands inside the container)
RUN apk add --no-cache docker-cli docker-compose openssl curl

# Mirror the repo layout so require('../scripts/...') works from launchpad/server.js
WORKDIR /app

# Copy package files and install production deps only
COPY launchpad/package.json launchpad/package-lock.json ./launchpad/
RUN npm ci --omit=dev --prefix ./launchpad

# Copy server and public files
COPY launchpad/server.js ./launchpad/
COPY launchpad/public/ ./launchpad/public/

# Copy scripts (generate-configs.js, deploy.js)
# Build context must be repo root: docker build -f launchpad/Dockerfile .
COPY scripts/ ./scripts/

EXPOSE 8888

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s \
  CMD wget -qO- http://localhost:8888/health || exit 1

WORKDIR /app/launchpad
CMD ["node", "server.js"]
