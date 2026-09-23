import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpotifyApi, spotifyFetch } from '../build/utils.js';
import { mockConfig, mockHttp } from './helpers.js';

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

test('sdk client is rebuilt when user tokens appear after a client-credentials fallback', async (t) => {
  // Server started before `npm run auth`: no user tokens, so createSpotifyApi()
  // caches a client-credentials client.
  mockConfig(t, {
    accessToken: undefined,
    refreshToken: undefined,
    expiresAt: undefined,
  });
  t.mock.method(console, 'error', () => {});
  await createSpotifyApi();

  // `npm run auth` writes user tokens into the config while the server keeps running.
  // Use the default export: that is the object mockConfig() patches, so this write
  // never reaches the real spotify-config.json.
  const { default: fs } = await import('node:fs');
  const { configPath } = await import('./helpers.js');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      clientId: 'test-client',
      clientSecret: 'test-secret',
      redirectUri: 'http://127.0.0.1:8888/callback',
      accessToken: 'fresh-access',
      refreshToken: 'fresh-refresh',
      expiresAt: Date.now() + 3600000,
    }),
  );

  // User endpoints must now use the new token instead of the stale cached client.
  mockHttp(t, [
    {
      url: 'me/player/devices',
      authorization: 'Bearer fresh-access',
      response: { devices: [] },
    },
  ]);
  const result = await (await createSpotifyApi()).player.getAvailableDevices();
  assert.deepEqual(result, { devices: [] });
});
