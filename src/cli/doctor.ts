import fs from 'node:fs/promises';
import path from 'node:path';
import { parseConfigYaml } from '../configuration/index.js';
import { GoogleClient, GoogleApiError, createTokenProvider, type DesktopCredentials, type GoogleTokens } from '../platform/google.js';
import { readJson, writePrivate, type Installation } from './storage.js';

export interface Action { id: string; actor: 'user' | 'agent'; description: string; url?: string; command?: string[] }
export interface Check { id: string; status: 'pass' | 'blocked' | 'unknown'; code: string; message: string; action?: Action }
interface Options { home: string; configPath?: string; verifyModel?: boolean }

/** Non-interactive inspection. Never creates projects, publishes code, or changes Gmail.
 * OAuth token refresh may update the local token file. Model verification is opt-in.
 */
export async function diagnose(options: Options) {
  const checks: Check[] = [];
  const command = (...args: string[]) => ['jev-mail', ...args, '--home', options.home,
    ...(options.configPath ? ['--config', options.configPath] : [])];
  const init: Action = { id: 'resume_init', actor: 'agent', description: 'Resume init using this installation; do not create a second home.', command: command('init') };
  const add = (id: string, status: Check['status'], code: string, message: string, action?: Action) => checks.push({ id, status, code, message, ...(action ? { action } : {}) });
  let state: (Installation & { accountEmail?: string; configPath?: string }) | undefined;
  let credentials: DesktopCredentials | undefined;
  let tokens: GoogleTokens | undefined;
  let remote: Record<string, unknown> | undefined;
  const load = async <T>(name: string, id: string): Promise<T | undefined> => {
    try { return await readJson<T>(path.join(options.home, name)); }
    catch { add(id, 'blocked', 'LOCAL_FILE_INVALID', `${name} is invalid or unreadable. Preserve the file and repair it; do not reset the installation.`); return undefined; }
  };
  state = await load('installation.json', 'installation');
  credentials = await load('google-client.json', 'credentials');
  tokens = await load('google-tokens.json', 'authorization');
  const configPath = options.configPath || (typeof state?.configPath === 'string' ? state.configPath : undefined) || path.join(options.home, 'config.yaml');
  let configValid = false;
  try { parseConfigYaml(await fs.readFile(configPath, 'utf8')); configValid = true; add('config', 'pass', 'CONFIG_VALID', 'Local YAML is valid.'); }
  catch (error: any) {
    add('config', 'blocked', error.code === 'ENOENT' ? 'CONFIG_MISSING' : 'CONFIG_INVALID',
      error.code === 'ENOENT' ? 'No local configuration yet.' : 'Configuration is invalid or unreadable; inspect locally without publishing its contents.',
      error.code === 'ENOENT' ? { id: 'create_config', actor: 'agent', description: 'Create the default label-only configuration.', command: command('config', 'init') } : undefined);
  }
  if (!checks.some(c => c.id === 'credentials')) {
    if (!credentials) add('credentials', 'blocked', 'OAUTH_CLIENT_MISSING', 'A user-owned Desktop OAuth client is required.', {
      id: 'prepare_oauth', actor: 'agent', description: 'Use a dedicated user-owned Cloud project; enable Apps Script and Gmail APIs, configure the audience, and create a Desktop OAuth client. Save its JSON privately, then init with --credentials FILE --project-number NUMBER.', url: 'https://console.cloud.google.com/apis/credentials' });
    else if (typeof credentials.client_id !== 'string' || !credentials.client_id ||
      (credentials.token_uri !== undefined && credentials.token_uri !== 'https://oauth2.googleapis.com/token')) {
      add('credentials', 'blocked', 'OAUTH_CLIENT_INVALID', 'Stored OAuth client is invalid; repair locally.'); credentials = undefined;
    } else add('credentials', 'pass', 'OAUTH_CLIENT_PRESENT', 'OAuth client configuration is present.');
  }
  if (!checks.some(c => c.id === 'authorization')) {
    if (!tokens || (!tokens.refresh_token && !(tokens.access_token && tokens.expires_at > Date.now() + 60_000))) {
      add('authorization', 'blocked', 'LOGIN_REQUIRED', 'Google login or reauthorization is required.', {
        id: 'google_login', actor: 'user', description: 'Complete Google login and consent in the browser; never give credentials to the agent.', command: command('init', '--reauthorize') });
      tokens = undefined;
    } else add('authorization', 'pass', 'TOKEN_PRESENT', 'Local token exists; remote validity is checked below when possible.');
  }
  if (!checks.some(c => c.id === 'installation')) {
    if (!state) add('installation', 'blocked', 'INSTALLATION_MISSING', 'No saved GAS installation.', init);
    else if (state.schemaVersion !== 1 || (state.deploymentId !== undefined && typeof state.deploymentId !== 'string') || typeof state.scriptId !== 'string' || !state.scriptId || !/^\d{6,30}$/.test(state.projectNumber)) {
      add('installation', 'blocked', 'INSTALLATION_INVALID', 'Saved installation is invalid; preserve it for recovery.'); state = undefined;
    } else add('installation', 'pass', 'INSTALLATION_PRESENT', 'Saved GAS project found.');
  }
  if (state && !checks.some(c => c.id === 'installation' && c.status === 'blocked')) {
    add('deployment', state.deploymentId ? 'pass' : 'blocked', state.deploymentId ? 'DEPLOYMENT_PRESENT' : 'DEPLOYMENT_MISSING',
      state.deploymentId ? 'Saved deployment found; remote accessibility is checked below.' : 'Deployment is incomplete.', state.deploymentId ? undefined : init);
  }
  if (state?.deploymentId && credentials && tokens && !checks.some(c => c.code === 'INSTALLATION_INVALID')) {
    const client = new GoogleClient(createTokenProvider(credentials, {
      load: () => readJson<GoogleTokens>(path.join(options.home, 'google-tokens.json')),
      save: value => writePrivate(path.join(options.home, 'google-tokens.json'), value),
    }));
    try {
      const account = await client.getAccountEmail();
      if (!state.accountEmail || account !== state.accountEmail) {
        add('account', 'blocked', 'ACCOUNT_MISMATCH', 'Account binding is absent or differs. Use the original account; do not execute remote functions.');
      } else {
        add('account', 'pass', 'ACCOUNT_MATCH', 'Google account matches this installation.');
        const value = await client.run(state.deploymentId, 'status');
        const result = typeof value === 'string' ? JSON.parse(value) : value;
        if (!result || typeof result !== 'object' || typeof result.enabled !== 'boolean' || typeof result.apiKeyConfigured !== 'boolean' || !Number.isInteger(result.triggerCount)) throw new Error('Invalid remote status');
        // Allowlist diagnostics: never emit arbitrary remote errors, email subjects or properties.
        remote = { enabled: result.enabled, apiKeyConfigured: result.apiKeyConfigured, triggerCount: result.triggerCount,
          triggerIntervalMatches: result.triggerIntervalMatches, receiptCapacityReached: result.receiptCapacityReached };
        add('remote', 'pass', 'REMOTE_ACCESSIBLE', 'GAS status is accessible.');
        add('api_key', result.apiKeyConfigured ? 'pass' : 'blocked', result.apiKeyConfigured ? 'API_KEY_PRESENT' : 'API_KEY_MISSING',
          result.apiKeyConfigured ? 'TypeSafe key is configured; presence alone does not verify it.' : 'TypeSafe key is missing.', result.apiKeyConfigured ? undefined : init);
        const triggerReady = result.triggerCount === 1 && result.triggerIntervalMatches === true;
        add('trigger', triggerReady ? 'pass' : 'blocked', triggerReady ? 'TRIGGER_READY' : 'TRIGGER_SETUP_REQUIRED',
          triggerReady ? 'Exactly one trigger with the configured interval exists.' : 'Run installTrigger in the editor and approve permissions.', {
            id: 'install_trigger', actor: 'user', description: 'Run installTrigger in the Apps Script editor and complete Google consent.', url: `https://script.google.com/home/projects/${encodeURIComponent(state.scriptId)}/edit` });
        if (triggerReady) delete checks[checks.length - 1].action;
        add('worker', result.enabled ? 'pass' : 'unknown', result.enabled ? 'WORKER_ENABLED' : 'WORKER_PAUSED',
          result.enabled ? 'Worker is enabled; this does not prove a timer has executed.' : 'Worker is paused. Review a preview before enabling.', result.enabled ? undefined : {
            id: 'preview_before_enable', actor: 'agent', description: 'Preview is read-only for Gmail but sends inbox content to Jev and consumes API usage. Enable only within the user-authorized scope.', command: command('preview', '--limit', '1') });
        const last = result.lastRun;
        const observed = last && typeof last.at === 'string';
        add('scheduled_run', observed ? 'pass' : 'unknown', observed ? 'RUN_RECORDED' : 'RUN_NOT_OBSERVED',
          observed ? 'A worker run is recorded; inspect status for its age and failures. This is not a 24-hour endurance claim.' : 'No recorded worker execution. Upload and trigger creation alone are not end-to-end proof.');
        if (result.receiptCapacityReached) add('capacity', 'blocked', 'RECEIPT_CAPACITY_REACHED', 'Processing receipt capacity reached. Review retained Inbox threads; do not erase receipts to force replay.');
        if (options.verifyModel && result.apiKeyConfigured) {
          try {
          const raw = await client.run(state.deploymentId, 'verifySetup');
          const verification = typeof raw === 'string' ? JSON.parse(raw) : raw;
          const verified = verification?.modelVerified === true;
          add('model', verified ? 'pass' : 'blocked', verified ? 'MODEL_VERIFIED' : 'MODEL_VERIFICATION_FAILED',
            verified ? 'Synthetic TypeSafe request succeeded.' : 'Synthetic TypeSafe request failed. Check provider availability and key; init --replace-key validates a replacement before saving.');
          } catch {
            add('model', 'blocked', 'MODEL_CHECK_FAILED', 'Synthetic verification could not complete. GAS status was accessible; check provider/key and retry verification before changing the Cloud project.');
          }
        } else add('model', 'unknown', 'MODEL_NOT_CHECKED', 'Use doctor --verify-model for an explicit synthetic API check (usage applies).');
      }
    } catch (error) {
      const code = error instanceof GoogleApiError ? error.code : 'REMOTE_CHECK_FAILED';
      const urls: Record<string, string> = {
        APPS_SCRIPT_API_DISABLED: 'https://script.google.com/home/usersettings',
        GOOGLE_CLOUD_SCRIPT_API_DISABLED: 'https://console.cloud.google.com/apis/library/script.googleapis.com',
        GOOGLE_CLOUD_GMAIL_API_DISABLED: 'https://console.cloud.google.com/apis/library/gmail.googleapis.com',
      };
      const auth = (error instanceof GoogleApiError && (error.status === 401 || error.code === 'invalid_grant')) || (error instanceof Error && error.message.includes('authorization expired'));
      const action: Action = auth ? { id: 'reauthorize', actor: 'user', description: 'Complete browser reauthorization for the original account.', command: command('init', '--reauthorize') }
        : urls[code] ? { id: 'enable_api', actor: code === 'APPS_SCRIPT_API_DISABLED' ? 'user' : 'agent', description: 'Enable the indicated API in the original account/project, then rerun doctor.', url: urls[code] }
        : { id: 'inspect_remote_access', actor: 'agent', description: 'Check deployment access and that GAS uses the same standard Cloud project as the OAuth client. A generic error does not establish project mismatch; do not replace projects.', url: `https://script.google.com/home/projects/${encodeURIComponent(state.scriptId)}/settings` };
      add('remote', 'blocked', auth ? 'REAUTHORIZATION_REQUIRED' : code, 'Remote check failed. No project, deployment, or Gmail changes were made.', action);
    }
  } else add('remote', 'unknown', 'REMOTE_NOT_CHECKED', 'Remote check requires a saved deployment, OAuth client, and token.');
  const nextActions = checks.filter(c => c.action).map(c => c.action!);
  return { schemaVersion: 1, ok: !checks.some(c => c.status === 'blocked'), localConfigValid: configValid,
    checks, nextActions, ...(state ? { installation: { scriptId: state.scriptId, deploymentId: state.deploymentId } } : {}), ...(remote ? { remote } : {}) };
}
