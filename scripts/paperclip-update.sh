#!/usr/bin/env bash
# Updates Paperclip to the latest release and re-applies the quota fix.
# Run this from the vps-launchpad root directory.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$SCRIPT_DIR/../modules/paperclip/paperclip"
COMPOSE_DIR="$SCRIPT_DIR/../modules/paperclip"
LOG_FILE="$SCRIPT_DIR/../modules/paperclip/update.log"
VERSION_FILE="$SCRIPT_DIR/../modules/paperclip/.last_version"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# Fetch latest release tag
LATEST_TAG=$(curl -sf https://api.github.com/repos/paperclipai/paperclip/releases/latest \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['tag_name'])")

if [ -z "$LATEST_TAG" ]; then
  log "ERROR: Could not fetch latest release tag from GitHub"
  exit 1
fi

CURRENT_TAG="$(cat "$VERSION_FILE" 2>/dev/null || echo 'none')"
log "Current: $CURRENT_TAG | Latest: $LATEST_TAG"

if [ "$CURRENT_TAG" = "$LATEST_TAG" ]; then
  log "Already up to date ($LATEST_TAG). Nothing to do."
  exit 0
fi

log "New release found: $LATEST_TAG. Updating..."

cd "$REPO_DIR"
git fetch --tags --force
git checkout "$LATEST_TAG"

log "Applying quota fix to $LATEST_TAG..."

python3 -c "
with open('packages/adapters/claude-local/src/server/quota.ts','r') as f:
    content = f.read()

target = 'return Math.min(100, Math.round(utilization * 100));'
if target not in content:
    print('ERROR: quota.ts structure has changed — patch cannot be applied safely')
    print('Manual intervention required. The fix may already be merged upstream.')
    exit(1)

content = content.replace(
    'return Math.min(100, Math.round(utilization * 100));',
    'return Math.min(100, Math.round(utilization));'
)

with open('packages/adapters/claude-local/src/server/quota.ts','w') as f:
    f.write(content)

print('quota fix applied successfully')
"

log "Rebuilding Docker images..."
cd "$COMPOSE_DIR"
docker compose --profile build-only build --no-cache paperclip-base
docker compose build --no-cache paperclip

log "Restarting containers..."
docker compose down
docker compose up -d
docker image prune -f

echo "$LATEST_TAG" > "$VERSION_FILE"
log "Update complete. Now running $LATEST_TAG"
