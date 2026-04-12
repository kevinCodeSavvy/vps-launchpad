# Caddy

Caddy is the reverse proxy and TLS termination layer for the entire stack. All HTTP/HTTPS traffic enters through Caddy before being routed to the appropriate service.

## Role in the infrastructure

- **Network gateway** — Caddy creates and owns the `caddy_default` Docker bridge network. Every other service joins this network as an external network, so Caddy must be deployed first.
- **TLS termination** — On VPS, Caddy obtains and renews certificates automatically via the ACME DNS-01 challenge using the Cloudflare API. On Docker Desktop, it uses its built-in internal CA (`tls internal`) for local HTTPS.
- **Reverse proxy** — Routes subdomains (VPS) or local ports (Docker Desktop) to the correct backend container by name on the `caddy_default` network.

## Key files

| File | Purpose |
|------|---------|
| `Dockerfile` | Builds a custom Caddy binary with the `caddy-dns/cloudflare` plugin using `xcaddy`. Required for the Cloudflare DNS-01 challenge. |
| `Caddyfile.template` | Template rendered at deploy time by `generate-configs.js`. Produces the `Caddyfile` written to `~/.vps-launchpad/Caddyfile`. |
| `docker-compose.yaml` | Defines the `caddy` service and creates the `caddy_default` network. |

## Configuration

The rendered `Caddyfile` is bind-mounted from `~/.vps-launchpad/Caddyfile` (host path, passed via `DATA_DIR`). Environment is loaded from `~/.vps-launchpad/envs/caddy.env`, which contains `CLOUDFLARE_API_TOKEN`.

## Why Watchtower is disabled

Caddy is built locally from a custom Dockerfile (xcaddy + Cloudflare plugin). There is no pre-built registry image to compare against, so Watchtower is opted out via the `com.centurylinklabs.watchtower.enable=false` label.
