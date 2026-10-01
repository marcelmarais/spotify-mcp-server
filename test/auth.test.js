import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createSpotifyApi, spotifyFetch } from '../build/utils.js';
import { configPath, mockConfig, mockHttp } from './helpers.js';

const refreshRequest = {
  url: 'https://accounts.spotify.com/api/token',
  method: 'POST',
  authorization: `Basic ${Buffer.from('test-client:test-secret').toString('base64')}`,
  form: { grant_type: 'refresh_token', refresh_token: 'test-refresh' },
};

for (const mode of ['sdk', 'direct']) {
  test(`${mode} refreshes expired tokens, persists rotation, and uses the new token`, async (t) => {
    const config = mockConfig(t, { expiresAt: 1 });
    const stdout = t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'error', () => {});
    mockHttp(t, [
      {
        ...refreshRequest,
        response: {
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
        },
      },
      {
        url: 'me/player/devices',
        authorization: 'Bearer new-access',
        response: { devices: [] },
      },
    ]);
    const before = Date.now();
    const result =
      mode === 'sdk'
        ? await (await createSpotifyApi()).player.getAvailableDevices()
        : await spotifyFetch('me/player/devices');
    assert.deepEqual(result, { devices: [] });
    assert.equal(config().accessToken, 'new-access');
    assert.equal(config().refreshToken, 'new-refresh');
    assert.ok(config().expiresAt >= before + 3600000);
    assert.equal(stdout.mock.callCount(), 0);
  });
}

test('revoked refresh tokens are discarded and request reauthentication', async (t) => {
  const config = mockConfig(t, { expiresAt: 1 });
  mockHttp(t, [
    { ...refreshRequest, status: 400, response: { error: 'invalid_grant' } },
  ]);
  await assert.rejects(
    spotifyFetch('me/player/devices'),
    /invalid_grant.*npm run auth/,
  );
  assert.equal(config().accessToken, undefined);
  assert.equal(config().refreshToken, undefined);
  assert.equal(config().expiresAt, undefined);
});

test('temporary refresh failures preserve credentials for retry', async (t) => {
  const config = mockConfig(t, { expiresAt: 1 });
  mockHttp(t, [
    {
      ...refreshRequest,
      status: 503,
      response: { error: 'temporarily_unavailable' },
    },
  ]);
  await assert.rejects(spotifyFetch('me/player/devices'), /Failed to refresh/);
  assert.equal(config().refreshToken, 'test-refresh');
});

test('concurrent callers share a single token refresh', async (t) => {
  const config = mockConfig(t, { expiresAt: 1 });
  t.mock.method(console, 'error', () => {});
  mockHttp(t, [
    {
      ...refreshRequest,
      response: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      },
    },
    ...Array.from({ length: 3 }, () => ({
      url: 'me/player/devices',
      authorization: 'Bearer new-access',
      response: { devices: [] },
    })),
  ]);
  const results = await Promise.all([
    spotifyFetch('me/player/devices'),
    spotifyFetch('me/player/devices'),
    createSpotifyApi().then((api) => api.player.getAvailableDevices()),
  ]);
  assert.deepEqual(results, [
    { devices: [] },
    { devices: [] },
    { devices: [] },
  ]);
  assert.equal(config().accessToken, 'new-access');
  assert.equal(config().refreshToken, 'new-refresh');
});

test('a token refreshed by another process is reused instead of refreshed again', async (t) => {
  const config = mockConfig(t, { accessToken: 'stale', expiresAt: 1 });
  let reads = 0;
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (path, ...args) => {
    if (path !== configPath) return read(path, ...args);
    reads += 1;
    return JSON.stringify(
      reads === 1
        ? config()
        : {
            ...config(),
            accessToken: 'test-access',
            expiresAt: Date.now() + 3600000,
          },
    );
  });
  mockHttp(t, [{ url: 'me/player/devices', response: { devices: [] } }]);
  assert.deepEqual(await spotifyFetch('me/player/devices'), { devices: [] });
});
