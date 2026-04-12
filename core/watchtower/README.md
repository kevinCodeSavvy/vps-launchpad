# Watchtower

Watchtower automatically keeps all running containers up to date by polling their source registries for new image versions.

## Role in the infrastructure

- **Automatic updates** — Periodically checks Docker Hub, GHCR, and other registries for newer image digests. When a newer image is found, Watchtower pulls it, stops the old container, and starts a replacement with identical configuration.
- **Zero-touch maintenance** — Services like searxng, karakeep, n8n, paperclip, grafana, loki, and prometheus are updated automatically when their upstream projects publish new releases.
- **Self-exclusion** — Watchtower excludes itself from updates (via the `com.centurylinklabs.watchtower.enable=false` label on its own container) to avoid instability from self-updates.

## What gets updated

All containers are monitored by default. Individual services opt out by setting the label:

```yaml
labels:
  - "com.centurylinklabs.watchtower.enable=false"
```

Currently opted out:
- **caddy** — custom-built local image, no registry to poll
- **paperclip-db** — postgres major version upgrades require a manual data migration

## Configuration

Environment is loaded from `~/.vps-launchpad/envs/watchtower.env`. By default this file is empty, which means Watchtower uses its default poll interval of **24 hours**.

To customise, add variables to the env file via `generate-configs.js`:

| Variable | Description | Default |
|----------|-------------|---------|
| `WATCHTOWER_POLL_INTERVAL` | Seconds between update checks | `86400` (24h) |
| `WATCHTOWER_CLEANUP` | Remove old images after update | `false` |
| `WATCHTOWER_NOTIFICATIONS` | Notification backend (slack, email, etc.) | unset |
