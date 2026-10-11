import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { handleSpotifyRequest } from '../build/utils.js';
import { configPath, mockConfig } from './helpers.js';

test('configuration parser errors are not treated as successful actions', async (t) => {
  let actionCalled = false;
  const exists = fs.existsSync;
  const read = fs.readFileSync;
  t.mock.method(
    fs,
    'existsSync',
    (path) => path === configPath || exists(path),
  );
  t.mock.method(fs, 'readFileSync', (path, ...args) =>
    path === configPath ? '{} trailing' : read(path, ...args),
  );

  await assert.rejects(
    handleSpotifyRequest(async () => {
      actionCalled = true;
    }),
    /Failed to parse Spotify configuration: Unexpected non-whitespace character/,
  );
  assert.equal(actionCalled, false);
});

test('action response parser errors retain the existing suppression contract', async (t) => {
  mockConfig(t);
  const result = await handleSpotifyRequest(async () => {
    throw new SyntaxError('Unexpected token at position 0');
  });
  assert.equal(result, undefined);
});
