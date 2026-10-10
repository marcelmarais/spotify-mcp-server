import assert from 'node:assert/strict';
import { request } from 'node:http';
import { beforeEach, test } from 'node:test';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import {
  authOptionsFromEnv,
  formatHost,
  resetTokenValidationCache,
  serveHttp,
} from '../build/http.js';
import { createServer } from '../build/server.js';
import { SPOTIFY_SCOPES } from '../build/utils.js';
import { resultText } from './helpers.js';

const METADATA = '/.well-known/oauth-protected-resource';

// The token-validation memo lives in the http module and would otherwise
// carry validated tokens across tests within this process.
beforeEach(resetTokenValidationCache);

/**
 * Like mockHttp from helpers.js, but only intercepts Spotify API calls and
 * lets the MCP client's own fetches to the local server pass through (the
 * stdio-based helper cannot be used with StreamableHTTPClientTransport, whose
 * client also uses globalThis.fetch).
 *
 * The /me token-validation ping (issued by the HTTP transport when a Bearer
 * token first appears) is answered here without consuming a queued step, so
 * queued steps remain the actual tool calls. Set meStatus to 401 to simulate
 * a token Spotify rejects.
 */
function mockSpotify(t, expected, { meStatus = 200 } = {}) {
  let index = 0;
  const requests = [];
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const request = new Request(input, options);
    if (!request.url.startsWith('https://api.spotify.com/')) {
      return realFetch(input, options);
    }
    const body = await request.text();
    requests.push({ url: request.url, method: request.method, body });
    if (request.url === 'https://api.spotify.com/v1/me') {
      return new Response(JSON.stringify({ id: 'me' }), {
        status: meStatus,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const step = expected[index++];
    assert.ok(step, `Unexpected request: ${request.method} ${request.url}`);
    assert.equal(
      request.url,
      step.url.startsWith('https:')
        ? step.url
        : `https://api.spotify.com/v1/${step.url}`,
    );
    assert.equal(request.method, step.method ?? 'GET');
    assert.equal(
      request.headers.get('authorization'),
      step.authorization ?? 'Bearer test-access',
    );
    if (step.body !== undefined) assert.deepEqual(JSON.parse(body), step.body);
    return new Response(
      step.response === undefined ? null : JSON.stringify(step.response),
      {
        status: step.status ?? (step.response === undefined ? 204 : 200),
        headers: { 'Content-Type': 'application/json' },
      },
    );
  });
  t.after(() => assert.equal(index, expected.length, JSON.stringify(requests)));
  return requests;
}

function raw(
  port,
  { method = 'POST', path = '/mcp', headers = {}, body = '' } = {},
) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Host: `127.0.0.1:${port}`,
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: data }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

const initialize = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' },
  },
});

async function startAuthServer(t) {
  const auth = {
    authorizationServers: ['https://accounts.spotify.com'],
    resolveResourceUrl: () => 'http://127.0.0.1:3000',
  };
  const server = await serveHttp(
    createServer,
    { host: '127.0.0.1', port: 0 },
    auth,
  );
  t.after(() => server.close());
  return { port: server.address().port };
}

async function startPlainServer(t) {
  const server = await serveHttp(createServer, { host: '127.0.0.1', port: 0 });
  t.after(() => server.close());
  return server.address().port;
}

test('authOptionsFromEnv is opt-in and configurable', () => {
  assert.equal(
    authOptionsFromEnv({}, { host: '127.0.0.1', port: 3000 }),
    undefined,
  );
  const base = { host: '127.0.0.1', port: 4123 };
  const plain = authOptionsFromEnv({ MCP_AUTH: 'spotify' }, base);
  assert.deepEqual(plain.authorizationServers, [
    'https://accounts.spotify.com',
  ]);
  assert.equal(plain.resolveResourceUrl(), 'http://127.0.0.1:4123');
  assert.equal(plain.explicitResourceUrl, undefined);
  assert.equal(
    authOptionsFromEnv(
      {
        MCP_AUTH: 'spotify',
        SPOTIFY_RESOURCE_URL: 'http://mcphub.example:3000',
      },
      base,
    ).resolveResourceUrl(),
    'http://mcphub.example:3000',
  );
  assert.equal(
    authOptionsFromEnv(
      {
        MCP_AUTH: 'spotify',
        SPOTIFY_AUTHORIZATION_SERVERS: 'https://a.example,https://b.example',
      },
      base,
    ).authorizationServers.join(','),
    'https://a.example,https://b.example',
  );
});

test('unauthenticated /mcp request gets 401 with WWW-Authenticate', async (t) => {
  const { port } = await startAuthServer(t);
  const response = await raw(port);
  assert.equal(response.status, 401);
  assert.match(
    response.headers['www-authenticate'],
    /Bearer realm="spotify", resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource"/,
  );
});

test('malformed Authorization header still gets 401', async (t) => {
  const { port } = await startAuthServer(t);
  for (const value of ['', 'Bearer', 'Token abc', 'bearer abc']) {
    const response = await raw(port, {
      headers: { Authorization: value },
    });
    assert.equal(response.status, 401, value);
  }
});

test('protected resource metadata advertises Spotify as authorization server', async (t) => {
  const { port } = await startAuthServer(t);
  const response = await raw(port, { method: 'GET', path: METADATA });
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'application/json');
  const metadata = JSON.parse(response.body);
  assert.deepEqual(metadata.authorization_servers, [
    'https://accounts.spotify.com',
  ]);
  assert.match(metadata.resource, /^http:\/\/127\.0\.0\.1:\d+$/);
  // Metadata stays reachable even for unauthenticated MCP requests that
  // were rejected first.
  assert.equal((await raw(port)).status, 401);
  assert.equal(
    (await raw(port, { method: 'GET', path: METADATA })).status,
    200,
  );
});

test('metadata advertises the full required scope set', async (t) => {
  const { port } = await startAuthServer(t);
  const response = await raw(port, { method: 'GET', path: METADATA });
  const metadata = JSON.parse(response.body);
  assert.deepEqual(metadata.scopes_supported, [...SPOTIFY_SCOPES]);
  assert.equal(metadata.scopes_supported.length, 15);
});

test('metadata endpoint is absent without auth mode', async (t) => {
  const port = await startPlainServer(t);
  const response = await raw(port, { method: 'GET', path: METADATA });
  assert.equal(response.status, 404);
});

test('MCP round trip with Bearer token works end to end', async (t) => {
  const { port } = await startAuthServer(t);
  // The transport validates the first-seen Bearer token with a /me ping, so
  // the mock must be installed before the client connects.
  mockSpotify(t, [
    {
      url: 'me/player/devices',
      authorization: 'Bearer oauth-test-token',
      response: { devices: [] },
    },
  ]);
  const client = new Client(
    { name: 'spotify-test', version: '1.0.0' },
    { versionNegotiation: { mode: 'legacy' } },
  );
  t.after(() => {
    resetTokenValidationCache();
    return client.close();
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: {
        headers: { Authorization: 'Bearer oauth-test-token' },
      },
    }),
  );
  const { tools } = await client.listTools();
  assert.ok(tools.length > 0);

  // The Bearer token must reach the Spotify API, not the config file:
  // no spotify-config.json exists in the repo, so a fallback to it would
  // throw.
  const result = await client.callTool({
    name: 'getAvailableDevices',
    arguments: {},
  });
  assert.match(resultText(result), /No available devices/);
});

test('each request carries its own token', async (t) => {
  const { port } = await startAuthServer(t);
  const client = new Client(
    { name: 'spotify-test', version: '1.0.0' },
    { versionNegotiation: { mode: 'legacy' } },
  );
  t.after(() => {
    resetTokenValidationCache();
    return client.close();
  });
  // Simulate MCPHub refreshing: a fresh access token per request. The
  // server must not cache the old one into the Spotify API client.
  const transports = ['Bearer first-token', 'Bearer rotated-token'];
  let i = 0;
  mockSpotify(t, [
    {
      url: 'me/player/devices',
      authorization: transports[0],
      response: { devices: [] },
    },
    {
      url: 'me/player/devices',
      authorization: transports[1],
      response: { devices: [] },
    },
  ]);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: {
        headers: { Authorization: 'Bearer first-token' },
      },
    }),
  );
  for (const token of transports) {
    // A fresh client transport per token, mirroring a reconnect after refresh.
    const client2 = new Client(
      { name: `spotify-test-${i}`, version: '1.0.0' },
      { versionNegotiation: { mode: 'legacy' } },
    );
    t.after(() => client2.close());
    await client2.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
        {
          requestInit: { headers: { Authorization: token } },
        },
      ),
    );
    const result = await client2.callTool({
      name: 'getAvailableDevices',
      arguments: {},
    });
    assert.match(resultText(result), /No available devices/);
    i += 1;
  }
  await client.close();
});

test('removeUsersSavedTracks uses the Bearer token, not the config file', async (t) => {
  const { port } = await startAuthServer(t);
  // No spotify-config.json exists in the repo: if the tool fell back to the
  // config-file token it would throw here instead of deleting with the
  // Bearer token.
  mockSpotify(t, [
    {
      url: 'me/library?uris=spotify%3Atrack%3Atrack1',
      method: 'DELETE',
      authorization: 'Bearer oauth-remove-token',
    },
  ]);
  const client = new Client(
    { name: 'spotify-test', version: '1.0.0' },
    { versionNegotiation: { mode: 'legacy' } },
  );
  t.after(() => {
    resetTokenValidationCache();
    return client.close();
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: {
        headers: { Authorization: 'Bearer oauth-remove-token' },
      },
    }),
  );
  const result = await client.callTool({
    name: 'removeUsersSavedTracks',
    arguments: { trackIds: ['track1'] },
  });
  assert.match(resultText(result), /Successfully removed 1 track/);
});

test('a first-seen Bearer token is validated against Spotify once', async (t) => {
  const { port } = await startAuthServer(t);
  const requests = mockSpotify(t, [], { meStatus: 200 });
  // Distinct token so this test never reuses a memoised validation.
  const response = await raw(port, {
    headers: { Authorization: 'Bearer validation-token-a' },
    body: initialize,
  });
  assert.equal(response.status, 200);
  assert.equal(requests.filter((r) => r.url.endsWith('/v1/me')).length, 1);
  assert.equal(requests[0].url, 'https://api.spotify.com/v1/me');
});

test('a Bearer token Spotify rejects gets 401 invalid_token', async (t) => {
  const { port } = await startAuthServer(t);
  mockSpotify(t, [], { meStatus: 401 });
  const response = await raw(port, {
    headers: { Authorization: 'Bearer invalid-token-b' },
    body: initialize,
  });
  assert.equal(response.status, 401);
  const header = response.headers['www-authenticate'];
  assert.match(header, /error="invalid_token"/);
  assert.match(
    header,
    /resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource"/,
  );
});

test('a Spotify validation outage does not pass the token through', async (t) => {
  const { port } = await startAuthServer(t);
  mockSpotify(t, [], { meStatus: 500 });
  const response = await raw(port, {
    headers: { Authorization: 'Bearer outage-token-c' },
    body: initialize,
  });
  assert.equal(response.status, 502);
  assert.match(response.headers['www-authenticate'], /error="server_error"/);
});

test('formatHost stays importable for metadata resource URLs', () => {
  assert.equal(formatHost('::1'), '[::1]');
  assert.equal(formatHost('127.0.0.1'), '127.0.0.1');
});

test('authOptionsFromEnv surfaces explicitResourceUrl only when set', () => {
  const base = { host: '0.0.0.0', port: 3000 };
  // Unset: no explicit URL, the caller must derive it from the bound socket.
  assert.equal(
    authOptionsFromEnv({ MCP_AUTH: 'spotify' }, base).explicitResourceUrl,
    undefined,
  );
  // Set: the explicit URL wins, e.g. a Docker service name over 0.0.0.0.
  const explicit = authOptionsFromEnv(
    { MCP_AUTH: 'spotify', SPOTIFY_RESOURCE_URL: 'http://spotify-mcp:3000' },
    base,
  );
  assert.equal(explicit?.explicitResourceUrl, 'http://spotify-mcp:3000');
  assert.equal(explicit?.resolveResourceUrl(), 'http://spotify-mcp:3000');
});

test('metadata serves the explicit resource URL over the bind address', async (t) => {
  // Mirrors the Docker deployment: bound to 0.0.0.0 but the client reaches the
  // server as http://spotify-mcp:3000. The metadata must advertise the explicit
  // URL, never the bind address.
  const auth = {
    authorizationServers: ['https://accounts.spotify.com'],
    explicitResourceUrl: 'http://spotify-mcp:3000',
    resolveResourceUrl: () => 'http://spotify-mcp:3000',
  };
  const server = await serveHttp(
    createServer,
    { host: '0.0.0.0', port: 0 },
    auth,
  );
  t.after(() => server.close());
  const boundPort = server.address().port;
  const response = await raw(boundPort, { method: 'GET', path: METADATA });
  assert.equal(response.status, 200);
  const metadata = JSON.parse(response.body);
  assert.equal(metadata.resource, 'http://spotify-mcp:3000');
  assert.match(metadata.authorization_servers[0], /accounts\.spotify\.com/);
});
