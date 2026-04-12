# Tailscale

Tailscale provides a private WireGuard mesh network (Tailnet) that allows secure access to services without exposing ports to the public internet.

## Role in the infrastructure

- **Private network access** — Connects the server to your Tailnet so you can reach services from any device on your Tailscale account, regardless of where the server is hosted.
- **Userspace mode (Docker Desktop)** — On Docker Desktop, Tailscale runs in userspace mode (`TS_USERSPACE=true`) which does not require the `/dev/net/tun` kernel device.
- **Kernel mode (VPS)** — On a Linux VPS, Tailscale runs in kernel mode (`TS_USERSPACE=false`) for better performance, requiring `NET_ADMIN` capability and the `/dev/net/tun` device.

## Key files

| File | Purpose |
|------|---------|
| `docker-compose.yaml` | Defines the `tailscale` service. Auth key and userspace mode are loaded from `tailscale.env`. |

## Configuration

Environment is loaded from `~/.vps-launchpad/envs/tailscale.env`, which contains:

| Variable | Description |
|----------|-------------|
| `TS_AUTHKEY` | Tailscale auth key used to authenticate the node into your Tailnet |
| `TS_USERSPACE` | `true` on Docker Desktop, `false` on VPS |

Tailscale state (node identity, certificates) is persisted in the `tailscale-state` named volume so the node does not need to re-authenticate on container restarts.
