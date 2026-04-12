FROM caddy:2-builder AS builder
RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=5 \
  CMD wget -qO- http://localhost:2019/config/ >/dev/null 2>&1 || exit 1
