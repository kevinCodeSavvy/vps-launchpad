'use strict';

const { buildDeployPlan, CORE_SERVICES } = require('../scripts/deploy');
const { pollHealthCheck } = require('../scripts/deploy');

describe('buildDeployPlan', () => {
  test('core services always included', () => {
    const plan = buildDeployPlan({ modules: {} });
    const names = plan.map(g => g.services).flat();
    expect(names).toContain('caddy');
    expect(names).toContain('tailscale');
    expect(names).toContain('searxng');
    expect(names).toContain('karakeep');
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
