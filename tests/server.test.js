'use strict';

const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Set env before requiring server
const TOKEN = 'test-token-abc';
process.env.SESSION_TOKEN = TOKEN;
process.env.BASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'launchpad-srv-'));
process.env.REPO_ROOT = path.join(__dirname, '..');
process.env.MANAGE_MODE = '';

const { app } = require('../launchpad/server');

describe('auth middleware', () => {
  test('GET /api/state without token → 401', async () => {
    const res = await request(app).get('/api/state');
    expect(res.status).toBe(401);
  });

  test('GET /api/state with wrong token → 401', async () => {
    const res = await request(app).get('/api/state?token=wrong');
    expect(res.status).toBe(401);
  });

  test('GET /api/state with correct query token → 200', async () => {
    const res = await request(app).get(`/api/state?token=${TOKEN}`);
    expect(res.status).toBe(200);
  });

  test('GET /api/state with Bearer token → 200', async () => {
    const res = await request(app)
      .get('/api/state')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
  });
});

describe('state CRUD', () => {
  test('GET /api/state returns empty object when no state file exists', async () => {
    const res = await request(app).get(`/api/state?token=${TOKEN}`);
    expect(res.body).toEqual({});
  });

  test('POST /api/state saves state and returns it', async () => {
    const res = await request(app)
      .post(`/api/state?token=${TOKEN}`)
      .send({ env: 'vps', domain: 'example.com' });
    expect(res.status).toBe(200);
    expect(res.body.env).toBe('vps');
    expect(res.body.domain).toBe('example.com');
  });

  test('POST /api/state deep-merges with existing state', async () => {
    await request(app)
      .post(`/api/state?token=${TOKEN}`)
      .send({ env: 'vps', domain: 'example.com' });
    const res = await request(app)
      .post(`/api/state?token=${TOKEN}`)
      .send({ modules: { n8n: true } });
    expect(res.body.env).toBe('vps');        // preserved from first POST
    expect(res.body.modules.n8n).toBe(true); // merged from second POST
  });
});

describe('GET /health', () => {
  test('returns 200 without auth', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/deploy', () => {
  test('returns 200 with ok:true', async () => {
    // Post minimal state first
    await request(app)
      .post(`/api/state?token=${TOKEN}`)
      .send({
        env: 'vps',
        domain: 'example.com',
        modules: { n8n: false, paperclip: false, monitoring: false },
        moduleEnv: {},
        _testMode: true,
      });

    const res = await request(app).post(`/api/deploy?token=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('POST /api/deploy without auth → 401', async () => {
    const res = await request(app).post('/api/deploy');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/config', () => {
  test('returns manageMode false by default', async () => {
    const res = await request(app).get(`/api/config?token=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('manageMode');
    expect(res.body.manageMode).toBe(false);
  });
});

describe('POST /api/modules/:id/remove', () => {
  test('returns 200 and marks module as false in state', async () => {
    // Set state with a module active and testMode so generateConfigs is skipped
    await request(app)
      .post(`/api/state?token=${TOKEN}`)
      .send({ modules: { n8n: true }, env: 'vps', domain: 'test.com', _testMode: true });

    const res = await request(app)
      .post(`/api/modules/n8n/remove?token=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify state updated
    const stateRes = await request(app).get(`/api/state?token=${TOKEN}`);
    expect(stateRes.body.modules.n8n).toBe(false);
  });
});
