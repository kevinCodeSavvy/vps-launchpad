# VPS Launchpad

One-command setup for a self-hosted VPS platform. Deploys n8n, Paperclip AI agents,
Grafana monitoring, SearXNG private search, and Karakeep — all configured through a
browser-based wizard.

## Quick Start

### VPS (run as root)
```bash
curl -fsSL https://raw.githubusercontent.com/kevinCodeSavvy/vps-launchpad/main/bootstrap.sh | bash
```

### Docker Desktop (Mac/Windows)
```bash
curl -fsSL https://raw.githubusercontent.com/kevinCodeSavvy/vps-launchpad/main/bootstrap.sh | bash
```

Then open the URL shown in your terminal to complete setup.

### Add or remove modules later
```bash
./bootstrap.sh --manage
```

## What gets deployed

### Core (always)
| Service | Purpose |
|---|---|
| Caddy | Reverse proxy + automatic SSL via Cloudflare |
| Watchtower | Auto-updates all containers nightly |
| Tailscale | Secure mesh VPN for private service access |
| SearXNG | Private self-hosted search engine |
| Karakeep | Bookmark and read-later manager |
| cAdvisor | Container resource monitoring |

### Optional modules
| Module | Services |
|---|---|
| n8n | Workflow automation (runs inside Tailscale) |
| Paperclip | AI agent platform + Postgres |
| Monitoring | Grafana, Loki, Prometheus, node-exporter, Pushgateway |

## Prerequisites
- A domain name you control
- Cloudflare account managing your domain's DNS
- Tailscale account
- VPS running Ubuntu 20.04+ with Docker, OR Docker Desktop on Mac/Windows

## Custom modules
Drop a folder with `module.yaml` + `docker-compose.yaml` into `modules/` and
re-run `./bootstrap.sh --manage` — it will appear automatically in the wizard.
See `modules/n8n/module.yaml` for the spec format.

## Security note
The setup wizard runs on port 8888 with a one-time session token shown in your terminal.
The token expires after 30 minutes of inactivity. The wizard container self-destructs
after successful deployment.
