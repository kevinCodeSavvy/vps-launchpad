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
    if (!state.modules || !state.modules[modId]) continue;

    const heading = document.createElement('h3');
    heading.textContent = modId.charAt(0).toUpperCase() + modId.slice(1);
    heading.style.cssText = 'font-size:1rem;margin-bottom:0.75rem;color:#94a3b8;';
    container.appendChild(heading);

    if (modId === 'paperclip') {
      anyFields = true;
      const savedMethod = (state.moduleEnv && state.moduleEnv.paperclip && state.moduleEnv.paperclip._authMethod) || 'api_key';

      const toggle = document.createElement('div');
      toggle.style.cssText = 'margin-bottom:1rem;';
      toggle.innerHTML = `
        <p class="hint" style="margin-bottom:0.5rem">How would you like to authenticate?</p>
        <div style="display:flex;gap:1rem;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;font-weight:normal">
            <input type="radio" name="paperclip-auth" value="api_key" ${savedMethod === 'api_key' ? 'checked' : ''}>
            API Key
          </label>
          <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;font-weight:normal">
            <input type="radio" name="paperclip-auth" value="claude_subscription" ${savedMethod === 'claude_subscription' ? 'checked' : ''}>
            Claude Subscription (Max / Pro)
          </label>
        </div>`;
      container.appendChild(toggle);

      const keySection = document.createElement('div');
      keySection.id = 'paperclip-api-key-section';
      keySection.style.display = savedMethod === 'claude_subscription' ? 'none' : 'block';

      const existingKey = (state.moduleEnv && state.moduleEnv.paperclip && state.moduleEnv.paperclip.ANTHROPIC_API_KEY) || '';
      const label = document.createElement('label');
      label.innerHTML = `Anthropic API Key
        <input type="password" id="modenv-paperclip-ANTHROPIC_API_KEY" value="${existingKey}"
               placeholder="console.anthropic.com → API Keys" autocomplete="off">`;
      keySection.appendChild(label);

      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.style.marginTop = '-0.75rem';
      hint.textContent = 'console.anthropic.com → API Keys';
      keySection.appendChild(hint);
      container.appendChild(keySection);

      const subHint = document.createElement('p');
      subHint.id = 'paperclip-subscription-hint';
      subHint.className = 'hint';
      subHint.style.display = savedMethod === 'claude_subscription' ? 'block' : 'none';
      subHint.textContent = 'After deployment, the wizard will generate a sign-in link for you to authenticate with your Claude account.';
      container.appendChild(subHint);

      toggle.querySelectorAll('input[name="paperclip-auth"]').forEach(radio => {
        radio.addEventListener('change', () => {
          const isSub = radio.value === 'claude_subscription';
          keySection.style.display = isSub ? 'none' : 'block';
          subHint.style.display = isSub ? 'block' : 'none';
        });
      });
      continue;
    }

    if (defs.length === 0) continue;
    anyFields = true;

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
      if (modId === 'paperclip') {
        const authRadio = document.querySelector('input[name="paperclip-auth"]:checked');
        if (authRadio) updates.moduleEnv.paperclip._authMethod = authRadio.value;
      }
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
  appendLog('Preparing deployment — pulling images may take a few minutes…', 'starting');
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
      const needsClaudeAuth = state.modules && state.modules.paperclip &&
        state.moduleEnv && state.moduleEnv.paperclip &&
        state.moduleEnv.paperclip._authMethod === 'claude_subscription';
      if (needsClaudeAuth) {
        showClaudeAuthStep();
      } else {
        renderDeployLinks(state);
        document.getElementById('btn-done').classList.remove('hidden');
      }
    }
  };

  evtSource.onerror = () => {
    evtSource.close();
  };
}

function showClaudeAuthStep() {
  const log = document.getElementById('deploy-log');

  const section = document.createElement('div');
  section.innerHTML = `
    <div class="log-line" style="margin-top:1.25rem;padding-top:1.25rem;border-top:1px solid #334155">
      <strong>🔐 Sign in with your Claude account</strong>
    </div>
    <div id="claude-auth-starting" class="log-line hint">Starting authentication…</div>
    <div id="claude-auth-url-box" style="display:none;margin:1rem 0;padding:1rem;background:#1e293b;border-radius:8px;border:1px solid #3b82f6">
      <p style="margin:0 0 0.5rem;color:#94a3b8;font-size:0.85rem">Open this link in your browser to sign in:</p>
      <a id="claude-auth-link" href="#" target="_blank" style="color:#60a5fa;word-break:break-all;font-size:0.875rem"></a>
    </div>
    <div id="claude-auth-code-box" style="display:none;margin:1rem 0;padding:1rem;background:#1e293b;border-radius:8px;border:1px solid #f59e0b">
      <p style="margin:0 0 0.75rem;color:#94a3b8;font-size:0.85rem">After signing in, claude.ai will show you an <strong style="color:#fbbf24">Authentication Code</strong>. Paste it here:</p>
      <div style="display:flex;gap:0.5rem">
        <input id="claude-auth-code-input" type="text" placeholder="Paste authentication code…"
          style="flex:1;padding:0.5rem 0.75rem;background:#0f172a;border:1px solid #475569;border-radius:6px;color:#f1f5f9;font-size:0.875rem;font-family:monospace">
        <button id="claude-auth-code-btn" onclick="submitClaudeAuthCode()"
          style="padding:0.5rem 1rem;background:#f59e0b;color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:0.875rem">Submit</button>
      </div>
      <div id="claude-auth-code-err" style="display:none;color:#ef4444;font-size:0.8rem;margin-top:0.5rem"></div>
    </div>
    <div id="claude-auth-waiting" style="display:none" class="hint">Verifying authentication code…</div>
    <div id="claude-auth-ok" style="display:none;color:#22c55e;padding:0.5rem 0">✅ Authenticated — Paperclip is ready.</div>
    <div id="claude-auth-err" style="display:none;color:#ef4444;padding:0.5rem 0"></div>`;
  log.appendChild(section);
  log.scrollTop = log.scrollHeight;

  const evtSource = new EventSource(`/api/modules/paperclip/claude-auth?token=${TOKEN}`);

  evtSource.onmessage = (e) => {
    const event = JSON.parse(e.data);
    if (event.type === 'status') {
      document.getElementById('claude-auth-starting').textContent = event.message;
    } else if (event.type === 'url') {
      document.getElementById('claude-auth-starting').style.display = 'none';
      const urlBox = document.getElementById('claude-auth-url-box');
      const link = document.getElementById('claude-auth-link');
      link.href = event.url;
      link.textContent = event.url;
      urlBox.style.display = 'block';
    } else if (event.type === 'awaiting_code') {
      document.getElementById('claude-auth-code-box').style.display = 'block';
      document.getElementById('claude-auth-code-input').focus();
    } else if (event.type === 'done') {
      evtSource.close();
      document.getElementById('claude-auth-waiting').style.display = 'none';
      document.getElementById('claude-auth-url-box').style.display = 'none';
      document.getElementById('claude-auth-code-box').style.display = 'none';
      document.getElementById('claude-auth-ok').style.display = 'block';
      renderDeployLinks(state);
      document.getElementById('btn-done').classList.remove('hidden');
    } else if (event.type === 'error') {
      evtSource.close();
      document.getElementById('claude-auth-waiting').style.display = 'none';
      document.getElementById('claude-auth-code-box').style.display = 'none';
      const errEl = document.getElementById('claude-auth-err');
      errEl.textContent = event.message;
      errEl.style.display = 'block';
      renderDeployLinks(state);
      document.getElementById('btn-done').classList.remove('hidden');
    }
    log.scrollTop = log.scrollHeight;
  };

  evtSource.onerror = () => evtSource.close();
}

async function submitClaudeAuthCode() {
  const input = document.getElementById('claude-auth-code-input');
  const errEl = document.getElementById('claude-auth-code-err');
  const btn = document.getElementById('claude-auth-code-btn');
  const code = input.value.trim();
  if (!code) {
    errEl.textContent = 'Please paste the authentication code first.';
    errEl.style.display = 'block';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Submitting…';
  errEl.style.display = 'none';
  try {
    await api('POST', '/api/modules/paperclip/claude-auth/code', { code });
    // Code submitted — show waiting indicator; SSE will fire 'done' or 'error'
    document.getElementById('claude-auth-code-box').style.display = 'none';
    document.getElementById('claude-auth-waiting').style.display = 'block';
  } catch (err) {
    errEl.textContent = `Failed to submit code: ${err.message}`;
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Submit';
  }
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
