'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Core service startup sequence (always deployed, in order).
 */
const CORE_SERVICES = [
  { services: ['caddy'],     parallel: false, composeDir: 'core/caddy' },
  { services: ['tailscale'], parallel: false, composeDir: 'core/tailscale' },
  { services: ['watchtower'], parallel: false, composeDir: 'core/watchtower' },
  { services: ['searxng'],   parallel: false, composeDir: 'core/searxng' },
  { services: ['karakeep'],  parallel: false, composeDir: 'core/karakeep' },
  { services: ['cadvisor'],  parallel: false, composeDir: 'core/cadvisor' },
];

/**
 * Health check table keyed by service name.
 */
const HEALTH_CHECKS = {
  caddy:          { type: 'docker', timeout: 60 },
  tailscale:      { type: 'exec', cmd: ['tailscale', 'status'], timeout: 30 },
  'paperclip-db': { type: 'exec', cmd: ['pg_isready', '-U', 'paperclip', '-d', 'paperclip'], timeout: 30 },
  paperclip:      { type: 'http', url: 'http://paperclip:3100/api/health', timeout: 60 },
  n8n:            { type: 'http', url: 'http://localhost:5678/healthz', timeout: 60 },
  grafana:        { type: 'http', url: 'http://grafana:3001/api/health', timeout: 60 },
  loki:           { type: 'http', url: 'http://loki:3100/ready', timeout: 30 },
};

/**
 * Build an ordered deployment plan based on selected modules.
 * @param {object} state
 * @returns {Array<{ services: string[], parallel: boolean, composeDir: string }>}
 */
function buildDeployPlan(state) {
  const plan = [...CORE_SERVICES];
  const mods = state.modules || {};

  if (mods.paperclip) {
    plan.push({ services: ['paperclip-db'], parallel: false, composeDir: 'modules/paperclip' });
    plan.push({ services: ['paperclip'],    parallel: false, composeDir: 'modules/paperclip' });
  }

  if (mods.n8n) {
    plan.push({ services: ['tailscale-n8n'], parallel: false, composeDir: 'modules/n8n' });
    plan.push({ services: ['n8n'],           parallel: false, composeDir: 'modules/n8n' });
  }

  if (mods.monitoring) {
    plan.push({ services: ['prometheus'], parallel: false, composeDir: 'modules/monitoring' });
    plan.push({ services: ['loki'],       parallel: false, composeDir: 'modules/monitoring' });
    plan.push({
      services: ['promtail', 'grafana', 'node-exporter', 'pushgateway'],
      parallel: true,
      composeDir: 'modules/monitoring',
    });
  }

  return plan;
}

/**
 * Poll a service health check until healthy or timeout.
 * @param {string} service - service name (for logging)
 * @param {object} check - { type, url?, cmd?, timeout }
 * @returns {Promise<true>} resolves when healthy
 * @throws {Error} if timeout exceeded
 */
function pollHealthCheck(service, check) {
  const { type, timeout } = check;
  const deadline = Date.now() + timeout * 1000;
  const interval = 2000;

  // 'running' fallback: just resolve immediately (container is already up)
  if (type === 'running') return Promise.resolve(true);

  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() > deadline) {
        return reject(new Error(`Health check timed out for ${service} after ${timeout}s`));
      }

      let ok = false;
      try {
        if (type === 'docker') {
          const out = execSync(
            `docker inspect --format='{{.State.Health.Status}}' ${service}`,
            { stdio: 'pipe' }
          ).toString().trim().replace(/'/g, '');
          ok = out === 'healthy';
        } else if (type === 'exec') {
          const result = spawnSync('docker', ['exec', service, ...check.cmd], { stdio: 'pipe' });
          ok = result.status === 0;
        } else if (type === 'http') {
          ok = httpGet(check.url);
        }
      } catch (_) {
        ok = false;
      }

      if (ok) return resolve(true);
      setTimeout(attempt, interval);
    };
    attempt();
  });
}

/**
 * Synchronous HTTP GET — returns true if status 200.
 * Uses node's built-in http/https via a child process. Max wait: 3 seconds.
 * @param {string} url
 * @returns {boolean}
 */
function httpGet(url) {
  try {
    const result = spawnSync('node', [
      '-e',
      `const m=require('${url.startsWith('https') ? 'https' : 'http'}');` +
      `m.get('${url}',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1));`,
    ], { timeout: 3000, stdio: 'pipe' });
    return result.status === 0;
  } catch (_) {
    return false;
  }
}

/**
 * Deploy the full stack. Streams events via emit callback.
 * @param {object} state - setup-state.json
 * @param {string} baseDir - ~/.vps-launchpad/
 * @param {string} repoRoot - repo root
 * @param {function} emit - SSE event callback: emit({ type, service?, message?, module?, services? })
 */
async function deployStack(state, baseDir, repoRoot, emit) {
  const plan = buildDeployPlan(state);
  const startedDirs = [];
  const isTestMode = !!state._testMode;

  // Create shared Docker network
  if (!isTestMode) {
    try {
      execSync('docker network create caddy_default 2>/dev/null || true', { stdio: 'pipe' });
    } catch (_) {}
  }

  for (const group of plan) {
    const { services, parallel, composeDir } = group;
    const absComposeDir = path.join(repoRoot, composeDir);
    const isCore = CORE_SERVICES.some(g => g.composeDir === composeDir);

    // Announce starting
    for (const svc of services) {
      emit({ type: 'progress', service: svc, status: 'starting' });
    }

    // Test mode: simulate failure or success without touching Docker
    if (isTestMode) {
      if (state._testFailGroups && state._testFailGroups.includes(composeDir)) {
        const msg = `Simulated failure for ${composeDir} (test mode)`;
        emit({ type: 'error', service: services[0], message: msg });
        if (isCore) {
          teardownAll(startedDirs);
          throw new Error(`Core service failed: ${services[0]}\n${msg}`);
        } else {
          emit({ type: 'module-failed', module: composeDir });
          continue;
        }
      }
      for (const svc of services) {
        emit({ type: 'progress', service: svc, status: 'healthy' });
      }
      continue;
    }

    // Real mode: bring up containers
    try {
      execSync(
        `docker compose --project-directory ${absComposeDir} up -d ${services.join(' ')}`,
        { stdio: 'pipe', env: { ...process.env, ENV_DIR: path.join(baseDir, 'envs') } }
      );
    } catch (err) {
      const msg = err.stderr ? err.stderr.toString() : err.message;
      emit({ type: 'error', service: services[0], message: msg });
      if (isCore) {
        teardownAll(startedDirs);
        throw new Error(`Core service failed: ${services[0]}\n${msg}`);
      } else {
        teardownModule(absComposeDir);
        emit({ type: 'module-failed', module: composeDir });
        continue;
      }
    }
    startedDirs.push({ dir: absComposeDir, isCore });

    // Health check
    if (!parallel) {
      for (const svc of services) {
        const check = HEALTH_CHECKS[svc] || { type: 'running', timeout: 30 };
        try {
          await pollHealthCheck(svc, check);
          emit({ type: 'progress', service: svc, status: 'healthy' });
        } catch (err) {
          emit({ type: 'error', service: svc, message: err.message });
          if (isCore) {
            teardownAll(startedDirs);
            throw err;
          } else {
            teardownModule(absComposeDir);
            emit({ type: 'module-failed', module: composeDir });
            break;
          }
        }
      }
    } else {
      const results = await Promise.allSettled(
        services.map(svc => {
          const check = HEALTH_CHECKS[svc] || { type: 'running', timeout: 30 };
          return pollHealthCheck(svc, check).then(() => {
            emit({ type: 'progress', service: svc, status: 'healthy' });
          });
        })
      );
      let parallelModuleFailed = false;
      for (let i = 0; i < services.length; i++) {
        if (results[i].status === 'rejected') {
          emit({ type: 'error', service: services[i], message: results[i].reason.message });
          if (isCore) {
            teardownAll(startedDirs);
            throw results[i].reason;
          } else {
            parallelModuleFailed = true;
          }
        }
      }
      if (parallelModuleFailed) {
        teardownModule(absComposeDir);
        emit({ type: 'module-failed', module: composeDir });
      }
    }
  }

  const allServices = plan.map(g => g.services).flat();
  emit({ type: 'done', services: allServices });
}

function teardownAll(startedDirs) {
  for (const { dir } of [...startedDirs].reverse()) {
    try {
      execSync(`docker compose --project-directory ${dir} down`, { stdio: 'pipe' });
    } catch (_) {}
  }
}

function teardownModule(composeDir) {
  try {
    execSync(`docker compose --project-directory ${composeDir} down`, { stdio: 'pipe' });
  } catch (_) {}
}

module.exports = {
  buildDeployPlan,
  CORE_SERVICES,
  HEALTH_CHECKS,
  pollHealthCheck,
  deployStack,
};
