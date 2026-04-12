#!/usr/bin/env bash
set -euo pipefail

# ── VPS Launchpad bootstrap.sh ───────────────────────────────────────────────
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/kevinCodeSavvy/vps-launchpad/main/bootstrap.sh | bash
#   ./bootstrap.sh --manage

IMAGE="ghcr.io/kevincodesavvy/vps-launchpad:latest"
MANAGE_MODE=false

for arg in "$@"; do
  [[ "$arg" == "--manage" ]] && MANAGE_MODE=true
done

# ── OS detection ──────────────────────────────────────────────────────────────

OS="$(uname -s)"
case "$OS" in
  Linux)
    if [[ "$(id -u)" -ne 0 ]]; then
      echo "Error: on Linux VPS, bootstrap.sh must be run as root (sudo)." >&2
      exit 1
    fi
    ;;
  Darwin)
    echo "Detected macOS — using Docker Desktop mode."
    ;;
  *)
    # WSL
    if grep -qi microsoft /proc/version 2>/dev/null; then
      echo "Detected WSL — using Docker Desktop (Windows) mode."
    else
      echo "Unsupported OS: $OS" >&2
      exit 1
    fi
    ;;
esac

# ── Docker check / install ────────────────────────────────────────────────────

if ! command -v docker &>/dev/null; then
  if [[ "$OS" == "Linux" ]]; then
    echo "Docker not found — installing via get.docker.com..."
    curl -fsSL https://get.docker.com | sh
  else
    echo "Error: Docker Desktop is not installed. Please install it from docker.com." >&2
    exit 1
  fi
fi

if ! docker info &>/dev/null; then
  echo "Error: Docker daemon is not running. Start Docker Desktop or the Docker service." >&2
  exit 1
fi

# ── Working directory ─────────────────────────────────────────────────────────

if [[ "$OS" == "Linux" ]]; then
  BASE_DIR="$HOME/.vps-launchpad"
elif [[ "$OS" == "Darwin" ]]; then
  BASE_DIR="$HOME/.vps-launchpad"
else
  # WSL — map to Windows-accessible path
  WIN_HOME="$(wslpath "$(cmd.exe /c echo %USERPROFILE% 2>/dev/null | tr -d '\r')")"
  BASE_DIR="${WIN_HOME}/.vps-launchpad"
fi

mkdir -p "$BASE_DIR"

# ── Session token ─────────────────────────────────────────────────────────────

TOKEN_FILE="$BASE_DIR/.session-token"

if [[ "$MANAGE_MODE" == "true" && -f "$TOKEN_FILE" ]]; then
  SESSION_TOKEN="$(cat "$TOKEN_FILE")"
else
  SESSION_TOKEN="$(openssl rand -hex 16)"
  echo "$SESSION_TOKEN" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi

# ── Stop any existing launchpad container ─────────────────────────────────────

docker rm -f vps-launchpad 2>/dev/null || true

# ── Pull and start launchpad container ───────────────────────────────────────

docker run -d \
  --name vps-launchpad \
  --label "com.centurylinklabs.watchtower.enable=false" \
  -p 8888:8888 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$BASE_DIR:/data" \
  -e SESSION_TOKEN="$SESSION_TOKEN" \
  -e BASE_DIR="/data" \
  -e REPO_ROOT="/app" \
  -e MANAGE_MODE="$MANAGE_MODE" \
  -e PORT=8888 \
  "$IMAGE"

# ── Print access URL ──────────────────────────────────────────────────────────

if [[ "$OS" == "Linux" ]]; then
  SERVER_IP="$(curl -s --connect-timeout 3 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
  ACCESS_URL="http://${SERVER_IP}:8888?token=${SESSION_TOKEN}"
else
  ACCESS_URL="http://localhost:8888?token=${SESSION_TOKEN}"
fi

BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
RESET='\033[0m'

echo ""
echo -e "  ${GREEN}${BOLD}✓ VPS Launchpad is running${RESET}"
echo ""
echo -e "  ${BOLD}Open in your browser:${RESET}"
echo -e "  ${CYAN}${BOLD}${ACCESS_URL}${RESET}"
echo ""
echo -e "  ${DIM}The wizard will close automatically after deployment.${RESET}"
echo -e "  ${DIM}To reopen: curl ... | bash -s -- --manage${RESET}"
echo ""
