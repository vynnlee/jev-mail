import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = path.join(root, 'dist/cli/main.js');
const preload = path.join(root, 'tests/e2e/mock-google.mjs');

test('CLI onboarding resumes safely and operates against mocked Google transport', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-mail-e2e-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home');
  const stateFile = path.join(dir, 'google-state.json');
  const credentialFile = path.join(dir, 'client.json');
  fs.mkdirSync(home);
  fs.writeFileSync(stateFile, JSON.stringify({ calls: [], files: [], projectsCreated: 0,
    contentWrites: 0, versions: 0, deploymentsCreated: 0, deploymentsUpdated: 0,
    apiKeyConfigured: false, configureCalls: 0, enabled: false }));
  fs.writeFileSync(credentialFile, JSON.stringify({ installed: { client_id: 'test-client', client_secret: 'test-secret' } }));
  fs.writeFileSync(path.join(home, 'google-tokens.json'), JSON.stringify({
    access_token: 'test-access', refresh_token: 'test-refresh', expires_at: Date.now() + 3_600_000,
  }));
  const readState = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const invoke = (argv, env = {}) => {
    const result = spawnSync(process.execPath, ['--import', preload, cli, ...argv, '--home', home, '--json'], {
      cwd: root, encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, JEV_E2E_MOCK_STATE: stateFile, JEV_E2E_REMOTE_READY: '1',
        TYPESAFE_API_KEY: 'test-secret-key', ...env },
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /test-secret-key|test-access|test-refresh|test-secret/);
    assert.ok(result.stdout.trim(), `CLI exited ${result.status} without JSON. stderr: ${result.stderr}`);
    return { code: result.status, data: JSON.parse(result.stdout), stderr: result.stderr };
  };

  const migratedPath = path.join(dir, 'migrated.yaml');
  const legacyPath = path.join(root, 'legacy/taxonomy.default.json');
  let migration = invoke(['config', 'migrate', '--from', legacyPath, '--config', migratedPath]);
  assert.equal(migration.code, 0, JSON.stringify(migration.data));
  assert.equal(migration.data.mode, 'label-only');
  const migratedYaml = fs.readFileSync(migratedPath, 'utf8');
  assert.match(migratedYaml, /mode: label-only/);
  assert.match(migratedYaml, /label: Receipts/);
  migration = invoke(['config', 'migrate', '--from', legacyPath, '--config', migratedPath]);
  assert.equal(migration.code, 2, JSON.stringify(migration.data));
  assert.match(migration.data.error, /overwrite/i);
  assert.equal(fs.readFileSync(migratedPath, 'utf8'), migratedYaml);

  let result = invoke(['config', 'init']);
  assert.equal(result.code, 0);
  result = invoke(['config', 'validate']);
  assert.equal(result.code, 0);
  assert.equal(result.data.valid, true);
  result = invoke(['config', 'add-label', '--key', 'travel', '--label', 'Travel',
    '--description', 'Flight and hotel bookings', '--archive', 'false']);
  assert.equal(result.code, 0, JSON.stringify(result.data));
  assert.match(fs.readFileSync(path.join(home, 'config.yaml'), 'utf8'), /label: Travel/);
  const config = fs.readFileSync(path.join(home, 'config.yaml'), 'utf8');
  fs.writeFileSync(path.join(home, 'config.yaml'), config.replace('actionRequired: 0.55', 'actionRequired: 1.5'));
  result = invoke(['config', 'validate']);
  assert.equal(result.code, 2);
  assert.match(result.data.error, /actionRequired/);
  fs.writeFileSync(path.join(home, 'config.yaml'), config);

  result = invoke(['init', '--credentials', credentialFile, '--project-number', '123456789012', '--no-open'], { JEV_E2E_REMOTE_READY: '0' });
  assert.equal(result.code, 3, JSON.stringify(result.data));
  assert.equal(result.data.details.scriptId, 'script-1');
  assert.equal(readState().projectsCreated, 1);
  assert.equal(readState().deploymentsCreated, 1);
  assert.ok(readState().files.some(file => file.name === 'Config' && file.source.includes('Travel')));

  result = invoke(['init', '--project-number', '123456789012', '--no-open']);
  assert.equal(result.code, 0, JSON.stringify(result.data));
  assert.equal(result.data.installed, true);
  assert.equal(result.data.accountEmail, 'owner@example.com');
  assert.equal(readState().configureCalls, 1);
  result = invoke(['init', '--project-number', '123456789012', '--no-open']);
  assert.equal(result.code, 0, JSON.stringify(result.data));
  assert.equal(readState().projectsCreated, 1);
  assert.equal(readState().deploymentsCreated, 1);
  assert.equal(readState().contentWrites, 1);

  const installationFile = path.join(home, 'installation.json');
  const interrupted = JSON.parse(fs.readFileSync(installationFile, 'utf8'));
  delete interrupted.deploymentId;
  fs.writeFileSync(installationFile, JSON.stringify(interrupted));
  result = invoke(['init', '--project-number', '123456789012', '--no-open']);
  assert.equal(result.code, 0, JSON.stringify(result.data));
  assert.equal(readState().deploymentsCreated, 1, 'resume must reuse the existing owned deployment');
  assert.equal(JSON.parse(fs.readFileSync(installationFile, 'utf8')).deploymentId, 'deployment-1');

  result = invoke(['init', '--project-number', '123456789012', '--no-open', '--replace-key']);
  assert.equal(result.code, 0, JSON.stringify(result.data));
  assert.equal(readState().configureCalls, 2, 'explicit replacement must send the new key');

  const localConfigFile = path.join(home, 'config.yaml');
  fs.writeFileSync(localConfigFile, fs.readFileSync(localConfigFile, 'utf8').replace('label: Travel', 'label: Trips'));
  const writesBeforeApply = readState().contentWrites;
  result = invoke(['init', '--project-number', '123456789012', '--no-open']);
  assert.equal(result.code, 2, JSON.stringify(result.data));
  assert.match(result.data.error, /config apply|update/);
  assert.equal(readState().contentWrites, writesBeforeApply, 'init must not silently upload changed YAML');
  result = invoke(['config', 'apply']);
  assert.equal(result.code, 0, JSON.stringify(result.data));
  assert.equal(readState().contentWrites, writesBeforeApply + 1);
  assert.ok(readState().files.some(file => file.name === 'Config' && file.source.includes('Trips')));

  fs.writeFileSync(localConfigFile, fs.readFileSync(localConfigFile, 'utf8').replace('intervalMinutes: 5', 'intervalMinutes: 10'));
  result = invoke(['config', 'apply'], { JEV_E2E_INTERVAL_MATCH: '0' });
  assert.equal(result.code, 3, JSON.stringify(result.data));
  assert.match(result.data.error, /installTrigger/);
  assert.equal(readState().contentWrites, writesBeforeApply + 2, 'explicit apply uploads interval change before reporting required trigger reinstall');

  result = invoke(['init', '--project-number', '123456789012', '--no-open'], { JEV_E2E_MODEL_VERIFIED: '0' });
  assert.equal(result.code, 3, JSON.stringify(result.data));
  assert.match(result.data.error, /model|verification|setup/i);
  result = invoke(['doctor'], { JEV_E2E_MODEL_VERIFIED: '0' });
  assert.equal(result.code, 3, JSON.stringify(result.data));
  result = invoke(['doctor'], { JEV_E2E_TRIGGER_COUNT: '0' });
  assert.equal(result.code, 3, JSON.stringify(result.data));
  result = invoke(['doctor']);
  assert.equal(result.code, 0, JSON.stringify(result.data));

  result = invoke(['preview', '--limit', '4']);
  assert.equal(result.code, 0);
  assert.equal(result.data.applied, 0);
  result = invoke(['enable']);
  assert.equal(result.code, 0);
  assert.equal(result.data.enabled, true);
  result = invoke(['status']);
  assert.equal(result.code, 0);
  assert.equal(result.data.enabled, true);
  result = invoke(['disable']);
  assert.equal(result.code, 0);
  assert.equal(result.data.enabled, false);
  assert.equal(readState().enabled, false);

  const beforeWrongAccount = readState().calls.length;
  result = invoke(['enable'], { JEV_E2E_ACCOUNT: 'other@example.com' });
  assert.equal(result.code, 3);
  assert.match(result.data.error, /account/i);
  assert.equal(readState().calls.slice(beforeWrongAccount).some(call => call.path.endsWith(':run')), false);

  result = invoke(['status', '--unknown-option']);
  assert.equal(result.code, 2, JSON.stringify(result.data));
  assert.equal(result.data.ok, false);
});
