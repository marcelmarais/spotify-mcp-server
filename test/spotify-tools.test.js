import assert from 'node:assert/strict';
import test from 'node:test';
import { connect, mockConfig, mockHttp, resultText } from './helpers.js';

process.env.SPOTIFY_RETRY_BASE_MS = '0';

const track = {
  id: 'track1',
  name: 'Test Track',
  type: 'track',
  duration_ms: 180000,
  artists: [{ name: 'Test Artist' }],
  album: { name: 'Test Album' },
};
const album = {
  id: 'album1',
  name: 'Test Album',
  artists: [{ name: 'Test Artist' }],
  release_date: '2026-01-01',
  total_tracks: 1,
  album_type: 'album',
};
const device = {
  id: 'device1',
  name: 'Test Speaker',
  type: 'Speaker',
  is_active: true,
  volume_percent: 50,
};
const devices = { url: 'me/player/devices', response: { devices: [device] } };
const cases = [
  {
    name: 'searchSpotify',
    args: { query: 'test', type: 'track', limit: 2, offset: 3 },
    http: [
      {
        url: 'search?q=test&type=track&limit=2&offset=3',
        response: { tracks: { items: [track] } },
      },
    ],
    text: /Test Track.*Test Artist.*3:00/,
  },
  {
    name: 'getNowPlaying',
    http: [{ url: 'me/player', status: 204 }],
    text: /Nothing is currently playing/,
  },
  {
    name: 'getMyPlaylists',
    args: { limit: 2, offset: 5 },
    http: [
      {
        url: 'me/playlists?limit=2&offset=5',
        response: {
          total: 8,
          items: [
            {
              id: 'LLLLLLLLLLLLLLLLLLLLLL',
              name: 'Test Playlist',
              items: { total: 12 },
            },
          ],
        },
      },
    ],
    text: /6\. "Test Playlist" \(12 tracks\)/,
  },
  {
    name: 'getPlaylistTracks',
    args: { playlistId: 'LLLLLLLLLLLLLLLLLLLLLL', limit: 2, offset: 1 },
    http: [
      {
        url: 'playlists/LLLLLLLLLLLLLLLLLLLLLL/items?limit=2&offset=1&additional_types=track%2Cepisode',
        response: { total: 3, items: [{ item: track }, { track: null }] },
      },
    ],
    text: /2\. "Test Track"[\s\S]*3\. \[Removed track\]/,
  },
  {
    name: 'getRecentlyPlayed',
    http: [
      { url: 'me/player/recently-played?limit=50', response: { items: [] } },
    ],
    text: /recently played/,
  },
  {
    name: 'getUsersSavedTracks',
    http: [{ url: 'me/tracks?limit=50&offset=0', response: { items: [] } }],
    text: /saved tracks/,
  },
  {
    name: 'getQueue',
    http: [
      {
        url: 'me/player/queue',
        response: { currently_playing: null, queue: [] },
      },
    ],
    text: /queue/i,
  },
  { name: 'getAvailableDevices', http: [devices], text: /Test Speaker/ },
  {
    name: 'removeUsersSavedTracks',
    args: { trackIds: ['track1'] },
    http: [
      { url: 'me/library?uris=spotify%3Atrack%3Atrack1', method: 'DELETE' },
    ],
    text: /Successfully removed 1 track/,
  },
  {
    name: 'getTopTracks',
    http: [
      {
        url: 'me/top/tracks?time_range=medium_term&limit=20',
        response: { items: [] },
      },
    ],
    text: /No top tracks/,
  },
  {
    name: 'getTopArtists',
    http: [
      {
        url: 'me/top/artists?time_range=medium_term&limit=20',
        response: { items: [] },
      },
    ],
    text: /No top artists/,
  },
  {
    name: 'playMusic',
    args: { type: 'track', id: 'track1' },
    http: [
      devices,
      {
        url: 'me/player/play?device_id=device1',
        method: 'PUT',
        body: { uris: ['spotify:track:track1'] },
      },
    ],
    text: /Now playing/,
  },
  {
    name: 'pausePlayback',
    http: [{ url: 'me/player/pause', method: 'PUT' }],
    text: /paused/,
  },
  {
    name: 'skipToNext',
    http: [{ url: 'me/player/next', method: 'POST' }],
    text: /next/,
  },
  {
    name: 'skipToPrevious',
    http: [{ url: 'me/player/previous', method: 'POST' }],
    text: /previous/,
  },
  {
    name: 'createPlaylist',
    args: { name: 'New Playlist' },
    http: [
      {
        url: 'me/playlists',
        method: 'POST',
        body: { name: 'New Playlist', public: false },
        response: {
          id: 'LLLLLLLLLLLLLLLLLLLLLL',
          external_urls: {
            spotify: 'https://open.spotify.com/playlist/LLLLLLLLLLLLLLLLLLLLLL',
          },
        },
      },
    ],
    text: /Successfully created playlist/,
  },
  {
    name: 'addTracksToPlaylist',
    args: {
      playlistId: 'LLLLLLLLLLLLLLLLLLLLLL',
      trackIds: ['track1', 'spotify:episode:episode1'],
      position: 0,
    },
    http: [
      {
        url: 'playlists/LLLLLLLLLLLLLLLLLLLLLL/items',
        method: 'POST',
        body: {
          uris: ['spotify:track:track1', 'spotify:episode:episode1'],
          position: 0,
        },
        response: { snapshot_id: 'snapshot1' },
      },
    ],
    text: /Successfully added 2 items/,
  },
  {
    name: 'resumePlayback',
    http: [devices, { url: 'me/player/play?device_id=device1', method: 'PUT' }],
    text: /resumed/,
  },
  {
    name: 'addToQueue',
    args: { uri: 'spotify:track:track1', deviceId: 'device1' },
    http: [
      {
        url: 'me/player/queue?uri=spotify%3Atrack%3Atrack1&device_id=device1',
        method: 'POST',
      },
    ],
    text: /queue/,
  },
  {
    name: 'setVolume',
    args: { volumePercent: 25, deviceId: 'device1' },
    http: [
      {
        url: 'me/player/volume?volume_percent=25&device_id=device1',
        method: 'PUT',
      },
    ],
    text: /25%/,
  },
  {
    name: 'adjustVolume',
    args: { adjustment: 80, deviceId: 'device1' },
    http: [
      { url: 'me/player', response: { device } },
      {
        url: 'me/player/volume?volume_percent=100&device_id=device1',
        method: 'PUT',
      },
    ],
    text: /from 50% to 100%/,
  },
  {
    name: 'getAlbums',
    args: { ids: 'album1' },
    http: [{ url: 'albums/album1', response: album }],
    text: /Test Album/,
  },
  {
    name: 'getAlbumTracks',
    args: { albumId: 'album1', limit: 2, offset: 0 },
    http: [
      { url: 'albums/album1/tracks?limit=2&offset=0', response: { items: [] } },
    ],
    text: /No tracks/,
  },
  {
    name: 'saveOrRemoveAlbumForUser',
    args: { albumIds: ['album1'], action: 'save' },
    http: [{ url: 'me/albums', method: 'PUT', body: ['album1'] }],
    text: /saved/,
  },
  {
    name: 'checkUsersSavedAlbums',
    args: { albumIds: ['album1'] },
    http: [{ url: 'me/albums/contains?ids=album1', response: [true] }],
    text: /album1: Saved/,
  },
  {
    name: 'getPlaylist',
    args: { playlistId: 'LLLLLLLLLLLLLLLLLLLLLL' },
    http: [
      {
        url: 'playlists/LLLLLLLLLLLLLLLLLLLLLL',
        response: {
          id: 'LLLLLLLLLLLLLLLLLLLLLL',
          name: 'Test Playlist',
          owner: { display_name: 'Test User' },
          tracks: { total: 3 },
        },
      },
    ],
    text: /Test Playlist[\s\S]*Test User[\s\S]*3/,
  },
  {
    name: 'updatePlaylist',
    args: {
      playlistId: 'LLLLLLLLLLLLLLLLLLLLLL',
      name: 'Renamed',
      public: false,
    },
    http: [
      {
        url: 'playlists/LLLLLLLLLLLLLLLLLLLLLL',
        method: 'PUT',
        body: { name: 'Renamed', public: false },
      },
    ],
    text: /Successfully updated/,
  },
  {
    name: 'removeTracksFromPlaylist',
    args: {
      playlistId: 'LLLLLLLLLLLLLLLLLLLLLL',
      trackIds: ['track1'],
      snapshotId: 'snapshot1',
    },
    http: [
      {
        url: 'playlists/LLLLLLLLLLLLLLLLLLLLLL/items',
        method: 'DELETE',
        body: {
          items: [{ uri: 'spotify:track:track1' }],
          snapshot_id: 'snapshot1',
        },
      },
    ],
    text: /Successfully removed/,
  },
  {
    name: 'reorderPlaylistItems',
    args: {
      playlistId: 'LLLLLLLLLLLLLLLLLLLLLL',
      rangeStart: 2,
      insertBefore: 0,
    },
    http: [
      {
        url: 'playlists/LLLLLLLLLLLLLLLLLLLLLL/items',
        method: 'PUT',
        body: { range_start: 2, insert_before: 0 },
      },
    ],
    text: /Successfully moved 1 track/,
  },
  {
    name: 'unfollowPlaylist',
    args: { playlistId: 'LLLLLLLLLLLLLLLLLLLLLL' },
    http: [
      { url: 'playlists/LLLLLLLLLLLLLLLLLLLLLL/followers', method: 'DELETE' },
    ],
    text: /Successfully unfollowed/,
  },
  {
    name: 'saveTracksToLibrary',
    args: { trackIds: ['track1', 'track2'] },
    http: [
      {
        url: 'me/library?uris=spotify%3Atrack%3Atrack1%2Cspotify%3Atrack%3Atrack2',
        method: 'PUT',
      },
    ],
    text: /Successfully saved 2 tracks/,
  },
  {
    name: 'checkUsersSavedTracks',
    args: { trackIds: ['track1', 'track2'] },
    http: [
      {
        url: 'me/library/contains?uris=spotify%3Atrack%3Atrack1%2Cspotify%3Atrack%3Atrack2',
        response: [true, false],
      },
    ],
    text: /track1: Saved[\s\S]*track2: Not saved/,
  },
  {
    name: 'setShuffle',
    args: { state: true, deviceId: 'device1' },
    http: [
      {
        url: 'me/player/shuffle?state=true&device_id=device1',
        method: 'PUT',
      },
    ],
    text: /Shuffle.*on/i,
  },
  {
    name: 'setRepeat',
    args: { state: 'track' },
    http: [{ url: 'me/player/repeat?state=track', method: 'PUT' }],
    text: /Repeat.*track/i,
  },
  {
    name: 'transferPlayback',
    args: { deviceId: 'device1', play: true },
    http: [
      {
        url: 'me/player',
        method: 'PUT',
        body: { device_ids: ['device1'], play: true },
      },
    ],
    text: /Transferred playback to device1/,
  },
  {
    name: 'seekToPosition',
    args: { positionMs: 90000, deviceId: 'device1' },
    http: [
      {
        url: 'me/player/seek?position_ms=90000&device_id=device1',
        method: 'PUT',
      },
    ],
    text: /1:30/,
  },
];

for (const mode of ['legacy', { pin: '2026-07-28' }]) {
  for (const scenario of cases) {
    test(`${scenario.name} sends the expected Spotify request (${JSON.stringify(mode)})`, async (t) => {
      mockConfig(t);
      mockHttp(t, scenario.http);
      const client = await connect(t, mode);
      const result = await client.callTool({
        name: scenario.name,
        arguments: scenario.args ?? {},
      });
      assert.match(resultText(result), scenario.text);
    });
  }
}

test('Spotify HTTP failures become MCP tool errors', async (t) => {
  mockConfig(t);
  mockHttp(t, [
    {
      url: 'me/playlists?limit=50&offset=0',
      status: 403,
      response: { error: { message: 'Forbidden' } },
    },
  ]);
  const client = await connect(t, { pin: '2026-07-28' });
  const result = await client.callTool({
    name: 'getMyPlaylists',
    arguments: {},
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /403|Forbidden/);
});

for (const [name, args, url, method] of [
  [
    'saveTracksToLibrary',
    { trackIds: ['track1'] },
    'me/library?uris=spotify%3Atrack%3Atrack1',
    'PUT',
  ],
  [
    'checkUsersSavedTracks',
    { trackIds: ['track1'] },
    'me/library/contains?uris=spotify%3Atrack%3Atrack1',
    'GET',
  ],
  ['setShuffle', { state: false }, 'me/player/shuffle?state=false', 'PUT'],
  ['setRepeat', { state: 'off' }, 'me/player/repeat?state=off', 'PUT'],
  ['transferPlayback', { deviceId: 'device1' }, 'me/player', 'PUT'],
  ['seekToPosition', { positionMs: 0 }, 'me/player/seek?position_ms=0', 'PUT'],
]) {
  test(`${name} reports Spotify failures as MCP tool errors`, async (t) => {
    mockConfig(t);
    mockHttp(t, [
      {
        url,
        method,
        status: 404,
        response: { error: { message: 'NO_ACTIVE_DEVICE' } },
      },
    ]);
    const client = await connect(t, { pin: '2026-07-28' });
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true, JSON.stringify(result));
    assert.match(result.content[0].text, /404|NO_ACTIVE_DEVICE/);
  });
}

const P22 = 'P'.repeat(22);
const S22 = 'S'.repeat(22);
const ids = (n, from = 1) =>
  Array.from({ length: n }, (_, i) => `t${from + i}`);
const uris = (list) =>
  encodeURIComponent(list.map((id) => `spotify:track:${id}`).join(','));
const mkTrack = (n, artist = 'Artist A') => ({
  id: `t${n}`,
  name: `Track ${n}`,
  type: 'track',
  duration_ms: 180000,
  artists: [{ name: artist }],
  album: { name: 'Album X' },
});
const savedPage = (from, count, total, artist) => ({
  total,
  items: Array.from({ length: count }, (_, i) => ({
    added_at: '2026-01-01T00:00:00Z',
    track: mkTrack(from + i, artist),
  })),
});
const run = async (t, http, name, args) => {
  mockConfig(t);
  mockHttp(t, http);
  const client = await connect(t, { pin: '2026-07-28' });
  return client.callTool({ name, arguments: args });
};

test('getAllSavedTracks paginates through the whole library in one call', async (t) => {
  const result = await run(
    t,
    [
      { url: 'me/tracks?limit=50&offset=0', response: savedPage(1, 50, 120) },
      { url: 'me/tracks?limit=50&offset=50', response: savedPage(51, 50, 120) },
      {
        url: 'me/tracks?limit=50&offset=100',
        response: savedPage(101, 20, 120),
      },
    ],
    'getAllSavedTracks',
    {},
  );
  const text = resultText(result);
  assert.match(text, /120 of 120/);
  assert.match(text, /Track 1 — Artist A \[t1\]/);
  assert.match(text, /Track 120 — Artist A \[t120\]/);
  assert.doesNotMatch(text, /next offset/i);
});

test('getAllSavedTracks stops at maxItems and reports the next offset', async (t) => {
  const result = await run(
    t,
    [
      { url: 'me/tracks?limit=50&offset=0', response: savedPage(1, 50, 120) },
      { url: 'me/tracks?limit=50&offset=50', response: savedPage(51, 50, 120) },
    ],
    'getAllSavedTracks',
    { maxItems: 60 },
  );
  const text = resultText(result);
  assert.match(text, /60 of 120/);
  assert.match(text, /Track 60 —/);
  assert.doesNotMatch(text, /Track 61 —/);
  assert.match(text, /next offset: 60/i);
});

test('getAllSavedTracks filters by query across title, artist and album', async (t) => {
  const page = savedPage(1, 3, 3);
  page.items[1].track.artists = [{ name: 'Alligatoah' }];
  const result = await run(
    t,
    [{ url: 'me/tracks?limit=50&offset=0', response: page }],
    'getAllSavedTracks',
    { query: 'alligatoah' },
  );
  const text = resultText(result);
  assert.match(text, /1 of 3/);
  assert.match(text, /Track 2 — Alligatoah \[t2\]/);
  assert.doesNotMatch(text, /Track 1 —/);
});

test('getAllSavedTracks can return only comma-separated IDs', async (t) => {
  const result = await run(
    t,
    [{ url: 'me/tracks?limit=50&offset=0', response: savedPage(1, 3, 3) }],
    'getAllSavedTracks',
    { format: 'ids' },
  );
  const text = resultText(result);
  assert.match(text, /t1,t2,t3/);
  assert.doesNotMatch(text, /Track 1/);
});

test('getAllPlaylistTracks paginates and handles removed items and episodes', async (t) => {
  const first = {
    total: 70,
    items: [
      { item: mkTrack(1) },
      { track: null },
      ...ids(48, 3).map((id) => ({ item: mkTrack(Number(id.slice(1))) })),
    ],
  };
  const second = {
    total: 70,
    items: [
      {
        item: {
          id: 'ep1',
          name: 'Episode One',
          type: 'episode',
          duration_ms: 60000,
          description: '',
          release_date: '2026-01-01',
          show: { id: 's1', name: 'Show' },
        },
      },
      ...ids(19, 52).map((id) => ({ item: mkTrack(Number(id.slice(1))) })),
    ],
  };
  const result = await run(
    t,
    [
      {
        url: `playlists/${P22}/items?limit=50&offset=0&additional_types=track%2Cepisode`,
        response: first,
      },
      {
        url: `playlists/${P22}/items?limit=50&offset=50&additional_types=track%2Cepisode`,
        response: second,
      },
    ],
    'getAllPlaylistTracks',
    { playlistId: P22 },
  );
  const text = resultText(result);
  assert.match(text, /70 of 70/);
  assert.match(text, /\[Removed track\]/);
  assert.match(text, /Episode One/);
  assert.match(text, /Track 70 — Artist A \[t70\]/);
});

test('getAllMyPlaylists paginates through all playlists', async (t) => {
  const pl = (n) => ({
    id: `p${n}`,
    name: `Playlist ${n}`,
    items: { total: n },
  });
  const result = await run(
    t,
    [
      {
        url: 'me/playlists?limit=50&offset=0',
        response: {
          total: 55,
          items: Array.from({ length: 50 }, (_, i) => pl(i + 1)),
        },
      },
      {
        url: 'me/playlists?limit=50&offset=50',
        response: {
          total: 55,
          items: Array.from({ length: 5 }, (_, i) => pl(i + 51)),
        },
      },
    ],
    'getAllMyPlaylists',
    {},
  );
  const text = resultText(result);
  assert.match(text, /55 of 55/);
  assert.match(text, /Playlist 1 .*\[p1\]/);
  assert.match(text, /Playlist 55 .*\[p55\]/);
});

test('saveTracksToLibrary splits large requests into chunks of 40', async (t) => {
  const all = ids(41);
  const result = await run(
    t,
    [
      { url: `me/library?uris=${uris(all.slice(0, 40))}`, method: 'PUT' },
      { url: `me/library?uris=${uris(all.slice(40))}`, method: 'PUT' },
    ],
    'saveTracksToLibrary',
    { trackIds: all },
  );
  assert.match(resultText(result), /Successfully saved 41 tracks/);
});

test('removeUsersSavedTracks splits large requests into chunks of 40', async (t) => {
  const all = ids(41);
  const result = await run(
    t,
    [
      { url: `me/library?uris=${uris(all.slice(0, 40))}`, method: 'DELETE' },
      { url: `me/library?uris=${uris(all.slice(40))}`, method: 'DELETE' },
    ],
    'removeUsersSavedTracks',
    { trackIds: all },
  );
  assert.match(resultText(result), /Successfully removed 41 tracks/);
});

test('checkUsersSavedTracks merges chunked results in order', async (t) => {
  const all = ids(41);
  const result = await run(
    t,
    [
      {
        url: `me/library/contains?uris=${uris(all.slice(0, 40))}`,
        response: Array(40).fill(true),
      },
      {
        url: `me/library/contains?uris=${uris(all.slice(40))}`,
        response: [false],
      },
    ],
    'checkUsersSavedTracks',
    { trackIds: all },
  );
  const text = resultText(result);
  assert.match(text, /t1: Saved/);
  assert.match(text, /41\. t41: Not saved/);
});

test('bulk writes report partial progress when a later chunk fails', async (t) => {
  const all = ids(41);
  const result = await run(
    t,
    [
      { url: `me/library?uris=${uris(all.slice(0, 40))}`, method: 'PUT' },
      {
        url: `me/library?uris=${uris(all.slice(40))}`,
        method: 'PUT',
        status: 500,
        response: { error: { message: 'boom' } },
      },
    ],
    'saveTracksToLibrary',
    { trackIds: all },
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /40 of 41/);
  assert.match(result.content[0].text, /500|boom/);
});

test('addTracksToPlaylist chunks by 100 and keeps the insert order', async (t) => {
  const all = ids(101);
  const asUris = (list) => list.map((id) => `spotify:track:${id}`);
  const result = await run(
    t,
    [
      {
        url: `playlists/${P22}/items`,
        method: 'POST',
        body: { uris: asUris(all.slice(0, 100)), position: 5 },
        response: { snapshot_id: 's1' },
      },
      {
        url: `playlists/${P22}/items`,
        method: 'POST',
        body: { uris: asUris(all.slice(100)), position: 105 },
        response: { snapshot_id: 's2' },
      },
    ],
    'addTracksToPlaylist',
    { playlistId: P22, trackIds: all, position: 5 },
  );
  assert.match(resultText(result), /Successfully added 101 items/);
});

test('removeTracksFromPlaylist chunks by 100 and only pins the snapshot on the first chunk', async (t) => {
  const all = ids(101);
  const items = (list) => list.map((id) => ({ uri: `spotify:track:${id}` }));
  const result = await run(
    t,
    [
      {
        url: `playlists/${P22}/items`,
        method: 'DELETE',
        body: { items: items(all.slice(0, 100)), snapshot_id: 'snap' },
        response: { snapshot_id: 's1' },
      },
      {
        url: `playlists/${P22}/items`,
        method: 'DELETE',
        body: { items: items(all.slice(100)) },
        response: { snapshot_id: 's2' },
      },
    ],
    'removeTracksFromPlaylist',
    { playlistId: P22, trackIds: all, snapshotId: 'snap' },
  );
  assert.match(resultText(result), /Successfully removed 101 tracks/);
});

const playlistsPage = (...playlists) => ({
  url: 'me/playlists?limit=50&offset=0',
  response: {
    total: playlists.length,
    items: playlists.map(([id, name]) => ({ id, name, items: { total: 1 } })),
  },
});
const itemsPage = (id, trackIds) => ({
  url: `playlists/${id}/items?limit=50&offset=0&additional_types=track%2Cepisode`,
  response: {
    total: trackIds.length,
    items: trackIds.map((n) => ({ item: mkTrack(Number(n.slice(1))) })),
  },
});
const likedThree = {
  url: 'me/tracks?limit=50&offset=0',
  response: savedPage(1, 3, 3),
};
const asItems = (list) => ({ uris: list.map((id) => `spotify:track:${id}`) });

test('getAllPlaylistTracks resolves a playlist by name', async (t) => {
  const result = await run(
    t,
    [
      playlistsPage([P22, 'My Mix'], ['Q'.repeat(22), 'Other']),
      itemsPage(P22, ['t1', 't2']),
    ],
    'getAllPlaylistTracks',
    { playlistId: 'my mix' },
  );
  assert.match(resultText(result), /Track 2 — Artist A \[t2\]/);
});

test('playlist name resolution reports ambiguous and unknown names', async (t) => {
  const ambiguous = await run(
    t,
    [
      playlistsPage(
        ['A'.repeat(22), 'Road Trip 1'],
        ['B'.repeat(22), 'Road Trip 2'],
      ),
    ],
    'getAllPlaylistTracks',
    { playlistId: 'road trip' },
  );
  assert.equal(ambiguous.isError, true);
  assert.match(ambiguous.content[0].text, /Road Trip 1[\s\S]*Road Trip 2/);
});

test('moveLikedSongsToPlaylist defaults to a dry run without any writes', async (t) => {
  const result = await run(
    t,
    [likedThree, playlistsPage([S22, 'storage']), itemsPage(S22, ['t2'])],
    'moveLikedSongsToPlaylist',
    { toPlaylist: 'storage', all: true },
  );
  const text = resultText(result);
  assert.match(text, /Dry run/);
  assert.match(text, /3 liked songs/);
  assert.match(text, /1 already there/);
  assert.match(text, /2 to add/);
});

test('moveLikedSongsToPlaylist moves songs, skips duplicates and removes them from Liked Songs', async (t) => {
  const result = await run(
    t,
    [
      likedThree,
      playlistsPage([S22, 'storage']),
      itemsPage(S22, ['t2']),
      {
        url: `playlists/${S22}/items`,
        method: 'POST',
        body: asItems(['t1', 't3']),
        response: { snapshot_id: 's1' },
      },
      { url: `me/library?uris=${uris(['t1', 't2', 't3'])}`, method: 'DELETE' },
    ],
    'moveLikedSongsToPlaylist',
    { toPlaylist: 'storage', all: true, dryRun: false },
  );
  const text = resultText(result);
  assert.match(text, /Moved 3 liked songs to "storage"/);
  assert.match(text, /2 added, 1 already there/);
  assert.match(text, /Removed 3 from Liked Songs/);
});

test('moveLikedSongsToPlaylist creates a missing playlist and can copy without removing', async (t) => {
  const result = await run(
    t,
    [
      likedThree,
      playlistsPage(),
      {
        url: 'me/playlists',
        method: 'POST',
        body: { name: 'storage', public: false },
        response: { id: S22 },
      },
      {
        url: `playlists/${S22}/items`,
        method: 'POST',
        body: asItems(['t1', 't2', 't3']),
        response: { snapshot_id: 's1' },
      },
    ],
    'moveLikedSongsToPlaylist',
    { toPlaylist: 'storage', all: true, dryRun: false, removeFromLiked: false },
  );
  const text = resultText(result);
  assert.match(text, /Copied 3 liked songs to "storage"/);
  assert.doesNotMatch(text, /Removed/);
});

test('moveLikedSongsToPlaylist filters by query and by added date', async (t) => {
  const page = savedPage(1, 3, 3);
  page.items[0].added_at = '2020-01-01T00:00:00Z';
  page.items[1].track.artists = [{ name: 'Alligatoah' }];
  const byQuery = await run(
    t,
    [{ url: 'me/tracks?limit=50&offset=0', response: page }, playlistsPage()],
    'moveLikedSongsToPlaylist',
    { toPlaylist: 'storage', query: 'alligatoah' },
  );
  assert.match(resultText(byQuery), /1 liked song\b/);
});

test('moveLikedSongsToPlaylist filters by addedBefore', async (t) => {
  const page = savedPage(1, 3, 3);
  page.items[0].added_at = '2020-01-01T00:00:00Z';
  const result = await run(
    t,
    [{ url: 'me/tracks?limit=50&offset=0', response: page }, playlistsPage()],
    'moveLikedSongsToPlaylist',
    { toPlaylist: 'storage', addedBefore: '2021-01-01' },
  );
  assert.match(resultText(result), /1 liked song\b/);
});

test('moveLikedSongsToPlaylist does not touch Liked Songs when adding fails', async (t) => {
  const result = await run(
    t,
    [
      likedThree,
      playlistsPage([S22, 'storage']),
      itemsPage(S22, []),
      {
        url: `playlists/${S22}/items`,
        method: 'POST',
        body: asItems(['t1', 't2', 't3']),
        status: 500,
        response: { error: { message: 'boom' } },
      },
    ],
    'moveLikedSongsToPlaylist',
    { toPlaylist: 'storage', all: true, dryRun: false },
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /0 of 3/);
  assert.match(result.content[0].text, /nothing was removed/i);
});

test('moveLikedSongsToPlaylist needs a selector or all=true', async (t) => {
  const result = await run(t, [], 'moveLikedSongsToPlaylist', {
    toPlaylist: 'storage',
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /all/i);
});

test('spotifyFetch retries on 429 honouring Retry-After', async (t) => {
  const url = 'me/tracks?limit=50&offset=0';
  const result = await run(
    t,
    [
      {
        url,
        status: 429,
        headers: { 'Retry-After': '0' },
        response: { error: { message: 'rate' } },
      },
      { url, response: savedPage(1, 2, 2) },
    ],
    'getAllSavedTracks',
    {},
  );
  assert.match(resultText(result), /2 of 2/);
});

test('spotifyFetch retries idempotent requests on 503 but not POST', async (t) => {
  const url = 'me/tracks?limit=50&offset=0';
  const ok = await run(
    t,
    [
      { url, status: 503, response: { error: { message: 'down' } } },
      { url, response: savedPage(1, 1, 1) },
    ],
    'getAllSavedTracks',
    {},
  );
  assert.match(resultText(ok), /1 of 1/);
});

test('spotifyFetch does not retry a failing POST', async (t) => {
  const result = await run(
    t,
    [
      {
        url: `playlists/${P22}/items`,
        method: 'POST',
        body: asItems(['t1']),
        status: 503,
        response: { error: { message: 'down' } },
      },
    ],
    'addTracksToPlaylist',
    { playlistId: P22, trackIds: ['t1'] },
  );
  assert.match(result.content[0].text, /503|down/);
});

test('spotifyFetch gives up after repeated 429 responses', async (t) => {
  const url = 'me/tracks?limit=50&offset=0';
  const step = {
    url,
    status: 429,
    headers: { 'Retry-After': '0' },
    response: { error: { message: 'rate' } },
  };
  const result = await run(
    t,
    [step, step, step, step],
    'getAllSavedTracks',
    {},
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /429|rate/);
});

test('seekToPosition rounds seconds without producing 0:60', async (t) => {
  const result = await run(
    t,
    [{ url: 'me/player/seek?position_ms=59600', method: 'PUT' }],
    'seekToPosition',
    { positionMs: 59600 },
  );
  assert.match(resultText(result), /Seeked to 1:00/);
});

test('searchSpotify shows playlist track counts instead of the description', async (t) => {
  const result = await run(
    t,
    [
      {
        url: 'search?q=mix&type=playlist&limit=10&offset=0',
        response: {
          playlists: {
            items: [
              {
                id: 'p1',
                name: 'Mix',
                description: 'blah',
                items: { total: 12 },
                owner: { display_name: 'Me' },
              },
            ],
          },
        },
      },
    ],
    'searchSpotify',
    { query: 'mix', type: 'playlist', limit: 10, offset: 0 },
  );
  const text = resultText(result);
  assert.match(text, /Mix \(12 tracks\)/);
  assert.doesNotMatch(text, /blah/);
});

test('getPlaylist reads the track count from items as well as tracks', async (t) => {
  const result = await run(
    t,
    [
      {
        url: `playlists/${P22}`,
        response: {
          id: P22,
          name: 'New Shape',
          owner: { display_name: 'Me' },
          items: { total: 7 },
        },
      },
    ],
    'getPlaylist',
    { playlistId: P22 },
  );
  assert.match(resultText(result), /New Shape[\s\S]*7/);
});

for (const [name, args, http, text] of [
  ['getPlaylistTracks', {}, [itemsPage(S22, ['t1'])], /Test Track|Track 1/],
  [
    'getPlaylist',
    {},
    [
      {
        url: `playlists/${S22}`,
        response: { id: S22, name: 'storage', owner: {}, tracks: { total: 1 } },
      },
    ],
    /storage/,
  ],
  [
    'updatePlaylist',
    { name: 'Renamed' },
    [{ url: `playlists/${S22}`, method: 'PUT', body: { name: 'Renamed' } }],
    /Successfully updated/,
  ],
  [
    'addTracksToPlaylist',
    { trackIds: ['t1'] },
    [
      {
        url: `playlists/${S22}/items`,
        method: 'POST',
        body: asItems(['t1']),
        response: { snapshot_id: 's' },
      },
    ],
    /Successfully added 1 item/,
  ],
  [
    'removeTracksFromPlaylist',
    { trackIds: ['t1'] },
    [
      {
        url: `playlists/${S22}/items`,
        method: 'DELETE',
        body: { items: [{ uri: 'spotify:track:t1' }] },
        response: { snapshot_id: 's' },
      },
    ],
    /Successfully removed 1 track/,
  ],
  [
    'reorderPlaylistItems',
    { rangeStart: 2, insertBefore: 0 },
    [
      {
        url: `playlists/${S22}/items`,
        method: 'PUT',
        body: { range_start: 2, insert_before: 0 },
      },
    ],
    /Successfully moved 1 track/,
  ],
  [
    'unfollowPlaylist',
    {},
    [{ url: `playlists/${S22}/followers`, method: 'DELETE' }],
    /Successfully unfollowed/,
  ],
]) {
  test(`${name} accepts a playlist name instead of an ID`, async (t) => {
    const result = await run(
      t,
      [playlistsPage([S22, 'storage']), ...http],
      name,
      { playlistId: 'storage', ...args },
    );
    assert.match(resultText(result), text);
  });
}
