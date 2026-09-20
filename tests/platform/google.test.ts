import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GoogleClient, authorize, createTokenProvider, parseDesktopCredentials, refreshAccessToken } from '../../src/platform/google.ts';

const credentials = parseDesktopCredentials({ installed: { client_id: 'test-client', client_secret: 'test-secret' } });

test('desktop credential parser rejects wrong client type and malformed JSON', () => {
  assert.equal(credentials.client_id, 'test-client');
  assert.equal(parseDesktopCredentials({ installed: { client_id: 'legacy', auth_uri: 'https://accounts.google.com/o/oauth2/auth' } }).client_id, 'legacy');
  assert.throws(() => parseDesktopCredentials('{'), /Invalid/);
  assert.throws(() => parseDesktopCredentials({ web: { client_id: 'web-client' } }), /Desktop/);
});

test('OAuth loopback exchanges a state and PKCE validated code', async () => {
  let tokenBody: URLSearchParams | undefined;
  const tokens = await authorize(credentials, {
    openBrowser: async url => {
      const auth = new URL(url);
      assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(auth.searchParams.get('access_type'), 'offline');
      const callback = new URL(auth.searchParams.get('redirect_uri')!);
      callback.searchParams.set('state', auth.searchParams.get('state')!);
      callback.searchParams.set('code', 'auth-code');
      const response = await fetch(callback);
      assert.equal(response.status, 200);
    },
    fetchFn: (async (_url, init) => {
      tokenBody = new URLSearchParams(init?.body as string);
      return new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }), { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(tokens.refresh_token, 'refresh');
  assert.equal(tokenBody?.get('code'), 'auth-code');
  assert.ok(tokenBody?.get('code_verifier'));
});

test('OAuth rejects an incorrect state without exchanging a code', async () => {
  let exchanged = false;
  await assert.rejects(authorize(credentials, {
    openBrowser: async url => {
      const callback = new URL(new URL(url).searchParams.get('redirect_uri')!);
      callback.searchParams.set('state', 'wrong');
      callback.searchParams.set('code', 'auth-code');
      assert.equal((await fetch(callback)).status, 400);
    },
    fetchFn: (async () => { exchanged = true; throw new Error('unexpected'); }) as typeof fetch,
  }), /state/);
  assert.equal(exchanged, false);
});

test('refresh preserves the refresh token and serializes concurrent refreshes', async () => {
  let calls = 0;
  let saved: any;
  const mockFetch = (async (_url: string, init?: RequestInit) => {
    calls++;
    const params = new URLSearchParams(init?.body as string);
    assert.equal(params.get('grant_type'), 'refresh_token');
    assert.equal(params.get('refresh_token'), 'old-refresh');
    return new Response(JSON.stringify({ access_token: 'new-access', expires_in: 3600 }), { status: 200 });
  }) as typeof fetch;
  const direct = await refreshAccessToken(credentials, 'old-refresh', mockFetch);
  assert.equal(direct.refresh_token, 'old-refresh');
  const provider = createTokenProvider(credentials, {
    load: async () => saved || { access_token: 'expired', refresh_token: 'old-refresh', expires_at: 0 },
    save: async tokens => { saved = tokens; },
  }, mockFetch);
  assert.deepEqual(await Promise.all([provider(), provider()]), ['new-access', 'new-access']);
  assert.equal(calls, 2);
  assert.equal(saved.refresh_token, 'old-refresh');
});

test('revoked refresh token asks for reconnection without leaking the token', async () => {
  const provider = createTokenProvider(credentials, {
    load: async () => ({ access_token: 'expired', refresh_token: 'private-refresh', expires_at: 0 }),
    save: async () => { throw new Error('unexpected save'); },
  }, (async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'private-refresh' }), { status: 400 })) as typeof fetch);
  await assert.rejects(provider(), error => {
    assert.match(String(error), /jev-mail init --reauthorize/);
    assert.doesNotMatch(String(error), /private-refresh/);
    return true;
  });
});

test('project API uses bearer auth, pages deployments, and unwraps run result', async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const mockFetch = (async (rawUrl: string, init: RequestInit) => {
    const url = new URL(rawUrl);
    calls.push({ url, init });
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-access');
    if (url.pathname.endsWith('/deployments') && !url.search) return new Response(JSON.stringify({ deployments: [{ deploymentId: 'd1' }], nextPageToken: 'next' }));
    if (url.pathname.endsWith('/deployments')) return new Response(JSON.stringify({ deployments: [{ deploymentId: 'd2' }] }));
    if (url.pathname.endsWith(':run')) return new Response(JSON.stringify({ response: { result: { enabled: true } } }));
    return new Response(JSON.stringify({ scriptId: 's1', versionNumber: 1 }));
  }) as typeof fetch;
  const client = new GoogleClient(async () => 'test-access', mockFetch);
  assert.equal((await client.createProject('Jev-Mail')).scriptId, 's1');
  assert.equal((await client.listDeployments('s1')).length, 2);
  assert.deepEqual(await client.run('d1', 'status'), { enabled: true });
  assert.equal(calls[0].url.pathname, '/v1/projects');
  assert.equal(calls[2].url.searchParams.get('pageToken'), 'next');
  assert.equal(JSON.parse(calls[3].init.body as string).function, 'status');
});

test('API errors cannot leak server error messages or credentials', async () => {
  const client = new GoogleClient(async () => 'secret-access', (async () =>
    new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'secret-access' } }), { status: 403 })) as typeof fetch);
  await assert.rejects(client.getProject('s1'), error => {
    assert.match(String(error), /PERMISSION_DENIED/);
    assert.doesNotMatch(String(error), /secret-access/);
    return true;
  });
});

test('deployment payloads and account identity use the expected APIs', async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const client = new GoogleClient(async () => 'access', (async (rawUrl: string, init: RequestInit) => {
    const url = new URL(rawUrl);
    calls.push({ url, init });
    if (url.hostname === 'gmail.googleapis.com') return new Response(JSON.stringify({ emailAddress: 'owner@example.com' }));
    return new Response(JSON.stringify({ deploymentId: 'd1', files: [], versionNumber: 3 }));
  }) as typeof fetch);
  assert.equal(await client.getAccountEmail(), 'owner@example.com');
  await client.putContent('s1', [{ name: 'Code', type: 'SERVER_JS', source: 'function run() {}' }]);
  await client.createVersion('s1');
  await client.createDeployment('s1', 3);
  await client.updateDeployment('s1', 'd1', 3);
  assert.equal(calls[0].url.pathname, '/gmail/v1/users/me/profile');
  assert.equal(JSON.parse(calls[1].init.body as string).files[0].name, 'Code');
  assert.equal(JSON.parse(calls[3].init.body as string).manifestFileName, 'appsscript');
  assert.deepEqual(JSON.parse(calls[4].init.body as string).deploymentConfig, {
    scriptId: 's1', versionNumber: 3, manifestFileName: 'appsscript', description: 'Jev-Mail CLI',
  });
});

test('script execution failure is reported without exposing script exception details', async () => {
  const client = new GoogleClient(async () => 'access', (async () =>
    new Response(JSON.stringify({ done: true, error: { message: 'private API key in exception' } }))) as typeof fetch);
  await assert.rejects(client.run('d1', 'status'), error => {
    assert.match(String(error), /SCRIPT_EXECUTION_FAILED/);
    assert.doesNotMatch(String(error), /private API key/);
    return true;
  });
});
