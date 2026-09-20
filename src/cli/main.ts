import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadEnvFile } from 'node:process';
try { loadEnvFile(); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
import { createHash } from 'node:crypto';
import { DEFAULT_CONFIG, parseConfigYaml, stringifyConfigYaml, validateConfig } from '../configuration/index.js';
import { GoogleClient, GoogleApiError, authorize, parseDesktopCredentials, createTokenProvider, type DesktopCredentials, type GoogleTokens } from '../platform/google.js';
import { parseLegacyJsonConfig } from '../configuration/migrate.js';
import { defaultHome, readJson, writePrivate, type Installation } from './storage.js';
import { ask, confirm, secret, openBrowser } from './prompts.js';

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === 'undefined' ? '0.2.0-dev' : __VERSION__;
const parseOptions = { allowPositionals: true, options: {
  help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' }, json: { type: 'boolean' },
  from: { type: 'string' }, home: { type: 'string' }, config: { type: 'string' }, credentials: { type: 'string' }, 'project-number': { type: 'string' },
  'no-open': { type: 'boolean' }, reauthorize: { type: 'boolean' }, 'replace-key': { type: 'boolean' }, limit: { type: 'string' }, key: { type: 'string' }, label: { type: 'string' },
  description: { type: 'string' }, archive: { type: 'string' }, mode: { type: 'string' },
} } as const;
let parsed;
try { parsed = parseArgs(parseOptions); } catch {
  const message = 'Invalid arguments. Run jev-mail help.';
  process.stdout.write(process.argv.includes('--json') ? JSON.stringify({ ok: false, error: message }) + '\n' : message + '\n');
  process.exit(2);
}
const args = parsed.values;
const [command = 'help', subcommand] = parsed.positionals;
const home = path.resolve(args.home || defaultHome());
let configPath = path.resolve(args.config || path.join(home, 'config.yaml'));
const installationPath = path.join(home, 'installation.json');
const credentialsPath = path.join(home, 'google-client.json');
const tokensPath = path.join(home, 'google-tokens.json');
type BoundInstallation = Installation & { accountEmail?: string; configPath?: string };
class CliError extends Error { constructor(message: string, public code = 1, public details?: unknown) { super(message); } }
const emit = (data: unknown, human?: string) => {
  if (args.json) process.stdout.write(JSON.stringify(data) + '\n');
  else process.stdout.write((human || JSON.stringify(data, null, 2)) + '\n');
};
const editor = (id: string) => `https://script.google.com/home/projects/${encodeURIComponent(id)}/edit`;
const settings = (id: string) => `https://script.google.com/home/projects/${encodeURIComponent(id)}/settings`;
async function loadConfig() {
  try { return parseConfigYaml(await fs.readFile(configPath, 'utf8')); }
  catch (error: any) { if (error.code === 'ENOENT') throw new CliError(`No configuration at ${configPath}. Run jev-mail config init.`, 2); throw new CliError(error.message, 2); }
}
async function installation() {
  const value = await readJson<BoundInstallation>(installationPath);
  if (!value || value.schemaVersion !== 1 || !value.scriptId) throw new CliError('No installation found. Run jev-mail init.', 2);
  return value;
}
async function google(login = false) {
  let credentials = await readJson<DesktopCredentials>(credentialsPath);
  if (args.credentials) {
    const replacement = parseDesktopCredentials(await fs.readFile(path.resolve(args.credentials), 'utf8'));
    if (credentials && credentials.client_id !== replacement.client_id && await readJson(installationPath)) throw new CliError('This installation belongs to another OAuth client. Use a different --home directory.', 2);
    credentials = replacement;
    await writePrivate(credentialsPath, credentials);
  }
  if (!credentials) throw new CliError('Google Desktop OAuth credentials are required. Run init --credentials /path/to/client.json --project-number NUMBER. See jev-mail help.', 2);
  const storage = { load: () => readJson<GoogleTokens>(tokensPath), save: (tokens: GoogleTokens) => writePrivate(tokensPath, tokens) };
  if (login && (args.reauthorize || !(await storage.load()))) {
    if (args.json) throw new CliError('Login requires browser interaction. Run init without --json once.', 3);
    const tokens = await authorize(credentials, {
      onUrl: url => { process.stderr.write(`Sign in to the Google account you want to classify:\n${url}\n`); },
      openBrowser: args['no-open'] ? async () => {} : async url => { try { await openBrowser(url); } catch { /* URL is printed */ } },
    });
    await storage.save(tokens);
  }
  if (!(await storage.load())) throw new CliError('Google login missing. Run jev-mail init.', 3);
  return new GoogleClient(createTokenProvider(credentials, storage));
}
async function boundClient() {
  const state = await installation();
  const client = await google();
  const account = await client.getAccountEmail();
  if (state.accountEmail && state.accountEmail !== account) throw new CliError('Google account differs from this installation. Use its original credentials or a separate --home directory.', 3);
  return { state, client };
}
async function invoke(name: string, parameters: unknown[] = []) {
  const { state, client } = await boundClient();
  if (!state.deploymentId) throw new CliError('Deployment incomplete. Run jev-mail init again.', 3);
  const result = await client.run(state.deploymentId, name, parameters);
  return typeof result === 'string' ? JSON.parse(result) : result;
}
async function writeConfig(config: unknown) {
  const validated = validateConfig(config);
  await writePrivate(configPath, stringifyConfigYaml(validated));
  return validated;
}
async function customize(config: any) {
  config.labels.action = await ask('Label for mail needing your action', config.labels.action);
  config.labels.review = await ask('Label for uncertain mail', config.labels.review);
  if (await confirm('Customize the category labels and rules?')) {
    for (const category of config.categories) {
      category.label = await ask(`Label for ${category.key}`, category.label);
      category.description = await ask(`Classify as ${category.label} when`, category.description);
      category.archive = await confirm(`Allow ${category.label} to be archived in archive mode?`, category.archive);
    }
  }
  return config;
}
async function ensureConfig() {
  try { await fs.access(configPath); return loadConfig(); }
  catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
    let config = structuredClone(DEFAULT_CONFIG);
    if (process.stdin.isTTY && !args.json) {
      process.stderr.write('Default labels: Follow Up, Review, Pending, Receipts, Newsletter, Notifications.\n');
      if (await confirm('Customize these labels now?')) config = await customize(config);
    }
    return writeConfig(config);
  }
}
async function publish(client: GoogleClient, state: BoundInstallation, config: unknown, allowChanges = true) {
  const assets = fileURLToPath(new URL('../gas/', import.meta.url));
  const code = await fs.readFile(path.join(assets, 'Code.gs'), 'utf8');
  const manifest = JSON.parse(await fs.readFile(path.join(assets, 'appsscript.json'), 'utf8'));
  manifest.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC';
  const files = [
    { name: 'Code', type: 'SERVER_JS', source: code },
    { name: 'Config', type: 'SERVER_JS', source: `// Managed by jev-mail CLI.\nvar JEV_CONFIG = ${JSON.stringify(config)};\nvar JEV_RELEASE = ${JSON.stringify(VERSION)};\n` },
    { name: 'appsscript', type: 'JSON', source: JSON.stringify(manifest, null, 2) },
  ];
  const current = await client.getContent(state.scriptId);
  const existing = current.files || [];
  if (existing.some((f: any) => f.name === 'Code' && f.source?.trim() && !f.source.includes('jev-mail-owner:v2') && !/^function myFunction\(\)\s*\{\s*\}\s*$/.test(f.source.trim()))) {
    throw new CliError('Remote Code.gs is not a managed Jev-Mail installation. Refusing to overwrite it.', 2);
  }
  const owned = new Set(files.map(f => f.name));
  const preserved = existing.filter((f: any) => !owned.has(f.name)).map((f: any) => ({ name: f.name, type: f.type, source: f.source }));
  const hash = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  const same = files.every(f => existing.some((old: any) => old.name === f.name && old.type === f.type && old.source === f.source));
  if (!allowChanges && state.contentHash && state.contentHash !== hash) throw new CliError('Local configuration or worker code changed. Run config apply or update explicitly, then rerun init.', 2);
  if (!same) await client.putContent(state.scriptId, [...preserved, ...files]);
  if (!same || state.contentHash !== hash || !state.deploymentId) {
    if (!state.deploymentId) {
      const managed = (await client.listDeployments(state.scriptId)).filter(d => d.deploymentConfig?.description === 'Jev-Mail CLI');
      if (managed.length > 1) throw new CliError('Multiple Jev-Mail deployments found. Resolve the duplicate deployments in Apps Script before retrying.', 3);
      if (managed.length === 1) {
        state.deploymentId = managed[0].deploymentId;
        await writePrivate(installationPath, state);
      }
    }
    const version = await client.createVersion(state.scriptId);
    let deployment: any;
    if (state.deploymentId) deployment = await client.updateDeployment(state.scriptId, state.deploymentId, version.versionNumber);
    else deployment = await client.createDeployment(state.scriptId, version.versionNumber);
    state.deploymentId = deployment.deploymentId;
    if (!state.deploymentId) throw new CliError('Google did not return a deployment ID.', 4);
  }
  state.contentHash = hash; state.version = VERSION; state.configPath = configPath;
  await writePrivate(installationPath, state);
  return !same;
}
async function checkInterval(client: GoogleClient, state: BoundInstallation) {
  const raw: any = await client.run(state.deploymentId!, 'status');
  const remote = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (remote.triggerIntervalMatches === false) throw new CliError('Code uploaded. Run installTrigger in the Apps Script editor to apply the new timer interval.', 3, { steps: [editor(state.scriptId)] });
}
function setupInstructions(state: BoundInstallation) {
  return [
    `Account: ${state.accountEmail || '(not yet verified)'}`,
    `GAS code uploaded: ${editor(state.scriptId)}`,
    `1. Open Project Settings: ${settings(state.scriptId)}`,
    `2. Under Google Cloud Platform project, select Change project and enter ${state.projectNumber}. This MUST be the project that owns your Desktop OAuth client.`,
    '3. In the editor, select installTrigger and click Run. Complete Google permission approval. This creates one paused timer; classification is NOT enabled yet.',
    '4. Run jev-mail init again. The CLI checks access and securely sets the TypeSafe key.',
    'Then run jev-mail preview --limit 10, followed by jev-mail enable.',
  ];
}
async function init() {
  const config = await ensureConfig();
  if (!args.credentials && !(await readJson(credentialsPath))) {
    const guide = 'Create a Google Cloud project, enable Apps Script API and Gmail API, configure OAuth consent (add yourself as test user), create a Desktop app OAuth client and download its JSON. Also enable Apps Script API at https://script.google.com/home/usersettings.\nCloud console: https://console.cloud.google.com/apis/credentials';
    if (args.json || !process.stdin.isTTY) throw new CliError(guide + '\nRun init --credentials /path/client.json --project-number NUMBER.', 3);
    process.stderr.write(guide + '\n');
    args.credentials = await ask('Path to downloaded Desktop OAuth JSON');
  }
  let state = await readJson<BoundInstallation>(installationPath);
  const projectNumber = args['project-number'] || state?.projectNumber || (!args.json && process.stdin.isTTY ? await ask('Google Cloud project NUMBER (not project ID)') : '');
  if (!/^\d{6,30}$/.test(projectNumber)) throw new CliError('Supply --project-number with the numeric Google Cloud project number.', 2);
  if (state && state.projectNumber !== projectNumber) throw new CliError('Project number differs from this installation. Use the original number or a separate --home directory.', 2);
  const client = await google(true);
  const accountEmail = await client.getAccountEmail();
  if (state?.accountEmail && state.accountEmail !== accountEmail) throw new CliError('Account mismatch. Use a separate --home directory.', 3);
  if (!state) {
    const project = await client.createProject('Jev-Mail');
    state = { schemaVersion: 1, scriptId: project.scriptId, projectNumber, accountEmail, createdAt: new Date().toISOString() };
    await writePrivate(installationPath, state);
  }
  state.accountEmail = accountEmail;
  await publish(client, state, config, false);
  let remote: any;
  try { remote = await client.run(state.deploymentId!, 'status'); if (typeof remote === 'string') remote = JSON.parse(remote); }
  catch (error) {
    if (!(error instanceof GoogleApiError) || ![401, 403, 404].includes(error.status)) throw error;
    const steps = setupInstructions(state);
    if (!args.json && !args['no-open']) { try { await openBrowser(settings(state.scriptId)); } catch { /* instructions retained */ } }
    throw new CliError('Google setup needs your one-time browser approval.', 3, { scriptId: state.scriptId, steps });
  }
  if (!remote.apiKeyConfigured || args['replace-key']) {
    let key = process.env.TYPESAFE_API_KEY;
    if (!key && !args.json && process.stdin.isTTY) key = await secret('TypeSafe API key (hidden; stored only in GAS Script Properties)');
    if (!key) throw new CliError('TypeSafe key missing. Set TYPESAFE_API_KEY and rerun init, or run init interactively.', 3);
    await client.run(state.deploymentId!, 'configure', [key]);
  }
  const result: any = await client.run(state.deploymentId!, 'verifySetup');
  const verified = typeof result === 'string' ? JSON.parse(result) : result;
  if (!verified.modelVerified || verified.triggerCount !== 1 || verified.triggerIntervalMatches === false) throw new CliError('Setup verification incomplete. Use init --replace-key for an invalid TypeSafe key and run installTrigger in the Apps Script editor.', 3, { verification: verified, steps: setupInstructions(state) });
  emit({ installed: true, accountEmail, scriptId: state.scriptId, configPath, verification: verified, next: ['jev-mail preview --limit 10', 'jev-mail enable'] });
}
async function configCommand() {
  if (subcommand === 'migrate') {
    if (!args.from) throw new CliError('Use config migrate --from legacy-taxonomy.json --config new-config.yaml.', 2);
    try { await fs.access(configPath); throw new CliError(`Refusing to overwrite existing configuration: ${configPath}`, 2); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    const migrated = parseLegacyJsonConfig(await fs.readFile(path.resolve(args.from), 'utf8'), { mode: 'label-only' });
    await writeConfig(migrated); emit({ migrated: true, configPath, mode: 'label-only', applied: false }); return;
  }
  if (subcommand === 'init') {
    try { await fs.access(configPath); throw new CliError(`Configuration already exists: ${configPath}. Use config edit or edit the YAML.`, 2); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    await writeConfig(DEFAULT_CONFIG); emit({ configPath }, `Created ${configPath}`); return;
  }
  if (subcommand === 'show') { const config = await loadConfig(); emit(config, stringifyConfigYaml(config)); return; }
  if (subcommand === 'validate') { await loadConfig(); emit({ valid: true, configPath }, `Configuration valid: ${configPath}`); return; }
  if (subcommand === 'edit') {
    if (args.json) throw new CliError('config edit is interactive. Edit YAML or use add-label/remove-label/set-mode with --json.', 2);
    await writeConfig(await customize(structuredClone(await loadConfig()))); emit({ configPath, applied: false }, 'Saved locally. Run jev-mail config apply to update GAS.'); return;
  }
  const config: any = await loadConfig();
  if (subcommand === 'add-label') {
    if (!args.key || !args.label || !args.description || !['true', 'false'].includes(args.archive || '')) throw new CliError('Use --key KEY --label LABEL --description RULE --archive true|false.', 2);
    config.categories.push({ key: args.key, label: args.label, description: args.description, examples: [args.description], archive: args.archive === 'true' });
    await writeConfig(config); emit({ configPath, applied: false }); return;
  }
  if (subcommand === 'remove-label') {
    if (!args.key || !config.categories.some((c: any) => c.key === args.key)) throw new CliError('Supply --key of an existing category.', 2);
    config.categories = config.categories.filter((c: any) => c.key !== args.key);
    await writeConfig(config); emit({ configPath, applied: false }); return;
  }
  if (subcommand === 'set-mode') {
    config.runtime.mode = args.mode; await writeConfig(config); emit({ configPath, mode: args.mode, applied: false }); return;
  }
  if (subcommand === 'apply') {
    const { state, client } = await boundClient();
    const changed = await publish(client, state, config);
    await checkInterval(client, state);
    emit({ applied: true, changed, scriptId: state.scriptId, note: 'Existing mail is not reclassified solely because settings changed.' }); return;
  }
  throw new CliError('Use config init|migrate|show|validate|edit|add-label|remove-label|set-mode|apply.', 2);
}
const help = `jev-mail ${VERSION}\nCLI-managed, always-on Gmail classification with Jev + Google Apps Script.\n\nFirst use:\n  jev-mail init --credentials ./client.json --project-number NUMBER\n  jev-mail preview --limit 10\n  jev-mail enable\n\nCommands:\n  init                 Resume-safe installation and Google authorization guide\n  preview --limit N    Classify up to 20 inbox threads without Gmail changes (API usage applies)\n  enable / disable     Resume / pause the cloud worker\n  status               Read actual cloud worker status\n  doctor               Check local configuration and remote setup\n  update               Publish this CLI's worker version\n  config init|show|validate|edit|apply\n  config migrate --from old-taxonomy.json --config new-config.yaml\n  config add-label --key KEY --label LABEL --description RULE --archive true|false\n  config remove-label --key KEY\n  config set-mode --mode label-only|archive\n\nOptions:\n  --home DIR           Separate installation/account (default ~/.config/jev-mail)\n  --config FILE        YAML configuration path\n  --json               Machine-readable output; no interactive prompts\n  --replace-key        Validate and replace the TypeSafe key during init\n  --reauthorize        Reconnect Google during init after revoked/expired authorization\n  --no-open            Print browser links without opening them\n\nGoogle setup: your own Desktop OAuth client, Apps Script + Gmail APIs enabled,\nOAuth consent/test user, Apps Script API enabled in script.google.com/home/usersettings.\nThe CLI uploads code. You link its Cloud project and run installTrigger in the editor once.\nNo public web app, third-party server, or always-on local process is required.\nSecrets: use the masked init prompt or TYPESAFE_API_KEY, never a command-line flag.\nExit codes: 0 success, 1 failure, 2 invalid config/usage, 3 authorization/setup needed, 4 remote failure.\n`;
async function main() {
  if (args.version) { emit({ version: VERSION }, VERSION); return; }
  if (args.help || command === 'help') { emit({ help }, help); return; }
  if (!args.config) {
    const saved = await readJson<BoundInstallation>(installationPath);
    if (saved?.configPath) configPath = saved.configPath;
  }
  if (command === 'init') return init();
  if (command === 'config') return configCommand();
  if (command === 'preview') {
    const limit = Number(args.limit || 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new CliError('--limit must be an integer from 1 to 20.', 2);
    emit(await invoke('previewInbox', [limit])); return;
  }
  if (command === 'status') { emit(await invoke('status')); return; }
  if (command === 'enable' || command === 'disable') { emit(await invoke('setEnabled', [command === 'enable'])); return; }
  if (command === 'doctor') { await loadConfig(); const remote = await invoke('verifySetup'); emit({ localConfigValid: true, remote }); if (!remote.modelVerified || remote.triggerCount !== 1 || remote.triggerIntervalMatches === false) process.exitCode = 3; return; }
  if (command === 'update') {
    const config = await loadConfig(); const { state, client } = await boundClient();
    const updated = await publish(client, state, config);
    await checkInterval(client, state);
    emit({ updated, version: VERSION, scriptId: state.scriptId }); return;
  }
  throw new CliError(`Unknown command: ${command}. Run jev-mail help.`, 2);
}
async function withLock(operation: () => Promise<void>) {
  if (args.help || args.version || ['help', 'status', 'preview', 'doctor'].includes(command) || (command === 'config' && ['show', 'validate'].includes(subcommand))) return operation();
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  const lock = path.join(home, '.cli-lock');
  try { await fs.mkdir(lock); }
  catch (error: any) { if (error.code === 'EEXIST') throw new CliError(`Another command owns ${lock}. If no jev-mail command is running, remove that directory and retry.`, 2); throw error; }
  const interrupt = () => { void fs.rm(lock, { recursive: true, force: true }).finally(() => process.exit(130)); };
  const terminate = () => { void fs.rm(lock, { recursive: true, force: true }).finally(() => process.exit(143)); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try { await writePrivate(path.join(lock, 'owner.json'), { pid: process.pid }); await operation(); }
  finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
    await fs.rm(lock, { recursive: true, force: true });
  }
}
withLock(main).catch((error: any) => {
  const code = error instanceof CliError ? error.code : error instanceof GoogleApiError ? ([401, 403].includes(error.status) ? 3 : 4) : 1;
  // Never include API payloads, tokens, environment values, or stack traces.
  const message = String(error.message || 'Command failed').replaceAll(process.env.TYPESAFE_API_KEY || '\0', '[redacted]');
  emit({ ok: false, error: message, ...(error.details ? { details: error.details } : {}) }, `${message}${error.details?.steps ? '\n\n' + error.details.steps.join('\n') : ''}`);
  process.exitCode = code;
});
