import assert from 'node:assert/strict';
import { request } from 'node:http';
import { connect as connectSocket } from 'node:net';
import test from 'node:test';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import {
  formatHost,
  httpOptionsFromEnv,
  isLoopbackAddress,
  serveHttp,
} from '../build/http.js';
import { createServer } from '../build/server.js';
import { connect } from './helpers.js';

async function startServer(t) {
  const server = await serveHttp(createServer, { host: '127.0.0.1', port: 0 });
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}/mcp`;
}

test('HTTP transport is opt-in', () => {
  assert.equal(httpOptionsFromEnv({}), undefined);
  assert.deepEqual(httpOptionsFromEnv({ MCP_TRANSPORT: 'http' }), {
    host: '127.0.0.1',
    port: 3000,
  });
  assert.deepEqual(
    httpOptionsFromEnv({
      MCP_TRANSPORT: 'http',
      MCP_HTTP_HOST: '0.0.0.0',
      MCP_HTTP_PORT: '8080',
    }),
    { host: '0.0.0.0', port: 8080 },
  );
  assert.throws(
    () => httpOptionsFromEnv({ MCP_TRANSPORT: 'http', MCP_HTTP_PORT: 'x' }),
    /MCP_HTTP_PORT/,
  );
});

for (const mode of ['legacy', { pin: '2026-07-28' }]) {
  test(`serves tools over Streamable HTTP (${JSON.stringify(mode)})`, async (t) => {
    const url = await startServer(t);
    const client = new Client(
      { name: 'spotify-test', version: '1.0.0' },
      { versionNegotiation: { mode } },
    );
    t.after(() => client.close());
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    const { tools } = await client.listTools();
    const expected = await (await connect(t, mode)).listTools();
    assert.ok(tools.length > 0);
    assert.deepEqual(tools, JSON.parse(JSON.stringify(expected.tools)));
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

function post(address, port, { host, origin, path = '/mcp' } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: address,
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Host: host ?? `${formatHost(address)}:${port}`,
          ...(origin ? { Origin: origin } : {}),
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.end(initialize);
  });
}

function rawRequest(port, text) {
  return new Promise((resolve, reject) => {
    const socket = connectSocket(port, '127.0.0.1');
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      data += chunk;
    });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
    socket.end(text);
  });
}

async function listen(t, host) {
  const server = await serveHttp(createServer, { host, port: 0 });
  t.after(() => server.close());
  const { address, port } = server.address();
  return { address, port };
}

test('loopback binds reject foreign Host and Origin headers', async (t) => {
  const { address, port } = await listen(t, '127.0.0.1');
  assert.equal(
    await post(address, port, { origin: 'https://evil.example' }),
    403,
  );
  assert.equal(await post(address, port, { host: 'evil.example' }), 403);
  assert.equal(
    await post(address, port, { host: 'evil.example', path: '/other' }),
    403,
  );
  assert.equal(await post(address, port), 200);
  assert.equal(await post(address, port, { host: `localhost:${port}` }), 200);
  assert.equal(
    await post(address, port, { origin: `http://localhost:${port}` }),
    200,
  );
  assert.equal(await post(address, port, { origin: 'null' }), 403);
  assert.equal(await post(address, port, { path: '/other' }), 404);
});

test('a malformed request URL gets 400 and the server keeps serving', async (t) => {
  const { address, port } = await listen(t, '127.0.0.1');
  const response = await rawRequest(
    port,
    `GET //[ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
  );
  assert.match(response, /^HTTP\/1\.1 400 /);
  assert.equal(await post(address, port), 200);
});

test('loopback addresses are recognised in any spelling', () => {
  for (const address of [
    '127.0.0.1',
    '127.0.0.2',
    '127.255.255.254',
    '::1',
    '0:0:0:0:0:0:0:1',
    '[::1]',
    '::ffff:127.0.0.1',
    '::FFFF:7F00:2',
  ]) {
    assert.equal(isLoopbackAddress(address), true, address);
  }
  for (const address of [
    '0.0.0.0',
    '::',
    '10.0.0.1',
    '128.0.0.1',
    '::ffff:10.0.0.1',
    'localhost',
  ]) {
    assert.equal(isLoopbackAddress(address), false, address);
  }
});

for (const host of [
  'LOCALHOST',
  'localhost.',
  '127.0.0.2',
  '0:0:0:0:0:0:0:1',
  '::ffff:127.0.0.1',
]) {
  test(`loopback alias bind ${host} keeps the Host and Origin guards`, async (t) => {
    const { address, port } = await listen(t, host);
    assert.equal(await post(address, port, { host: 'evil.example' }), 403);
    assert.equal(
      await post(address, port, { origin: 'https://evil.example' }),
      403,
    );
    assert.equal(await post(address, port), 200);
    const advertised = `${formatHost(host)}:${port}`;
    assert.equal(
      await post(address, port, {
        host: advertised,
        origin: `http://${advertised}`,
      }),
      200,
    );
  });
}
