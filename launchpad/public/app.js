'use strict';

// ── Bootstrap ──────────────────────────────────────────────────────────────────

const TOKEN = new URLSearchParams(location.search).get('token') || '';
const BASE_URL = '';

async function api(method, path, body) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE_URL}${path}${sep}token=${TOKEN}`;
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json();
}

// ── Step definitions ───────────────────────────────────────────────────────────

const ALL_STEPS = ['environment', 'admin-user', 'domain', 'cloudflare', 'tailscale', 'modules', 'api-keys', 'review', 'deploy'];

function getStepsForEnv(env) {
  if (env === 'docker-desktop') {
    return ['environment', 'tailscale', 'modules', 'api-keys', 'review', 'deploy'];
  }
  return ALL_STEPS;
}

// ── State ──────────────────────────────────────────────────────────────────────

let state = {};
let steps = ALL_STEPS;
let currentStepIndex = 0;
let modules = [];

function currentStep() { return steps[currentStepIndex]; }

// ── Rendering ──────────────────────────────────────────────────────────────────

function showStep(stepId) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  const el = document.querySelector(`[data-step="${stepId}"]`);
  if (el) el.classList.add('active');

  const idx = steps.indexOf(stepId);
  const indicator = document.getElementById('step-indicator');
  if (indicator && idx >= 0 && stepId !== 'deploy') {
    indicator.textContent = `Step ${idx + 1} of ${steps.length - 1}`;
  } else if (indicator) {
    indicator.textContent = '';
  }
}

function renderModuleCards() {
  const container = document.getElementById('module-cards');
  if (!container) return;
  container.innerHTML = '';
  for (const mod of modules) {
    const selected = state.modules && state.modules[mod.id];
    const card = document.createElement('button');
    card.className = `module-card${selected ? ' selected' : ''}`;
    card.dataset.moduleId = mod.id;
    card.innerHTML = `
      <span class="icon">${mod.icon}</span>
      <strong>${mod.name}</strong>
      <small>${mod.description}</small>`;
    card.addEventListener('click', () => {
      const isNowSelected = !card.classList.contains('selected');
      card.classList.toggle('selected', isNowSelected);
      state.modules = state.modules || {};
      state.modules[mod.id] = isNowSelected;
    });
    container.appendChild(card);
  }
}

function renderApiKeyFields() {
  const container = document.getElementById('api-key-fields');
  if (!container) return;
  container.innerHTML = '';

  const moduleEnvDefs = {
    n8n: [
      { key: 'N8N_ENCRYPTION_KEY', label: 'Encryption Key', guide: 'Run: openssl rand -hex 32', secret: true },
      { key: 'WEBHOOK_URL', label: 'Webhook URL', guide: 'e.g. https://n8n.yourdomain.com', secret: false },
    ],
    paperclip: [
      { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', guide: 'console.anthropic.com → API Keys', secret: true },
    ],
    monitoring: [],
  };

  let anyFields = false;
  for (const [modId, defs] of Object.entries(moduleEnvDefs)) {
    if (!state.modules || !state.modules[modId] || defs.length === 0) continue;
    anyFields = true;
    const heading = document.createElement('h3');
    heading.textContent = modId.charAt(0).toUpperCase() + modId.slice(1);
    heading.style.cssText = 'font-size:1rem;margin-bottom:0.75rem;color:#94a3b8;';
    container.appendChild(heading);

    for (const field of defs) {
      const label = document.createElement('label');
      const existingVal = (state.moduleEnv && state.moduleEnv[modId] && state.moduleEnv[modId][field.key]) || '';
      label.innerHTML = `${field.label}
        <input type="${field.secret ? 'password' : 'text'}"
               id="modenv-${modId}-${field.key}"
               value="${existingVal}"
               placeholder="${field.guide}"
               autocomplete="off">`;
      container.appendChild(label);

      if (field.guide) {
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.style.marginTop = '-0.75rem';
        hint.textContent = field.guide;
        container.appendChild(hint);
      }
    }
  }

  if (!anyFields) {
    container.innerHTML = '<p class="hint">No API keys required for the selected modules.</p>';
  }
}

function renderReview() {
  const container = document.getElementById('review-summary');
  if (!container) return;

  const env = state.env === 'vps' ? 'VPS / Cloud Server' : 'Docker Desktop';
  const selectedModules = Object.entries(state.modules || {})
    .filter(([, v]) => v).map(([k]) => k).join(', ') || 'None';

  container.innerHTML = `
    <table>
      <tr><td>Environment</td><td>${env}</td></tr>
      ${state.env === 'vps' ? `
      <tr><td>Admin user</td><td>${state.adminUser || '—'}</td></tr>
      <tr><td>Domain</td><td>${state.domain || '—'}</td></tr>
      <tr><td>Cloudflare token</td><td>••••••</td></tr>` : ''}
      <tr><td>Tailscale</td><td>${state.tailscaleAuthKey ? 'Configured' : 'Skipped'}</td></tr>
      <tr><td>Modules</td><td>${selectedModules}</td></tr>
    </table>`;
}

// ── Navigation ─────────────────────────────────────────────────────────────────

async function collectStepData(stepId) {
  const updates = {};
  if (stepId === 'admin-user') {
    updates.adminUser = document.getElementById('admin-username')?.value?.trim();
    updates.adminPassword = document.getElementById('admin-password')?.value;
    updates.sshHarden = document.getElementById('ssh-harden')?.checked ?? true;
  } else if (stepId === 'domain') {
    updates.domain = document.getElementById('domain')?.value?.trim();
  } else if (stepId === 'cloudflare') {
    updates.cloudflareToken = document.getElementById('cloudflare-token')?.value?.trim();
  } else if (stepId === 'tailscale') {
    updates.tailscaleAuthKey = document.getElementById('tailscale-key')?.value?.trim();
  } else if (stepId === 'modules') {
    updates.modules = state.modules || {};
  } else if (stepId === 'api-keys') {
    updates.moduleEnv = state.moduleEnv || {};
    for (const modId of Object.keys(state.modules || {})) {
      if (!state.modules[modId]) continue;
      updates.moduleEnv[modId] = updates.moduleEnv[modId] || {};
      document.querySelectorAll(`[id^="modenv-${modId}-"]`).forEach(input => {
        const key = input.id.replace(`modenv-${modId}-`, '');
        updates.moduleEnv[modId][key] = input.value;
      });
    }
  }
  return updates;
}

async function goNext() {
  const stepId = currentStep();
  const updates = await collectStepData(stepId);
  if (Object.keys(updates).length > 0) {
    state = await api('POST', '/api/state', updates);
  }
  currentStepIndex = Math.min(currentStepIndex + 1, steps.length - 1);
  const nextStep = currentStep();
  if (nextStep === 'review') renderReview();
  if (nextStep === 'modules') { modules = await api('GET', '/api/modules'); renderModuleCards(); }
  if (nextStep === 'api-keys') renderApiKeyFields();
  showStep(nextStep);
}

function goBack() {
  currentStepIndex = Math.max(currentStepIndex - 1, 0);
  showStep(currentStep());
}

// ── Deploy ─────────────────────────────────────────────────────────────────────

function appendLog(text, type = 'starting') {
  const log = document.getElementById('deploy-log');
  if (!log) return;
  const icon = type === 'healthy' ? '✅' : type === 'error' ? '❌' : '⏳';
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.textContent = `${icon} ${text}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

async function startDeploy() {
  showStep('deploy');
  document.getElementById('deploy-log').innerHTML = '';
  await api('POST', '/api/deploy');

  const sep = '/api/deploy/stream?token='.concat(TOKEN);
  const evtSource = new EventSource(sep);

  const deployedServices = [];

  evtSource.onmessage = (e) => {
    const event = JSON.parse(e.data);

    if (event.type === 'progress') {
      const msg = event.status === 'healthy'
        ? `${event.service} — healthy`
        : `Starting ${event.service}…`;
      appendLog(msg, event.status);
      if (event.status === 'healthy') deployedServices.push(event.service);
    } else if (event.type === 'module-failed') {
      appendLog(`Module ${event.module} failed — continuing without it`, 'error');
    } else if (event.type === 'error') {
      appendLog(`Error in ${event.service}: ${event.message}`, 'error');
    } else if (event.type === 'fatal') {
      appendLog(`Fatal error: ${event.message}`, 'error');
      evtSource.close();
      document.getElementById('deploy-error').classList.remove('hidden');
      document.getElementById('deploy-error').textContent = event.message;
      document.getElementById('btn-retry').classList.remove('hidden');
    } else if (event.type === 'done') {
      evtSource.close();
      appendLog('All services running!', 'healthy');
      renderDeployLinks(state);
      document.getElementById('btn-done').classList.remove('hidden');
    }
  };

  evtSource.onerror = () => {
    evtSource.close();
  };
}

function renderDeployLinks(st) {
  const container = document.getElementById('deploy-links');
  if (!container) return;
  container.classList.remove('hidden');
  const isVps = st.env === 'vps';
  const domain = st.domain || 'localhost';

  const services = [
    { name: 'SearXNG', vpsUrl: `https://search.${domain}`, localPort: 8080 },
    { name: 'Karakeep', vpsUrl: `https://karakeep.${domain}`, localPort: 3002 },
  ];

  if (st.modules && st.modules.n8n) services.push({ name: 'n8n', vpsUrl: `https://n8n.${domain}`, localPort: 5678 });
  if (st.modules && st.modules.paperclip) services.push({ name: 'Paperclip', vpsUrl: `https://paperclip.${domain}`, localPort: 3100 });
  if (st.modules && st.modules.monitoring) services.push({ name: 'Grafana', vpsUrl: `https://grafana.${domain}`, localPort: 3001 });

  for (const svc of services) {
    const url = isVps ? svc.vpsUrl : `http://localhost:${svc.localPort}`;
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.textContent = svc.name;
    container.appendChild(a);
  }
}

// ── Manage Mode ────────────────────────────────────────────────────────────────

async function renderManageScreen() {
  showStep('manage');
  const list = document.getElementById('manage-module-list');
  if (!list) return;
  list.innerHTML = '';

  modules = await api('GET', '/api/modules');
  for (const mod of modules) {
    const isRunning = !!(state.modules && state.modules[mod.id]);
    const row = document.createElement('div');
    row.className = 'manage-row';
    row.innerHTML = `
      <span>${mod.icon} ${mod.name}</span>
      <span class="status ${isRunning ? '' : 'missing'}">${isRunning ? '✅ Running' : '⬜ Not installed'}</span>
      <button class="btn-secondary" data-mod="${mod.id}" data-action="${isRunning ? 'remove' : 'install'}">
        ${isRunning ? 'Remove' : 'Install'}
      </button>`;
    list.appendChild(row);
  }
}

// ── Event delegation ───────────────────────────────────────────────────────────

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;

  if (action === 'next') await goNext();
  else if (action === 'back') goBack();
  else if (action === 'deploy') await startDeploy();
  else if (action === 'retry') location.reload();
  else if (action === 'done') {
    await api('POST', '/api/deploy/destroy');
    document.getElementById('app').innerHTML = '<h2 style="text-align:center;padding:3rem">Setup complete! You can close this tab.</h2>';
  } else if (action === 'manage-done') {
    await api('POST', '/api/deploy/destroy');
    document.getElementById('app').innerHTML = '<h2 style="text-align:center;padding:3rem">Done. You can close this tab.</h2>';
  } else if (action === 'install' || action === 'remove') {
    const modId = btn.dataset.mod;
    if (action === 'install') {
      state.modules = state.modules || {};
      state.modules[modId] = true;
      state = await api('POST', '/api/state', { modules: state.modules });
      steps = ['api-keys', 'review', 'deploy'];
      currentStepIndex = 0;
      renderApiKeyFields();
      showStep('api-keys');
    } else {
      if (confirm(`Remove ${modId}? Data volumes will be preserved.`)) {
        await api('POST', `/api/modules/${modId}/remove`);
        state.modules[modId] = false;
        state = await api('POST', '/api/state', { modules: state.modules });
        await renderManageScreen();
      }
    }
  }
});

document.querySelectorAll('.env-card').forEach(card => {
  card.addEventListener('click', async () => {
    document.querySelectorAll('.env-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    const env = card.dataset.value;
    state = await api('POST', '/api/state', { env });
    steps = getStepsForEnv(env);

    const hint = document.getElementById('tailscale-hint');
    if (hint) hint.textContent = env === 'docker-desktop'
      ? 'Optional — skip if you don\'t use Tailscale.'
      : 'Required for secure mesh networking.';

    setTimeout(goNext, 300);
  });
});

// ── Init ───────────────────────────────────────────────────────────────────────

function resumeStepIndex(stepsArr, st) {
  const stepDone = {
    'environment':  () => !!st.env,
    'admin-user':   () => !!st.adminUser,
    'domain':       () => !!st.domain,
    'cloudflare':   () => !!st.cloudflareToken,
    'tailscale':    () => st.tailscaleAuthKey !== undefined,
    'modules':      () => st.modules !== undefined,
    'api-keys':     () => st.moduleEnv !== undefined,
    'review':       () => false,
    'deploy':       () => false,
    'manage':       () => false,
  };
  let idx = 0;
  for (let i = 0; i < stepsArr.length - 1; i++) {
    const done = stepDone[stepsArr[i]];
    if (done && done()) idx = i + 1;
    else break;
  }
  return idx;
}

async function init() {
  try {
    state = await api('GET', '/api/state');
  } catch (_) {
    state = {};
  }

  const config = await api('GET', '/api/config');
  const isManagedMode = config.manageMode;
  if (isManagedMode) {
    await renderManageScreen();
    return;
  }

  if (state.env) {
    steps = getStepsForEnv(state.env);
  }

  currentStepIndex = resumeStepIndex(steps, state);
  const step = currentStep();
  if (step === 'modules') { modules = await api('GET', '/api/modules'); renderModuleCards(); }
  if (step === 'api-keys') renderApiKeyFields();
  if (step === 'review') renderReview();
  showStep(step);
}

init();
