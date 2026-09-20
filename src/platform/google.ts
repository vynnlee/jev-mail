import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const API_ROOT = 'https://script.googleapis.com/v1';
const AUTH_ROOT = 'https://accounts.google.com/o/oauth2/v2/auth';
const LEGACY_AUTH_ROOT = 'https://accounts.google.com/o/oauth2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/script.deployments',
  'https://www.googleapis.com/auth/script.scriptapp',
  'https://www.googleapis.com/auth/script.external_request',
  'https://mail.google.com/',
] as const;

export interface DesktopCredentials {
  client_id: string;
  client_secret?: string;
  auth_uri?: string;
  token_uri?: string;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
}

export interface ScriptFile {
  name: string;
  type: 'SERVER_JS' | 'HTML' | 'JSON';
  source: string;
}

export interface ScriptProject { scriptId: string; title?: string; [key: string]: unknown }
export interface ScriptDeployment {
  deploymentId: string;
  deploymentConfig?: { scriptId: string; versionNumber: number; manifestFileName?: string; description?: string };
  entryPoints?: Array<{ entryPointType: string; [key: string]: unknown }>;
}

export class GoogleApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(`Google API request failed (${status}, ${code}). Check authorization, API access, and project configuration.`);
    this.name = 'GoogleApiError';
  }
}

function safeCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)) return 'UNKNOWN';
  return value;
}

async function readJson(response: Response): Promise<any> {
  try { return await response.json(); } catch { return {}; }
}

export class GoogleClient {
  constructor(private readonly tokenProvider: () => Promise<string>, private readonly fetchFn: typeof fetch = fetch) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.tokenProvider();
    const response = await this.fetchFn(`${API_ROOT}${path}`, {
      method,
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await readJson(response);
    if (!response.ok) throw new GoogleApiError(response.status, safeCode(data?.error?.status || data?.error?.code));
    return data as T;
  }

  createProject(title: string): Promise<ScriptProject> {
    return this.request('POST', '/projects', { title });
  }
  async getAccountEmail(): Promise<string> {
    const token = await this.tokenProvider();
    const response = await this.fetchFn('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
    });
    const data = await readJson(response);
    if (!response.ok) throw new GoogleApiError(response.status, safeCode(data?.error?.status || data?.error?.code));
    if (typeof data.emailAddress !== 'string' || !data.emailAddress) throw new Error('Google account email was not returned.');
    return data.emailAddress;
  }
  getProject(scriptId: string): Promise<ScriptProject> {
    return this.request('GET', `/projects/${encodeURIComponent(scriptId)}`);
  }
  getContent(scriptId: string): Promise<{ files: ScriptFile[] }> {
    return this.request('GET', `/projects/${encodeURIComponent(scriptId)}/content`);
  }
  putContent(scriptId: string, files: ScriptFile[]): Promise<{ files: ScriptFile[] }> {
    return this.request('PUT', `/projects/${encodeURIComponent(scriptId)}/content`, { files });
  }
  createVersion(scriptId: string): Promise<{ versionNumber: number }> {
    return this.request('POST', `/projects/${encodeURIComponent(scriptId)}/versions`, {});
  }
  async listDeployments(scriptId: string): Promise<ScriptDeployment[]> {
    const deployments: ScriptDeployment[] = [];
    let pageToken: string | undefined;
    do {
      const query = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '';
      const page = await this.request<{ deployments?: ScriptDeployment[]; nextPageToken?: string }>('GET', `/projects/${encodeURIComponent(scriptId)}/deployments${query}`);
      deployments.push(...(page.deployments || []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return deployments;
  }
  createDeployment(scriptId: string, versionNumber: number): Promise<ScriptDeployment> {
    return this.request('POST', `/projects/${encodeURIComponent(scriptId)}/deployments`, {
      versionNumber, manifestFileName: 'appsscript', description: 'Jev-Mail CLI',
    });
  }
  updateDeployment(scriptId: string, deploymentId: string, versionNumber: number): Promise<ScriptDeployment> {
    return this.request('PUT', `/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`, {
      deploymentConfig: { scriptId, versionNumber, manifestFileName: 'appsscript', description: 'Jev-Mail CLI' },
    });
  }
  async run<T = unknown>(deploymentId: string, functionName: string, parameters: unknown[] = [], devMode = false): Promise<T> {
    const data = await this.request<{ done?: boolean; response?: { result?: T }; error?: { details?: unknown[] } }>('POST', `/scripts/${encodeURIComponent(deploymentId)}:run`, {
      function: functionName, parameters, devMode,
    });
    if (data.error) throw new GoogleApiError(200, 'SCRIPT_EXECUTION_FAILED');
    if (data.done === false) throw new GoogleApiError(200, 'SCRIPT_EXECUTION_INCOMPLETE');
    return data.response?.result as T;
  }
}

export function parseDesktopCredentials(input: string | unknown): DesktopCredentials {
  let value: any;
  try { value = typeof input === 'string' ? JSON.parse(input) : input; }
  catch { throw new Error('Invalid Google OAuth client JSON.'); }
  const credentials = value?.installed;
  if (!credentials || typeof credentials.client_id !== 'string' || !credentials.client_id.trim() ||
      (credentials.client_secret !== undefined && typeof credentials.client_secret !== 'string') ||
      (credentials.auth_uri !== undefined && ![AUTH_ROOT, LEGACY_AUTH_ROOT].includes(credentials.auth_uri)) ||
      (credentials.token_uri !== undefined && credentials.token_uri !== TOKEN_URL)) {
    throw new Error('Expected a Google Desktop OAuth client JSON with an installed client_id.');
  }
  return { client_id: credentials.client_id, client_secret: credentials.client_secret,
    auth_uri: credentials.auth_uri, token_uri: credentials.token_uri };
}

function tokenParams(credentials: DesktopCredentials): URLSearchParams {
  const params = new URLSearchParams({ client_id: credentials.client_id });
  if (credentials.client_secret) params.set('client_secret', credentials.client_secret);
  return params;
}

async function exchangeToken(credentials: DesktopCredentials, params: URLSearchParams, fetchFn: typeof fetch): Promise<GoogleTokens> {
  const response = await fetchFn(credentials.token_uri || TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await readJson(response);
  if (!response.ok || typeof data.access_token !== 'string' || !data.access_token) {
    throw new GoogleApiError(response.status, safeCode(data.error));
  }
  return {
    access_token: data.access_token,
    ...(typeof data.refresh_token === 'string' ? { refresh_token: data.refresh_token } : {}),
    expires_at: Date.now() + Math.max(0, Number(data.expires_in) || 3600) * 1000,
    token_type: data.token_type, scope: data.scope, id_token: data.id_token,
  };
}

export async function refreshAccessToken(credentials: DesktopCredentials, refreshToken: string, fetchFn: typeof fetch = fetch): Promise<GoogleTokens> {
  const params = tokenParams(credentials);
  params.set('grant_type', 'refresh_token');
  params.set('refresh_token', refreshToken);
  const tokens = await exchangeToken(credentials, params, fetchFn);
  return { ...tokens, refresh_token: tokens.refresh_token || refreshToken };
}

export interface TokenStorage {
  load(): Promise<GoogleTokens | undefined>;
  save(tokens: GoogleTokens): Promise<void>;
}

export function createTokenProvider(credentials: DesktopCredentials, storage: TokenStorage, fetchFn: typeof fetch = fetch): () => Promise<string> {
  let pending: Promise<string> | undefined;
  return async () => {
    if (pending) return pending;
    pending = (async () => {
      const existing = await storage.load();
      if (!existing) throw new Error('Google account is not connected. Run onboarding first.');
      if (existing.access_token && existing.expires_at > Date.now() + 60_000) return existing.access_token;
      if (!existing.refresh_token) throw new Error('Google authorization expired. Run jev-mail init --reauthorize.');
      let refreshed: GoogleTokens;
      try { refreshed = await refreshAccessToken(credentials, existing.refresh_token, fetchFn); }
      catch (error) {
        if (error instanceof GoogleApiError && error.code === 'invalid_grant') throw new Error('Google authorization expired or was revoked. Run jev-mail init --reauthorize.');
        throw error;
      }
      await storage.save(refreshed);
      return refreshed.access_token;
    })();
    try { return await pending; } finally { pending = undefined; }
  };
}

function openUrl(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

export interface AuthorizeOptions {
  openBrowser?: (url: string) => void | Promise<void>;
  onUrl?: (url: string) => void | Promise<void>;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export async function authorize(credentials: DesktopCredentials, options: AuthorizeOptions = {}): Promise<GoogleTokens> {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('OAuth callback server unavailable.'); }
  const redirectUri = `http://127.0.0.1:${address.port}/callback`;
  const authUrl = new URL(AUTH_ROOT);
  authUrl.search = new URLSearchParams({ client_id: credentials.client_id, redirect_uri: redirectUri,
    response_type: 'code', scope: GOOGLE_SCOPES.join(' '), access_type: 'offline', prompt: 'consent',
    state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();

  let timer: NodeJS.Timeout | undefined;
  try {
    const codePromise = new Promise<string>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Google sign-in timed out. Run init again to open a fresh authorization link.')), options.timeoutMs ?? 15 * 60_000);
      server.on('request', (request, response) => {
        const url = new URL(request.url || '/', redirectUri);
        if (request.method !== 'GET' || url.pathname !== '/callback') {
          response.writeHead(404).end(); return;
        }
        const receivedState = url.searchParams.get('state') || '';
        const a = Buffer.from(receivedState), b = Buffer.from(state);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          response.writeHead(400).end('Invalid authorization state.');
          reject(new Error('Google sign-in state did not match.')); return;
        }
        const error = url.searchParams.get('error');
        const code = url.searchParams.get('code');
        if (error || !code) {
          response.writeHead(400).end('Google authorization was not completed.');
          reject(new Error('Google authorization was not completed.')); return;
        }
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Google account connected. You may close this tab.');
        resolve(code);
      });
    });
    // Attach a rejection handler before browser launch, which can fail synchronously.
    void codePromise.catch(() => {});
    if (options.onUrl) await options.onUrl(authUrl.toString());
    await (options.openBrowser || openUrl)(authUrl.toString());
    const code = await codePromise;
    const params = tokenParams(credentials);
    params.set('grant_type', 'authorization_code');
    params.set('code', code);
    params.set('redirect_uri', redirectUri);
    params.set('code_verifier', verifier);
    return await exchangeToken(credentials, params, options.fetchFn || fetch);
  } finally {
    if (timer) clearTimeout(timer);
    server.close();
  }
}
