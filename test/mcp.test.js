import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { connect, mockHttp, resultText } from './helpers.js';

export const toolNames = [
  'searchSpotify',
  'getNowPlaying',
  'getMyPlaylists',
  'getPlaylistTracks',
  'getRecentlyPlayed',
  'getUsersSavedTracks',
  'getQueue',
  'getAvailableDevices',
  'removeUsersSavedTracks',
  'getTopTracks',
  'getTopArtists',
  'playMusic',
  'pausePlayback',
  'skipToNext',
  'skipToPrevious',
  'createPlaylist',
  'addTracksToPlaylist',
  'resumePlayback',
  'addToQueue',
  'setVolume',
  'adjustVolume',
  'getAlbums',
  'getAlbumTracks',
  'saveOrRemoveAlbumForUser',
  'checkUsersSavedAlbums',
  'getPlaylist',
  'updatePlaylist',
  'removeTracksFromPlaylist',
  'reorderPlaylistItems',
  'unfollowPlaylist',
].sort();

for (const mode of ['legacy', { pin: '2026-07-28' }]) {
  test(`discovers all tools and validates arguments (${JSON.stringify(mode)})`, async (t) => {
    mockHttp(t, []);
    const client = await connect(t, mode);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(({ name }) => name).sort(), toolNames);
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, 'object');
      assert.ok(tool.description);
    }
    const search = tools.find(({ name }) => name === 'searchSpotify');
    assert.deepEqual(search.inputSchema.required.sort(), ['query', 'type']);
    assert.equal(search.inputSchema.properties.limit.maximum, 10);
    assert.ok(search.inputSchema.properties.type.enum.includes('episode'));
    const albums = tools.find(({ name }) => name === 'getAlbums');
    assert.equal(albums.inputSchema.properties.albumIds.anyOf.length, 2);
    const noArgs = tools.find(({ name }) => name === 'getNowPlaying');
    assert.deepEqual(noArgs.inputSchema.properties, {});
    // Use request() to bypass the client's cached-schema validation and test the server boundary.
    for (const [name, args] of [
      ['searchSpotify', { query: 'test', type: 'invalid' }],
      ['searchSpotify', { query: 'test', type: 'track', limit: 11 }],
      ['searchSpotify', { type: 'track' }],
      ['getMyPlaylists', { offset: -1 }],
      ['setVolume', { volumePercent: 101 }],
      ['getAlbums', { albumIds: Array(21).fill('album') }],
      ['removeUsersSavedTracks', { trackIds: Array(41).fill('track') }],
    ]) {
      const result = await client.request({
        method: 'tools/call',
        params: { name, arguments: args },
      });
      assert.equal(result.isError, true, `${name}: ${JSON.stringify(result)}`);
    }
    await assert.rejects(
      client.request({
        method: 'tools/call',
        params: { name: 'missing-tool', arguments: {} },
      }),
    );
    const result = await client.callTool({ name: 'getAlbums', arguments: {} });
    assert.match(resultText(result), /albumIds is required/);
  });
}

const entry = fileURLToPath(new URL('../build/index.js', import.meta.url));
for (const mode of ['legacy', { pin: '2026-07-28' }]) {
  test(`built CLI serves tools over stdio (${JSON.stringify(mode)})`, {
    timeout: 15000,
  }, async (t) => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      stderr: 'pipe',
    });
    const client = new Client(
      { name: 'stdio-test', version: '1.0.0' },
      { versionNegotiation: { mode } },
    );
    const errors = [];
    transport.stderr.on('data', (data) => errors.push(data.toString()));
    t.after(() => client.close());
    await client.connect(transport);
    assert.deepEqual(
      (await client.listTools()).tools.map(({ name }) => name).sort(),
      toolNames,
    );
    assert.match(
      resultText(await client.callTool({ name: 'getAlbums', arguments: {} })),
      /albumIds is required/,
    );
    assert.equal(errors.join(''), '');
  });
}

test('CLI exits cleanly when the client closes stdin', {
  timeout: 5000,
}, async (t) => {
  const child = spawn(process.execPath, [entry], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  const exit = once(child, 'exit');
  child.stdin.end();
  assert.deepEqual(await exit, [0, null]);
});
