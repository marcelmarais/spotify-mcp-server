import assert from 'node:assert/strict';
import test from 'node:test';
import { connect, mockConfig, mockHttp, resultText } from './helpers.js';

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
            { id: 'playlist1', name: 'Test Playlist', items: { total: 12 } },
          ],
        },
      },
    ],
    text: /6\. "Test Playlist" \(12 tracks\)/,
  },
  {
    name: 'getPlaylistTracks',
    args: { playlistId: 'playlist1', limit: 2, offset: 1 },
    http: [
      {
        url: 'playlists/playlist1/items?limit=2&offset=1&additional_types=track%2Cepisode',
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
          id: 'playlist1',
          external_urls: {
            spotify: 'https://open.spotify.com/playlist/playlist1',
          },
        },
      },
    ],
    text: /Successfully created playlist/,
  },
  {
    name: 'addTracksToPlaylist',
    args: {
      playlistId: 'playlist1',
      trackIds: ['track1', 'spotify:episode:episode1'],
      position: 0,
    },
    http: [
      {
        url: 'playlists/playlist1/items',
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
    args: { playlistId: 'playlist1' },
    http: [
      {
        url: 'playlists/playlist1',
        response: {
          id: 'playlist1',
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
    args: { playlistId: 'playlist1', name: 'Renamed', public: false },
    http: [
      {
        url: 'playlists/playlist1',
        method: 'PUT',
        body: { name: 'Renamed', public: false },
      },
    ],
    text: /Successfully updated/,
  },
  {
    name: 'removeTracksFromPlaylist',
    args: {
      playlistId: 'playlist1',
      trackIds: ['track1'],
      snapshotId: 'snapshot1',
    },
    http: [
      {
        url: 'playlists/playlist1/items',
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
    args: { playlistId: 'playlist1', rangeStart: 2, insertBefore: 0 },
    http: [
      {
        url: 'playlists/playlist1/items',
        method: 'PUT',
        body: { range_start: 2, insert_before: 0 },
      },
    ],
    text: /Successfully moved 1 track/,
  },
  {
    name: 'unfollowPlaylist',
    args: { playlistId: 'playlist1' },
    http: [{ url: 'playlists/playlist1/followers', method: 'DELETE' }],
    text: /Successfully unfollowed/,
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
