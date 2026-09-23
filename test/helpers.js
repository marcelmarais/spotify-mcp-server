import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from '../build/server.js';

export const configPath = fileURLToPath(
  new URL('../spotify-config.json', import.meta.url),
);

export function mockConfig(t, overrides = {}) {
  let config = {
    clientId: 'test-client',
    clientSecret: 'test-secret',
    redirectUri: 'http://127.0.0.1:8888/callback',
    accessToken: 'test-access',
    refreshToken: 'test-refresh',
    expiresAt: Date.now() + 3600000,
    ...overrides,
  };
  const exists = fs.existsSync;
  const realpath = fs.realpathSync;
  t.mock.method(fs, 'realpathSync', (path, ...args) =>
    path === configPath ? configPath : realpath(path, ...args),
  );
  const read = fs.readFileSync;
  const write = fs.writeFileSync;
  t.mock.method(
    fs,
    'existsSync',
    (path) => path === configPath || exists(path),
  );
  t.mock.method(fs, 'readFileSync', (path, ...args) =>
    path === configPath ? JSON.stringify(config) : read(path, ...args),
  );
  const pending = new Map();
  const fds = new Map();
  const isTemp = (path) => String(path).startsWith(`${configPath}.`);
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', (path, ...args) => {
    if (!isTemp(path)) return open(path, ...args);
    const fd = 1_000_000 + fds.size;
    fds.set(fd, path);
    pending.set(path, '');
    return fd;
  });
  t.mock.method(fs, 'writeFileSync', (path, data, ...args) => {
    if (path === configPath) config = JSON.parse(data);
    else if (fds.has(path)) pending.set(fds.get(path), data);
    else write(path, data, ...args);
  });
  for (const name of ['fchmodSync', 'closeSync']) {
    const original = fs[name];
    t.mock.method(fs, name, (fd, ...args) => {
      if (!fds.has(fd)) original(fd, ...args);
    });
  }
  const unlink = fs.unlinkSync;
  t.mock.method(fs, 'unlinkSync', (path, ...args) => {
    if (!pending.delete(path)) unlink(path, ...args);
  });
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to, ...args) => {
    if (to === configPath && pending.has(from)) {
      config = JSON.parse(pending.get(from));
      pending.delete(from);
    } else rename(from, to, ...args);
  });
  return () => config;
}

export function mockHttp(t, expected) {
  let index = 0;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const request = new Request(input, options);
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
    if (step.form)
      assert.deepEqual(
        Object.fromEntries(new URLSearchParams(body)),
        step.form,
      );
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

export async function connect(t, mode = 'legacy') {
  const client = new Client(
    { name: 'spotify-test', version: '1.0.0' },
    { versionNegotiation: { mode } },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = serveStdio(createServer, { transport: serverTransport });
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await client.connect(clientTransport);
  return client;
}

export function resultText(result) {
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.ok(result.content.length > 0);
  return result.content
    .map((item) => {
      assert.equal(item.type, 'text');
      return item.text;
    })
    .join('\n');
}
