# Contributing to VPS Launchpad

Thank you for your interest in contributing! This document covers how to report issues, propose changes, and get your pull request merged.

---

## Reporting issues

Use the [issue templates](.github/ISSUE_TEMPLATE/) — they guide you through the information needed to reproduce and fix a problem quickly.

- **Bug?** → Bug report template
- **New idea?** → Feature request template
- **Question?** → [Discussions](https://github.com/kevinCodeSavvy/vps-launchpad/discussions)

Please search existing issues before opening a new one.

---

## Development setup

**Requirements:** Node.js 22+, Docker, npm.

```bash
# Clone
git clone https://github.com/kevinCodeSavvy/vps-launchpad.git
cd vps-launchpad

# Install launchpad dependencies
cd launchpad && npm install && cd ..

# Run tests
cd launchpad && npm test

# Validate all compose files
for dir in core/caddy core/watchtower core/tailscale core/searxng core/karakeep core/cadvisor modules/n8n modules/paperclip modules/monitoring; do
  cp $dir/example.env $dir/.env 2>/dev/null || touch $dir/.env
  docker compose -f $dir/docker-compose.yaml config --quiet && echo "$dir ✓"
done

# Build the launchpad Docker image (from repo root)
docker build -f launchpad/Dockerfile -t vps-launchpad-dev .
```

---

## Making changes

### Branches

Create a branch from `main`:

```bash
git checkout -b fix/describe-the-fix
# or
git checkout -b feat/describe-the-feature
```

Branch naming conventions:

| Prefix | Use for |
|---|---|
| `fix/` | Bug fixes |
| `feat/` | New features |
| `chore/` | Maintenance, dependency updates, CI |
| `docs/` | Documentation only |

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add monitoring module install flow
fix: karakeep NEXTAUTH_URL incorrect for Docker Desktop
chore: update node to 22.15
docs: add Tailscale key guide to README
```

### Tests

- Add or update tests in `tests/` for any logic change in `scripts/`
- Add or update tests in `tests/server.test.js` for any server route change
- All tests must pass: `cd launchpad && npm test`

### Compose file changes

If you modify any `docker-compose.yaml`, validate it with:

```bash
docker compose -f <path>/docker-compose.yaml config --quiet
```

---

## Submitting a pull request

1. Push your branch and open a PR against `main`
2. Fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md) — every section matters
3. CI runs automatically: tests, Dockerfile build, and compose validation
4. Address all review comments before requesting a re-review

PRs that skip the template, break tests, or lack sufficient context will be returned for revision.

---

## Adding a new module

Modules live in `modules/<name>/` and are auto-discovered by the wizard if they contain a `module.yaml`. See the [existing modules](modules/) for examples and the [design spec](docs/superpowers/specs/2026-04-12-vps-launchpad-design.md) for the `module.yaml` schema.

A new module PR must include:

- `modules/<name>/module.yaml`
- `modules/<name>/docker-compose.yaml`
- `modules/<name>/example.env` (if the service needs env vars)
- A passing compose validation (`docker compose config --quiet`)

---

## Release process

Releases are cut by the maintainer. If you think a fix or feature is ready to ship, leave a comment on the PR or open a Discussion.

**How it works:**

1. Merged PRs to `main` auto-publish a `:edge` Docker image to GHCR (for testing)
2. When ready, the maintainer creates a `v*.*.*` git tag:
   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```
3. The release workflow builds the Docker image, pushes `:v1.2.0` and `:latest` to GHCR, and creates a GitHub Release with auto-generated notes

**Versioning:** [Semantic Versioning](https://semver.org/) — `MAJOR.MINOR.PATCH`.

- `PATCH` — bug fixes, no new behaviour
- `MINOR` — new features, backwards compatible
- `MAJOR` — breaking changes (e.g. incompatible state format, removed config keys)

---

## Code of conduct

Be respectful. Assume good faith. Focus feedback on code, not people.
