# SearXNG

SearXNG is a privacy-respecting metasearch engine that aggregates results from multiple search engines without tracking users or storing search history.

## Role in the infrastructure

- **Private search** — Provides a self-hosted search interface accessible via Caddy, replacing reliance on Google, Bing, or other tracking-based search engines.
- **VPS** — Served at `https://search.<domain>` via Caddy with Cloudflare TLS.
- **Docker Desktop** — Served locally at `https://localhost:8080` via Caddy's internal TLS.

## Key files

| File | Purpose |
|------|---------|
| `docker-compose.yaml` | Defines the `searxng` service. Config directory is mounted from `~/.vps-launchpad/configs/searxng`. |
| `config/` | Static configuration files copied to `~/.vps-launchpad/configs/searxng` at deploy time by `generate-configs.js`. |
| `config/limiter.toml` | Rate limiting rules to prevent abuse of the public-facing instance. |
| `config/uwsgi.ini` | uWSGI server configuration for the SearXNG Python application. |

## Configuration

Environment is loaded from `~/.vps-launchpad/envs/searxng.env`, which contains:

| Variable | Description |
|----------|-------------|
| `SEARXNG_SECRET_KEY` | Cryptographic secret for session signing. Auto-generated at deploy time. |

The `config/` directory is mounted read-write so SearXNG can write a `settings.yml` on first run if one does not exist. The `settings.yml.example` in the config directory can be used as a starting point for customisation.
