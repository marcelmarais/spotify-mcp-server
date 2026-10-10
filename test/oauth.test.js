import assert from 'node:assert/strict';
import { request } from 'node:http';
import test from 'node:test';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { authOptionsFromEnv, formatHost, serveHttp } from '../build/http.js';
import { createServer } from '../build/server.js';
import { resultText } from './helpers.js';

const METADATA = '/.well-known/oauth-protected-resource';

/**
 * Like mockHttp from helpers.js, but only intercepts Spotify API calls and
 * lets the MCP client's own fetches to the local server pass through (the
 * stdio-based helper cannot be used with StreamableHTTPClientTransport, whose
 * client also uses globalThis.fetch).
 */
function mockSpotify(t, expected) {
  let index = 0;
  const realFetch = globalThis.fetch;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const request = new Request(input, options);
    if (!request.url.startsWith('https://api.spotify.com/')) {
      return realFetch(input, options);
    }
    const body = await request.text();
    requests.push({ url: request.url, method: request.method, body });
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

async function startAuthServer(t, { port = 0 } = {}) {
  const auth = {
    authorizationServers: ['https://accounts.spotify.com'],
    resourceUrl: 'http://127.0.0.1:3000',
    resourceMetadataUrl:
      'http://127.0.0.1:3000/.well-known/oauth-protected-resource',
  };
  const server = await serveHttp(
    createServer,
    { host: '127.0.0.1', port },
    auth,
  );
  t.after(() => server.close());
  const { port: boundPort } = server.address();
  return boundPort;
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
  assert.deepEqual(authOptionsFromEnv({ MCP_AUTH: 'spotify' }, base), {
    authorizationServers: ['https://accounts.spotify.com'],
    resourceUrl: 'http://127.0.0.1:4123',
    resourceMetadataUrl:
      'http://127.0.0.1:4123/.well-known/oauth-protected-resource',
  });
  assert.equal(
    authOptionsFromEnv(
      {
        MCP_AUTH: 'spotify',
        SPOTIFY_RESOURCE_URL: 'http://mcphub.example:3000',
      },
      base,
    ).resourceUrl,
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
  const port = await startAuthServer(t);
  const response = await raw(port);
  assert.equal(response.status, 401);
  assert.match(
    response.headers['www-authenticate'],
    /Bearer realm="spotify", resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource"/,
  );
});

test('malformed Authorization header still gets 401', async (t) => {
  const port = await startAuthServer(t);
  for (const value of ['', 'Bearer', 'Token abc', 'bearer abc']) {
    const response = await raw(port, {
      headers: { Authorization: value },
    });
    assert.equal(response.status, 401, value);
  }
});

test('protected resource metadata advertises Spotify as authorization server', async (t) => {
  const port = await startAuthServer(t);
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

test('metadata endpoint is absent without auth mode', async (t) => {
  const port = await startPlainServer(t);
  const response = await raw(port, { method: 'GET', path: METADATA });
  assert.equal(response.status, 404);
});

test('MCP round trip with Bearer token works end to end', async (t) => {
  const port = await startAuthServer(t);
  const client = new Client(
    { name: 'spotify-test', version: '1.0.0' },
    { versionNegotiation: { mode: 'legacy' } },
  );
  t.after(() => client.close());
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
  mockSpotify(t, [
    {
      url: 'me/player/devices',
      authorization: 'Bearer oauth-test-token',
      response: { devices: [] },
    },
  ]);
  const result = await client.callTool({
    name: 'getAvailableDevices',
    arguments: {},
  });
  assert.match(resultText(result), /No available devices/);
});

test('each request carries its own token', async (t) => {
  const port = await startAuthServer(t);
  const client = new Client(
    { name: 'spotify-test', version: '1.0.0' },
    { versionNegotiation: { mode: 'legacy' } },
  );
  t.after(() => client.close());
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: {
        headers: { Authorization: 'Bearer first-token' },
      },
    }),
  );
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

test('formatHost stays importable for metadata resource URLs', () => {
  assert.equal(formatHost('::1'), '[::1]');
  assert.equal(formatHost('127.0.0.1'), '127.0.0.1');
});

test('authOptionsFromEnv surfaces explicitResourceUrl only when set', () => {
  const base = { host: '0.0.0.0', port: 3000 };
  // Unset: field absent so callers can tell it was not explicitly configured.
  assert.equal(
    'explicitResourceUrl' in authOptionsFromEnv({ MCP_AUTH: 'spotify' }, base),
    false,
  );
  // Set: the explicit URL wins, e.g. a Docker service name over 0.0.0.0.
  const explicit = authOptionsFromEnv(
    { MCP_AUTH: 'spotify', SPOTIFY_RESOURCE_URL: 'http://spotify-mcp:3000' },
    base,
  );
  assert.equal(explicit?.explicitResourceUrl, 'http://spotify-mcp:3000');
  assert.equal(explicit?.resourceUrl, 'http://spotify-mcp:3000');
});

test('metadata serves the explicit resource URL over the bind address', async (t) => {
  // Mirrors the Docker deployment: bound to 0.0.0.0 but the client reaches the
  // server as http://spotify-mcp:3000. The metadata must advertise the explicit
  // URL, never the bind address.
  const auth = {
    authorizationServers: ['https://accounts.spotify.com'],
    resourceUrl: 'http://spotify-mcp:3000',
    resourceMetadataUrl:
      'http://spotify-mcp:3000/.well-known/oauth-protected-resource',
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
