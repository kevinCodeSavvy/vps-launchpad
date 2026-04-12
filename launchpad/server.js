'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TOKEN = process.env.SESSION_TOKEN || '';
const BASE_DIR = process.env.BASE_DIR || path.join(os.homedir(), '.vps-launchpad');
const REPO_ROOT = process.env.REPO_ROOT || path.join(__dirname, '..');
const MANAGE_MODE = process.env.MANAGE_MODE === 'true';
const PORT = parseInt(process.env.PORT || '8888', 10);

const STATE_FILE = path.join(BASE_DIR, 'setup-state.json');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── 30-minute idle expiry ─────────────────────────────────────────────────────
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
let lastActivity = Date.now();

function startIdleTimer() {
  setInterval(() => {
    if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
      console.log('Idle timeout — shutting down launchpad.');
      process.exit(0);
    }
  }, 60_000);
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const queryToken = req.query.token;
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
  if (queryToken === TOKEN || bearerToken === TOKEN) {
    lastActivity = Date.now();
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// ── State helpers ─────────────────────────────────────────────────────────────
function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeState(state) {
  fs.mkdirSync(BASE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  return state;
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const [k, v] of Object.entries(source)) {
    result[k] = (v && typeof v === 'object' && !Array.isArray(v) && typeof result[k] === 'object')
      ? deepMerge(result[k], v)
      : v;
  }
  return result;
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ ok: true }));

app.get('/api/state', requireAuth, (_, res) => {
  res.json(readState());
});

app.post('/api/state', requireAuth, (req, res) => {
  const current = readState();
  const updated = writeState(deepMerge(current, req.body));
  res.json(updated);
});

app.get('/api/modules', requireAuth, (_, res) => {
  const modulesDir = path.join(REPO_ROOT, 'modules');
  const modules = [];
  try {
    for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const yamlPath = path.join(modulesDir, entry.name, 'module.yaml');
      if (!fs.existsSync(yamlPath)) continue;
      const raw = fs.readFileSync(yamlPath, 'utf8');
      const nameMatch = raw.match(/^name:\s*(.+)$/m);
      const descMatch = raw.match(/^description:\s*(.+)$/m);
      const iconMatch = raw.match(/^icon:\s*(.+)$/m);
      modules.push({
        id: entry.name,
        name: nameMatch ? nameMatch[1].trim() : entry.name,
        description: descMatch ? descMatch[1].trim() : '',
        icon: iconMatch ? iconMatch[1].trim() : '📦',
      });
    }
  } catch (_) {}
  res.json(modules);
});

// ── Deploy ────────────────────────────────────────────────────────────────────
const { generateConfigs } = require('../scripts/generate-configs');
const { deployStack } = require('../scripts/deploy');

// SSE event queue — in-memory bus (one deploy at a time)
let sseClients = [];
let deployLog = [];

function broadcastEvent(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  deployLog.push(data);
  for (const res of sseClients) {
    try { res.write(data); } catch (_) {}
  }
}

app.post('/api/deploy', requireAuth, (req, res) => {
  const state = readState();
  deployLog = [];

  res.json({ ok: true });

  setImmediate(async () => {
    try {
      const { secrets } = generateConfigs(state, BASE_DIR, REPO_ROOT);
      const updatedState = deepMerge(state, { secrets });
      writeState(updatedState);
      await deployStack(updatedState, BASE_DIR, REPO_ROOT, broadcastEvent);
    } catch (err) {
      broadcastEvent({ type: 'fatal', message: err.message });
    }
  });
});

app.get('/api/deploy/stream', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  for (const entry of deployLog) {
    res.write(entry);
  }

  sseClients.push(res);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

app.post('/api/deploy/destroy', requireAuth, (req, res) => {
  res.json({ ok: true });
  setTimeout(() => {
    const { execSync } = require('child_process');
    try {
      execSync('docker rm -f vps-launchpad', { stdio: 'pipe' });
    } catch (_) {
      process.exit(0);
    }
  }, 500);
});

module.exports = { app };

// Only start server when run directly (not when required by tests)
if (require.main === module) {
  fs.mkdirSync(BASE_DIR, { recursive: true });
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Launchpad running on port ${PORT}`);
    console.log(`MANAGE_MODE: ${MANAGE_MODE}`);
    startIdleTimer();
  });
}
