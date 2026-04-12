'use strict';

const { buildDeployPlan, CORE_SERVICES, pollHealthCheck, deployStack } = require('../scripts/deploy');

describe('buildDeployPlan', () => {
  test('core services always included', () => {
    const plan = buildDeployPlan({ modules: {} });
    const names = plan.map(g => g.services).flat();
    expect(names).toContain('caddy');
    expect(names).toContain('tailscale');
    expect(names).toContain('searxng');
    expect(names).toContain('karakeep-web');
    expect(names).toContain('karakeep-chrome');
    expect(names).toContain('karakeep-meilisearch');
    expect(names).toContain('cadvisor');
    expect(names).toContain('watchtower');
  });

  test('n8n not in plan when not selected', () => {
    const plan = buildDeployPlan({ modules: { n8n: false } });
    const names = plan.map(g => g.services).flat();
    expect(names).not.toContain('n8n');
  });

  test('paperclip-db comes before paperclip', () => {
    const plan = buildDeployPlan({ modules: { paperclip: true } });
    const names = plan.map(g => g.services).flat();
    const dbIdx = names.indexOf('paperclip-db');
    const pcIdx = names.indexOf('paperclip');
    expect(dbIdx).toBeGreaterThanOrEqual(0);
    expect(pcIdx).toBeGreaterThan(dbIdx);
  });

  test('monitoring group is parallel', () => {
    const plan = buildDeployPlan({ modules: { monitoring: true } });
    const monGroup = plan.find(g => g.services.includes('grafana'));
    expect(monGroup.parallel).toBe(true);
  });
});

describe('pollHealthCheck', () => {
  test('resolves immediately for "running" type (fallback)', async () => {
    await expect(pollHealthCheck('watchtower', { type: 'running', timeout: 5 }))
      .resolves.toBe(true);
  }, 10000);

  test('rejects for http check when URL is unreachable within short timeout', async () => {
    await expect(
      pollHealthCheck('fake-service', { type: 'http', url: 'http://127.0.0.1:19999/health', timeout: 3 })
    ).rejects.toThrow();
  }, 8000);
});

describe('deployStack (unit — mocked docker)', () => {
  test('emits progress events for each core service', async () => {
    const events = [];
    const emit = e => events.push(e);
    const state = { env: 'vps', domain: 'example.com', modules: {}, _testMode: true };
    await deployStack(state, '/fake/base', '/fake/repo', emit);
    const serviceNames = events.filter(e => e.type === 'progress').map(e => e.service);
    expect(serviceNames).toContain('caddy');
    expect(serviceNames).toContain('searxng');
    const doneEvent = events.find(e => e.type === 'done');
    expect(doneEvent).toBeDefined();
  });

  test('emits progress events for n8n module services when selected', async () => {
    const events = [];
    const emit = e => events.push(e);
    const state = { env: 'vps', domain: 'example.com', modules: { n8n: true }, _testMode: true };
    await deployStack(state, '/fake/base', '/fake/repo', emit);
    const serviceNames = events.filter(e => e.type === 'progress').map(e => e.service);
    expect(serviceNames).toContain('tailscale-n8n');
    expect(serviceNames).toContain('n8n');
  });

  test('emits module-failed when a module group is in _testFailGroups and core services still finish', async () => {
    const events = [];
    const emit = e => events.push(e);
    const state = {
      env: 'vps',
      domain: 'example.com',
      modules: { n8n: true },
      _testMode: true,
      _testFailGroups: ['modules/n8n'],
    };
    await deployStack(state, '/fake/base', '/fake/repo', emit);
    const failedEvent = events.find(e => e.type === 'module-failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent.module).toBe('modules/n8n');
    const doneEvent = events.find(e => e.type === 'done');
    expect(doneEvent).toBeDefined();
    // n8n itself should not appear as healthy
    const healthyN8n = events.find(e => e.type === 'progress' && e.service === 'n8n' && e.status === 'healthy');
    expect(healthyN8n).toBeUndefined();
  });
});
