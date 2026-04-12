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

app.get('/api/config', requireAuth, (_, res) => {
  res.json({ manageMode: MANAGE_MODE });
});

// ── Paperclip: Claude subscription auth ───────────────────────────────────────

/**
 * Strip ANSI/VT100 escape sequences from PTY output so we can relay
 * plain text to the browser.
 */
function stripAnsi(str) {
  return str
    .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')   // CSI sequences (colors, cursor)
    .replace(/\x1B[^[]/g, '')                  // other ESC sequences
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // stray control chars
}

/**
 * Wait until `docker exec paperclip claude --version` exits 0, meaning the
 * container is up and the claude CLI is reachable. Retries every 3s up to
 * maxWaitMs milliseconds. Returns true if ready, false if timed out.
 */
function waitForPaperclip(maxWaitMs = 30000) {
  const { spawnSync } = require('child_process');
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const r = spawnSync('docker', ['exec', 'paperclip', 'claude', '--version'], { stdio: 'pipe' });
    if (r.status === 0) return true;
    // busy-wait with a synchronous sleep via a tight loop (server.js is not
    // on the hot path here — this only runs once during setup)
    const until = Date.now() + 3000;
    while (Date.now() < until) { /* spin */ }
  }
  return false;
}

// Holds the active claude auth PTY so the code-input endpoint can write to it.
// Only one auth session runs at a time.
let claudeAuthChild = null;

app.get('/api/modules/paperclip/claude-auth', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch (_) {} };

  // Kill any previous auth session before starting a new one
  if (claudeAuthChild) {
    try { claudeAuthChild.kill(); } catch (_) {}
    claudeAuthChild = null;
  }

  // Wait up to 30s for paperclip container to be ready before attempting auth
  send({ type: 'status', message: 'Waiting for Paperclip to be ready…' });
  if (!waitForPaperclip(30000)) {
    send({ type: 'error', message: 'Paperclip container did not become ready in time. Check that the paperclip container is running.' });
    res.end();
    return;
  }

  // Use node-pty to spawn with a real PTY so the claude TUI renders correctly.
  const pty = require('node-pty');
  const child = pty.spawn('docker', ['exec', '-it', 'paperclip', 'claude', 'auth', 'login', '--claudeai'], {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
  });
  claudeAuthChild = child;

  let lineBuffer = '';
  let allOutput = '';
  let awaitingCodeSent = false;

  child.onData((data) => {
    const cleaned = stripAnsi(data).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    allOutput += cleaned;
    lineBuffer += cleaned;

    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop(); // keep incomplete last line in buffer

    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;

      // Detect the auth URL (long https:// line)
      const urlMatch = t.match(/(https?:\/\/\S{30,})/);
      if (urlMatch) {
        send({ type: 'url', url: urlMatch[1] });
        continue;
      }

      // Detect the "paste code here" prompt → tell UI to show code input
      if (!awaitingCodeSent && /paste code/i.test(t)) {
        awaitingCodeSent = true;
        send({ type: 'awaiting_code' });
      }

      send({ type: 'output', text: t });
    }

    // Check partial buffer for the paste-code prompt (no trailing newline)
    const partial = lineBuffer.trim();
    if (!awaitingCodeSent && partial && /paste code/i.test(partial)) {
      awaitingCodeSent = true;
      send({ type: 'awaiting_code' });
      send({ type: 'output', text: partial });
      lineBuffer = '';
    }
  });

  child.onExit(({ exitCode }) => {
    if (claudeAuthChild === child) claudeAuthChild = null;
    if (exitCode === 0) {
      send({ type: 'done' });
    } else {
      send({ type: 'error', message: `Authentication failed (exit code ${exitCode})` });
    }
    res.end();
  });

  req.on('close', () => {
    if (claudeAuthChild === child) claudeAuthChild = null;
    try { child.kill(); } catch (_) {}
  });
});

// Send the authentication code (initial paste-back after visiting the URL)
app.post('/api/modules/paperclip/claude-auth/code', requireAuth, (req, res) => {
  const code = (req.body && req.body.code || '').trim();
  if (!code) return res.status(400).json({ error: 'Missing code' });
  if (!claudeAuthChild) return res.status(409).json({ error: 'No active auth session' });
  try {
    claudeAuthChild.write(code + '\r');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send a line of input to the running auth process (for subsequent prompts)
app.post('/api/modules/paperclip/claude-auth/input', requireAuth, (req, res) => {
  const text = (req.body && req.body.text != null) ? req.body.text : '';
  if (!claudeAuthChild) return res.status(409).json({ error: 'No active auth session' });
  try {
    claudeAuthChild.write(text + '\r');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/modules/:id/remove', requireAuth, (req, res) => {
  const modId = req.params.id;
  const st = readState();
  const modDir = path.join(REPO_ROOT, 'modules', modId);

  // docker compose down (non-fatal — module may not be running)
  if (!st._testMode) {
    try {
      const { execSync: _execSync } = require('child_process');
      _execSync(`docker compose --project-directory ${modDir} down`, { stdio: 'pipe' });
    } catch (err) {
      console.error('docker compose down error:', err.message);
    }
  }

  // Update state
  if (st.modules) st.modules[modId] = false;
  writeState(st);

  // Regenerate Caddyfile without this module's block (skip in test mode)
  if (!st._testMode) {
    try {
      const { generateConfigs: _generateConfigs } = require('../scripts/generate-configs');
      _generateConfigs(st, BASE_DIR, REPO_ROOT);
      const { execSync: _execSync2 } = require('child_process');
      _execSync2(
        'docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null || true',
        { stdio: 'pipe' }
      );
    } catch (err) {
      console.error('Caddyfile regeneration error:', err.message);
    }
  }

  res.json({ ok: true });
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
