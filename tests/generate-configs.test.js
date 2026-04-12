'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const { generateSecret, ensureSecrets } = require('../scripts/generate-configs');

describe('secret generation', () => {
  test('generateSecret returns a non-empty string', () => {
    const s = generateSecret();
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(20);
  });

  test('ensureSecrets fills missing keys', () => {
    const state = { modules: { paperclip: true } };
    const secrets = ensureSecrets(state);
    expect(secrets).toHaveProperty('SEARXNG_SECRET');
    expect(secrets).toHaveProperty('MEILI_MASTER_KEY');
    expect(secrets).toHaveProperty('NEXTAUTH_SECRET');
    expect(secrets).toHaveProperty('KARAKEEP_POSTGRES_PASSWORD');
    expect(secrets).toHaveProperty('BETTER_AUTH_SECRET');
  });

  test('ensureSecrets skips BETTER_AUTH_SECRET when paperclip not selected', () => {
    const state = { modules: { paperclip: false } };
    const secrets = ensureSecrets(state);
    expect(secrets).not.toHaveProperty('BETTER_AUTH_SECRET');
  });

  test('ensureSecrets preserves existing secret values', () => {
    const state = { modules: {}, secrets: { SEARXNG_SECRET: 'existing-value' } };
    const secrets = ensureSecrets(state);
    expect(secrets.SEARXNG_SECRET).toBe('existing-value');
  });
});

const { writeEnvFiles } = require('../scripts/generate-configs');

describe('writeEnvFiles', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'launchpad-test-'));
    fs.mkdirSync(path.join(tmpDir, 'envs'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('writes searxng.env with SEARXNG_SECRET_KEY', () => {
    const state = { env: 'vps', domain: 'example.com', modules: {}, moduleEnv: {} };
    const secrets = { SEARXNG_SECRET: 'test-secret', MEILI_MASTER_KEY: 'mk', NEXTAUTH_SECRET: 'ns', KARAKEEP_POSTGRES_PASSWORD: 'kpp' };
    writeEnvFiles(state, secrets, tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, 'envs', 'searxng.env'), 'utf8');
    expect(content).toContain('SEARXNG_SECRET_KEY=test-secret');
  });

  test('writes karakeep.env with NEXTAUTH_URL for VPS', () => {
    const state = { env: 'vps', domain: 'example.com', modules: {}, moduleEnv: {} };
    const secrets = { SEARXNG_SECRET: 's', MEILI_MASTER_KEY: 'mk', NEXTAUTH_SECRET: 'ns', KARAKEEP_POSTGRES_PASSWORD: 'kpp' };
    writeEnvFiles(state, secrets, tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, 'envs', 'karakeep.env'), 'utf8');
    expect(content).toContain('NEXTAUTH_URL=https://karakeep.example.com');
  });

  test('writes karakeep.env with localhost NEXTAUTH_URL for Docker Desktop', () => {
    const state = { env: 'docker-desktop', domain: '', modules: {}, moduleEnv: {} };
    const secrets = { SEARXNG_SECRET: 's', MEILI_MASTER_KEY: 'mk', NEXTAUTH_SECRET: 'ns', KARAKEEP_POSTGRES_PASSWORD: 'kpp' };
    writeEnvFiles(state, secrets, tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, 'envs', 'karakeep.env'), 'utf8');
    expect(content).toContain('NEXTAUTH_URL=http://localhost:3002');
  });

  test('writes tailscale.env with TS_USERSPACE=true for Docker Desktop', () => {
    const state = { env: 'docker-desktop', domain: '', modules: {}, moduleEnv: {} };
    const secrets = { SEARXNG_SECRET: 's', MEILI_MASTER_KEY: 'mk', NEXTAUTH_SECRET: 'ns', KARAKEEP_POSTGRES_PASSWORD: 'kpp' };
    writeEnvFiles(state, secrets, tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, 'envs', 'tailscale.env'), 'utf8');
    expect(content).toContain('TS_USERSPACE=true');
  });

  test('writes n8n.env only when n8n module selected', () => {
    const state = { env: 'vps', domain: 'example.com', modules: { n8n: true }, moduleEnv: { n8n: { N8N_ENCRYPTION_KEY: 'enc' } } };
    const secrets = { SEARXNG_SECRET: 's', MEILI_MASTER_KEY: 'mk', NEXTAUTH_SECRET: 'ns', KARAKEEP_POSTGRES_PASSWORD: 'kpp' };
    writeEnvFiles(state, secrets, tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'envs', 'n8n.env'))).toBe(true);
  });

  test('does not write n8n.env when n8n not selected', () => {
    const state = { env: 'vps', domain: 'example.com', modules: { n8n: false }, moduleEnv: {} };
    const secrets = { SEARXNG_SECRET: 's', MEILI_MASTER_KEY: 'mk', NEXTAUTH_SECRET: 'ns', KARAKEEP_POSTGRES_PASSWORD: 'kpp' };
    writeEnvFiles(state, secrets, tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'envs', 'n8n.env'))).toBe(false);
  });

  test('writes caddy.env with CLOUDFLARE_API_TOKEN for VPS', () => {
    const state = { env: 'vps', domain: 'example.com', cloudflareToken: 'cf-tok', modules: {}, moduleEnv: {} };
    const secrets = { SEARXNG_SECRET: 's', MEILI_MASTER_KEY: 'mk', NEXTAUTH_SECRET: 'ns', KARAKEEP_POSTGRES_PASSWORD: 'kpp' };
    writeEnvFiles(state, secrets, tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, 'envs', 'caddy.env'), 'utf8');
    expect(content).toContain('CLOUDFLARE_API_TOKEN=cf-tok');
  });

  test('writes caddy.env with blank CLOUDFLARE_API_TOKEN for Docker Desktop', () => {
    const state = { env: 'docker-desktop', domain: '', modules: {}, moduleEnv: {} };
    const secrets = { SEARXNG_SECRET: 's', MEILI_MASTER_KEY: 'mk', NEXTAUTH_SECRET: 'ns', KARAKEEP_POSTGRES_PASSWORD: 'kpp' };
    writeEnvFiles(state, secrets, tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, 'envs', 'caddy.env'), 'utf8');
    expect(content).toContain('CLOUDFLARE_API_TOKEN=\n');
  });
});

const { renderCaddyfile } = require('../scripts/generate-configs');

describe('renderCaddyfile', () => {
  const template = `
{{#if vps}}
{DOMAIN} {
  tls {
    dns cloudflare {env.CLOUDFLARE_API_TOKEN}
  }
}
{{/if vps}}
{{#if docker_desktop}}
*.localhost {
  tls internal
}
{{/if docker_desktop}}
{{#if n8n}}
n8n.{DOMAIN} {
  reverse_proxy tailscale-n8n:5678
}
{{/if n8n}}
`.trim();

  test('renders VPS block and excludes docker_desktop block', () => {
    const result = renderCaddyfile(template, { vps: true, docker_desktop: false, n8n: false, DOMAIN: 'example.com' });
    expect(result).toContain('dns cloudflare');
    expect(result).not.toContain('tls internal');
    expect(result).not.toContain('n8n.example.com');
  });

  test('renders docker_desktop block and excludes vps block', () => {
    const result = renderCaddyfile(template, { vps: false, docker_desktop: true, n8n: false, DOMAIN: 'localhost' });
    expect(result).toContain('tls internal');
    expect(result).not.toContain('dns cloudflare');
  });

  test('renders n8n block when n8n is true', () => {
    const result = renderCaddyfile(template, { vps: true, docker_desktop: false, n8n: true, DOMAIN: 'example.com' });
    expect(result).toContain('n8n.example.com');
    expect(result).toContain('reverse_proxy tailscale-n8n:5678');
  });

  test('substitutes {DOMAIN} token', () => {
    const result = renderCaddyfile(template, { vps: true, docker_desktop: false, n8n: false, DOMAIN: 'mysite.io' });
    expect(result).toContain('mysite.io');
  });
});

const { generateConfigs } = require('../scripts/generate-configs');

describe('generateConfigs (integration)', () => {
  let tmpDir;
  const REPO_ROOT = path.join(__dirname, '..');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'launchpad-int-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('creates envs/ directory and Caddyfile', () => {
    const state = {
      env: 'vps',
      domain: 'example.com',
      cloudflareToken: 'cf-tok',
      tailscaleAuthKey: 'ts-key',
      modules: { n8n: false, paperclip: false, monitoring: false },
      moduleEnv: {},
    };
    const result = generateConfigs(state, tmpDir, REPO_ROOT);
    expect(fs.existsSync(path.join(tmpDir, 'envs', 'searxng.env'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'Caddyfile'))).toBe(true);
    expect(result).toHaveProperty('secrets');
  });
});
