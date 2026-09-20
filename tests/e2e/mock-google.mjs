import fs from 'node:fs';

const stateFile = process.env.JEV_E2E_MOCK_STATE;
if (!stateFile) throw new Error('Mock state file missing');
function read() { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
function write(value) { fs.writeFileSync(stateFile, JSON.stringify(value)); }
function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

globalThis.fetch = async (rawUrl, init = {}) => {
  const url = new URL(rawUrl);
  const method = init.method || 'GET';
  const state = read();
  state.calls.push({ method, path: url.pathname, body: init.body ? JSON.parse(init.body) : undefined });
  if (!new Headers(init.headers).get('Authorization')?.startsWith('Bearer ')) throw new Error('Missing Google bearer token');
  if (url.hostname === 'gmail.googleapis.com' && url.pathname === '/gmail/v1/users/me/profile') {
    write(state);
    return json({ emailAddress: process.env.JEV_E2E_ACCOUNT || 'owner@example.com' });
  }
  if (url.hostname !== 'script.googleapis.com') throw new Error(`Unexpected API host: ${url.hostname}`);
  if (url.pathname === '/v1/projects' && method === 'POST') {
    state.projectsCreated++;
    write(state);
    return json({ scriptId: 'script-1', title: 'Jev-Mail' });
  }
  if (url.pathname === '/v1/projects/script-1/content') {
    if (method === 'GET') return json({ files: state.files });
    state.files = JSON.parse(init.body).files;
    state.contentWrites++;
    write(state);
    return json({ files: state.files });
  }
  if (url.pathname === '/v1/projects/script-1/versions' && method === 'POST') {
    state.versions++;
    write(state);
    return json({ versionNumber: state.versions });
  }
  if (url.pathname === '/v1/projects/script-1/deployments' && method === 'POST') {
    state.deploymentsCreated++;
    write(state);
    return json({ deploymentId: 'deployment-1' });
  }
  if (url.pathname === '/v1/projects/script-1/deployments' && method === 'GET') {
    write(state);
    return json({ deployments: state.deploymentsCreated ? [{
      deploymentId: 'deployment-1',
      deploymentConfig: { scriptId: 'script-1', versionNumber: state.versions,
        manifestFileName: 'appsscript', description: 'Jev-Mail CLI' },
      entryPoints: [{ entryPointType: 'EXECUTION_API' }],
    }] : [] });
  }
  if (url.pathname === '/v1/projects/script-1/deployments/deployment-1' && method === 'PUT') {
    state.deploymentsUpdated++;
    write(state);
    return json({ deploymentId: 'deployment-1' });
  }
  if (url.pathname === '/v1/scripts/deployment-1:run' && method === 'POST') {
    const payload = JSON.parse(init.body);
    if (process.env.JEV_E2E_REMOTE_READY !== '1') {
      write(state);
      return json({ error: { status: 'PERMISSION_DENIED', message: 'Cloud project not linked' } }, 403);
    }
    if (payload.function === 'status') {
      write(state);
      return json({ done: true, response: { result: { enabled: state.enabled, apiKeyConfigured: state.apiKeyConfigured,
        triggerCount: Number(process.env.JEV_E2E_TRIGGER_COUNT ?? 1), triggerInstalled: true,
        triggerIntervalMatches: process.env.JEV_E2E_INTERVAL_MATCH !== '0' } } });
    }
    if (payload.function === 'configure') {
      state.apiKeyConfigured = true;
      state.configureCalls++;
      // This fixture persists only whether a secret was passed, never its value.
      const last = state.calls.at(-1);
      last.body = { function: 'configure', secretPresent: typeof payload.parameters?.[0] === 'string' };
      write(state);
      return json({ done: true, response: { result: { configured: true } } });
    }
    if (payload.function === 'verifySetup') {
      write(state);
      return json({ done: true, response: { result: { ready: true, apiKeyConfigured: state.apiKeyConfigured,
        modelVerified: process.env.JEV_E2E_MODEL_VERIFIED !== '0',
        triggerCount: Number(process.env.JEV_E2E_TRIGGER_COUNT ?? 1),
        triggerIntervalMatches: process.env.JEV_E2E_INTERVAL_MATCH !== '0',
        modelError: process.env.JEV_E2E_MODEL_VERIFIED === '0' ? 'Model rejected key' : undefined } } });
    }
    if (payload.function === 'previewInbox') {
      write(state);
      return json({ done: true, response: { result: { preview: [], examined: payload.parameters[0], applied: 0 } } });
    }
    if (payload.function === 'setEnabled') {
      state.enabled = payload.parameters[0];
      write(state);
      return json({ done: true, response: { result: { enabled: state.enabled } } });
    }
    throw new Error(`Unexpected function: ${payload.function}`);
  }
  write(state);
  throw new Error(`Unexpected API call: ${method} ${url.pathname}`);
};
