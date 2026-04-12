# cAdvisor

cAdvisor (Container Advisor) collects real-time resource usage and performance metrics for all running Docker containers.

## Role in the infrastructure

- **Container metrics source** — Exposes per-container CPU, memory, network, and disk I/O metrics that Prometheus (in the monitoring module) scrapes and stores.
- **Host metrics** — Also exposes host-level metrics by mounting the root filesystem, `/sys`, and the Docker socket read-only.

## Key files

| File | Purpose |
|------|---------|
| `docker-compose.yaml` | Defines the `cadvisor` service with privileged access to host resources. |

## Exposed port

cAdvisor exposes its metrics endpoint at **port 8080** on the host. This is consumed by Prometheus if the monitoring module is enabled.

## Privileges

cAdvisor requires elevated access to collect accurate metrics:

| Mount | Purpose |
|-------|---------|
| `/:/rootfs:ro` | Host root filesystem (for disk usage stats) |
| `/var/run:ro` | Docker socket access |
| `/sys:ro` | Kernel sysfs (for CPU and memory cgroup data) |
| `/var/lib/docker:ro` | Docker internals (for image and layer stats) |
| `/dev/disk:ro` | Block device statistics |
| `/dev/kmsg` | Kernel message buffer |

The `privileged: true` flag is required for cAdvisor to read cgroup data correctly on Linux hosts. On Docker Desktop (macOS/Windows), some metrics may be unavailable due to the Linux VM layer.
