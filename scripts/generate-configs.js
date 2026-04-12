'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Generate a cryptographically random secret using openssl.
 * @returns {string}
 */
function generateSecret() {
  return execSync('openssl rand -base64 36').toString().trim();
}

/**
 * Ensure all required secrets exist in state, generating any that are missing.
 * Returns a flat secrets object (does not mutate state).
 * @param {object} state - setup-state.json contents
 * @returns {object} secrets
 */
function ensureSecrets(state) {
  const existing = state.secrets || {};
  const secrets = { ...existing };

  const coreSecrets = ['SEARXNG_SECRET', 'MEILI_MASTER_KEY', 'NEXTAUTH_SECRET', 'KARAKEEP_POSTGRES_PASSWORD'];
  for (const key of coreSecrets) {
    if (!secrets[key]) secrets[key] = generateSecret();
  }

  if (state.modules && state.modules.paperclip) {
    if (!secrets.BETTER_AUTH_SECRET) secrets.BETTER_AUTH_SECRET = generateSecret();
  }

  return secrets;
}

/**
 * Write a key=value .env file.
 * @param {string} dir
 * @param {string} filename
 * @param {object} vars
 */
function writeEnv(dir, filename, vars) {
  const content = Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';
  fs.writeFileSync(path.join(dir, filename), content, 'utf8');
}

/**
 * Write per-service .env files to {baseDir}/envs/.
 * @param {object} state
 * @param {object} secrets
 * @param {string} baseDir - ~/.vps-launchpad/ path
 */
function writeEnvFiles(state, secrets, baseDir) {
  const envsDir = path.join(baseDir, 'envs');
  fs.mkdirSync(envsDir, { recursive: true });

  const isVps = state.env === 'vps';
  const domain = state.domain || 'localhost';

  // searxng.env
  writeEnv(envsDir, 'searxng.env', {
    SEARXNG_SECRET_KEY: secrets.SEARXNG_SECRET,
  });

  // karakeep.env
  const nextauthUrl = isVps
    ? `https://karakeep.${domain}`
    : 'http://localhost:3002';
  writeEnv(envsDir, 'karakeep.env', {
    MEILI_MASTER_KEY: secrets.MEILI_MASTER_KEY,
    NEXTAUTH_SECRET: secrets.NEXTAUTH_SECRET,
    NEXTAUTH_URL: nextauthUrl,
    POSTGRES_PASSWORD: secrets.KARAKEEP_POSTGRES_PASSWORD,
    DATABASE_URL: `postgresql://karakeep:${secrets.KARAKEEP_POSTGRES_PASSWORD}@karakeep-db:5432/karakeep`,
  });

  // caddy.env
  writeEnv(envsDir, 'caddy.env', {
    CLOUDFLARE_API_TOKEN: isVps ? (state.cloudflareToken || '') : '',
  });

  // tailscale.env
  writeEnv(envsDir, 'tailscale.env', {
    TS_AUTHKEY: state.tailscaleAuthKey || '',
    TS_USERSPACE: isVps ? 'false' : 'true',
  });

  // watchtower.env (always written — stub, no required vars)
  writeEnv(envsDir, 'watchtower.env', {});

  // monitoring.env (always written — stub, no required vars for grafana defaults)
  writeEnv(envsDir, 'monitoring.env', {});

  // n8n.env (optional)
  if (state.modules && state.modules.n8n) {
    const n8nEnv = state.moduleEnv && state.moduleEnv.n8n ? { ...state.moduleEnv.n8n } : {};
    n8nEnv.N8N_HOST = isVps ? `n8n.${domain}` : 'localhost';
    writeEnv(envsDir, 'n8n.env', n8nEnv);
  }

  // paperclip.env (optional)
  if (state.modules && state.modules.paperclip) {
    const pcEnv = state.moduleEnv && state.moduleEnv.paperclip ? { ...state.moduleEnv.paperclip } : {};
    pcEnv.BETTER_AUTH_SECRET = secrets.BETTER_AUTH_SECRET;
    writeEnv(envsDir, 'paperclip.env', pcEnv);
  }
}

/**
 * Render a Caddyfile from a template with {{#if KEY}}...{{/if KEY}} blocks
 * and {TOKEN} substitutions (uppercase tokens only, to avoid matching
 * Caddyfile directives like {env.CLOUDFLARE_API_TOKEN}).
 * @param {string} template - raw template text
 * @param {object} vars - { vps: bool, n8n: bool, DOMAIN: string, ... }
 * @returns {string}
 */
function renderCaddyfile(template, vars) {
  // Process conditional blocks: {{#if KEY}}...{{/if KEY}}
  let result = template.replace(
    /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if \1\}\}/g,
    (_, key, content) => (vars[key] ? content : '')
  );

  // Substitute {TOKEN} placeholders (uppercase letters and underscores only)
  result = result.replace(/\{([A-Z_]+)\}/g, (_, key) =>
    vars[key] !== undefined ? vars[key] : `{${key}}`
  );

  // Collapse multiple blank lines left by removed blocks
  result = result.replace(/\n{3,}/g, '\n\n').trim();

  return result;
}

/**
 * Copy static config files from the repo into baseDir/configs/ so that the
 * host Docker daemon can bind-mount them into service containers. Compose files
 * reference these paths via ${DATA_DIR}/configs/... where DATA_DIR is the real
 * host path (HOST_DATA_DIR, e.g. ~/.vps-launchpad).
 * @param {string} repoRoot
 * @param {string} baseDir
 */
function copyConfigFiles(repoRoot, baseDir) {
  const dst = path.join(baseDir, 'configs');

  // searxng — entire config directory
  const searxngDst = path.join(dst, 'searxng');
  fs.mkdirSync(searxngDst, { recursive: true });
  fs.cpSync(path.join(repoRoot, 'core', 'searxng', 'config'), searxngDst, { recursive: true });

  // monitoring — individual config files
  const monitoringDst = path.join(dst, 'monitoring');
  fs.mkdirSync(monitoringDst, { recursive: true });
  for (const f of ['prometheus.yml', 'loki-config.yaml', 'promtail-config.yaml']) {
    fs.copyFileSync(
      path.join(repoRoot, 'modules', 'monitoring', f),
      path.join(monitoringDst, f)
    );
  }

  // n8n — local_files is an empty writable directory used at runtime
  fs.mkdirSync(path.join(dst, 'n8n', 'local_files'), { recursive: true });
}

/**
 * Main entry point. Reads Caddyfile.template, generates secrets, writes all config files.
 * @param {object} state - setup-state.json contents
 * @param {string} baseDir - ~/.vps-launchpad/ working directory
 * @param {string} repoRoot - absolute path to the vps-launchpad repo root
 * @returns {{ secrets: object }}
 */
function generateConfigs(state, baseDir, repoRoot) {
  const secrets = ensureSecrets(state);

  // Write all .env files
  writeEnvFiles(state, secrets, baseDir);

  // Copy static config files so the host daemon can bind-mount them
  copyConfigFiles(repoRoot, baseDir);

  // Render and write Caddyfile
  const templatePath = path.join(repoRoot, 'core', 'caddy', 'Caddyfile.template');
  const template = fs.readFileSync(templatePath, 'utf8');
  const isVps = state.env === 'vps';
  const hasN8n = !!(state.modules && state.modules.n8n);
  const hasPaperclip = !!(state.modules && state.modules.paperclip);
  const hasMonitoring = !!(state.modules && state.modules.monitoring);
  const caddyVars = {
    vps: isVps,
    docker_desktop: !isVps,
    n8n_vps: isVps && hasN8n,
    n8n_docker_desktop: !isVps && hasN8n,
    paperclip_vps: isVps && hasPaperclip,
    paperclip_docker_desktop: !isVps && hasPaperclip,
    monitoring_vps: isVps && hasMonitoring,
    monitoring_docker_desktop: !isVps && hasMonitoring,
    DOMAIN: state.domain || 'localhost',
  };
  const caddyfile = renderCaddyfile(template, caddyVars);
  fs.writeFileSync(path.join(baseDir, 'Caddyfile'), caddyfile, 'utf8');

  return { secrets };
}

module.exports = { generateSecret, ensureSecrets, writeEnvFiles, renderCaddyfile, generateConfigs };
