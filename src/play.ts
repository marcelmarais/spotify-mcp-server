import { z } from 'zod';
import { defineTool, spotifyId } from './tool.js';
import type { SpotifyHandlerExtra } from './types.js';
import { handleSpotifyRequest, spotifyFetch } from './utils.js';

/**
 * Ensures there is an active Spotify device before attempting playback.
 * If no device is currently active, transfers playback to the first available
 * device and waits briefly for it to become ready.
 * Returns the device_id to use, or empty string if none found.
 */
async function ensureActiveDevice(preferredDeviceId?: string): Promise<string> {
  const data = await spotifyFetch<{
    devices: Array<{ id: string; is_active: boolean; name: string }>;
  }>('me/player/devices');
  const devices = data?.devices ?? [];

  if (devices.length === 0) {
    throw new Error(
      'No Spotify devices found. Open Spotify on any device first.',
    );
  }

  // If a preferred device was specified and exists, use it
  if (preferredDeviceId) {
    const preferred = devices.find((d) => d.id === preferredDeviceId);
    if (preferred) {
      if (!preferred.is_active) {
        await spotifyFetch('me/player', {
          method: 'PUT',
          body: { device_ids: [preferredDeviceId], play: false },
        });
        await new Promise((r) => setTimeout(r, 500));
      }
      return preferredDeviceId;
    }
  }

  // Use the already-active device if there is one
  const active = devices.find((d) => d.is_active);
  if (active) return active.id;

  // No active device — transfer to the first available one
  const target = devices[0];
  await spotifyFetch('me/player', {
    method: 'PUT',
    body: { device_ids: [target.id], play: false },
  });
  // Give Spotify a moment to register the transfer before we start playback
  await new Promise((r) => setTimeout(r, 600));
  return target.id;
}

const playMusic = defineTool({
  name: 'playMusic',
  description:
    'Start playing a Spotify track, album, artist, or playlist. ' +
    'Pass a Spotify URI (e.g. spotify:track:xxx, spotify:album:xxx) via "uri". ' +
    'For albums/playlists you can also use "context_uri". ' +
    'Device is selected automatically — "deviceId" or "device_id" are optional.',
  schema: {
    uri: z
      .string()
      .optional()
      .describe(
        'Spotify URI to play (e.g. spotify:track:xxx, spotify:album:xxx)',
      ),
    context_uri: z
      .string()
      .optional()
      .describe('Alias for uri — Spotify context URI for albums/playlists'),
    type: z
      .enum(['track', 'album', 'artist', 'playlist'])
      .optional()
      .describe('Type of item (only needed with id)'),
    id: z
      .string()
      .optional()
      .describe('Spotify ID of the item (use with type)'),
    deviceId: z
      .string()
      .optional()
      .describe('Spotify device ID to play on (auto-selected if omitted)'),
    device_id: z.string().optional().describe('Alias for deviceId'),
    offset: z
      .number()
      .optional()
      .describe('Track offset within album/playlist (0-based)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    // Normalize aliases
    const deviceId = args.deviceId ?? args.device_id;
    const resolvedUri = args.uri ?? args.context_uri;
    const { type, id, offset } = args;

    if (!(resolvedUri || (type && id))) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Must provide a "uri" (e.g. spotify:track:xxx) or both "type" and "id"',
            isError: true,
          },
        ],
      };
    }

    let spotifyUri = resolvedUri;
    if (!spotifyUri && type && id) {
      spotifyUri = `spotify:${type}:${id}`;
    }

    // Infer type from URI if not provided
    const resolvedType = type ?? spotifyUri?.split(':')?.[1];

    try {
      const activeDeviceId = await ensureActiveDevice(deviceId);

      await handleSpotifyRequest(async (spotifyApi) => {
        if (!spotifyUri) {
          await spotifyApi.player.startResumePlayback(activeDeviceId);
          return;
        }
        if (resolvedType === 'track') {
          await spotifyApi.player.startResumePlayback(
            activeDeviceId,
            undefined,
            [spotifyUri],
            undefined,
            offset,
          );
        } else {
          // album, playlist, artist — use context_uri + optional offset
          await spotifyApi.player.startResumePlayback(
            activeDeviceId,
            spotifyUri,
            undefined,
            offset !== undefined ? { position: offset } : undefined,
          );
        }
      });

      return {
        content: [{ type: 'text', text: `Now playing: ${spotifyUri}` }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: 'text', text: `Error playing music: ${msg}`, isError: true },
        ],
      };
    }
  },
});

const pausePlayback = defineTool({
  name: 'pausePlayback',
  description: 'Pause Spotify playback on the active device',
  schema: {
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to pause playback on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { deviceId } = args;

    await handleSpotifyRequest(async (spotifyApi) => {
      await spotifyApi.player.pausePlayback(deviceId || '');
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Playback paused',
        },
      ],
    };
  },
});

const skipToNext = defineTool({
  name: 'skipToNext',
  description: 'Skip to the next track in the current Spotify playback queue',
  schema: {
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to skip on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { deviceId } = args;

    await handleSpotifyRequest(async (spotifyApi) => {
      await spotifyApi.player.skipToNext(deviceId || '');
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Skipped to next track',
        },
      ],
    };
  },
});

const skipToPrevious = defineTool({
  name: 'skipToPrevious',
  description:
    'Skip to the previous track in the current Spotify playback queue',
  schema: {
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to skip on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { deviceId } = args;

    await handleSpotifyRequest(async (spotifyApi) => {
      await spotifyApi.player.skipToPrevious(deviceId || '');
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Skipped to previous track',
        },
      ],
    };
  },
});

const createPlaylist = defineTool({
  name: 'createPlaylist',
  description: 'Create a new playlist on Spotify',
  schema: {
    name: z.string().describe('The name of the playlist'),
    description: z
      .string()
      .optional()
      .describe('The description of the playlist'),
    public: z
      .boolean()
      .optional()
      .describe('Whether the playlist should be public'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { name, description, public: isPublic = false } = args;

    try {
      // Hit /me/playlists directly: the /users/{id}/playlists path the SDK's
      // createPlaylist() uses was retired in the March 2026 API migration for
      // Development Mode apps (see spotifyFetch JSDoc). POST /me/playlists
      // infers the owner from the token, so no profile lookup is needed.
      const result = await spotifyFetch<{
        id: string;
        external_urls: { spotify: string };
      }>('me/playlists', {
        method: 'POST',
        body: { name, description, public: isPublic },
      });

      return {
        content: [
          {
            type: 'text',
            text: `Successfully created playlist "${name}"\nPlaylist ID: ${result.id}\nPlaylist URL: ${result.external_urls.spotify}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error creating playlist: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
});

const addTracksToPlaylist = defineTool({
  name: 'addTracksToPlaylist',
  description:
    'Add tracks or podcast episodes to a Spotify playlist. ' +
    'Accepts Spotify track IDs, episode IDs, or full Spotify URIs (e.g. spotify:episode:xxx).',
  schema: {
    playlistId: spotifyId.describe('The Spotify ID of the playlist'),
    trackIds: z
      .array(z.string())
      .describe(
        'Array of Spotify IDs or URIs to add. ' +
          'Plain IDs are assumed to be tracks. ' +
          'To add podcast episodes, pass full URIs: spotify:episode:{id}.',
      ),
    position: z
      .number()
      .nonnegative()
      .optional()
      .describe('Position to insert the items (0-based index)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { playlistId, trackIds, position } = args;

    if (trackIds.length === 0) {
      return {
        content: [{ type: 'text', text: 'Error: No IDs provided' }],
      };
    }

    try {
      const uris = trackIds.map((id) =>
        id.startsWith('spotify:') ? id : `spotify:track:${id}`,
      );

      // Hit /items directly: see spotifyFetch JSDoc for context.
      await spotifyFetch(`playlists/${playlistId}/items`, {
        method: 'POST',
        body: {
          uris,
          ...(position !== undefined ? { position } : {}),
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: `Successfully added ${trackIds.length} item${
              trackIds.length === 1 ? '' : 's'
            } to playlist (ID: ${playlistId})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error adding items to playlist: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
});

const resumePlayback = defineTool({
  name: 'resumePlayback',
  description: 'Resume Spotify playback on the active device',
  schema: {
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to resume playback on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { deviceId } = args;

    try {
      const activeDeviceId = await ensureActiveDevice(deviceId);
      await handleSpotifyRequest(async (spotifyApi) => {
        await spotifyApi.player.startResumePlayback(activeDeviceId);
      });
      return { content: [{ type: 'text', text: 'Playback resumed' }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error resuming playback: ${msg}`,
            isError: true,
          },
        ],
      };
    }
  },
});

// Spotify's queue endpoint takes one track/episode URI per request, so every
// queued item is its own POST. Cap a single call to keep it within rate limits.
const MAX_QUEUE_ITEMS = 100;
const QUEUE_URI = /^spotify:(track|episode|album|playlist):([A-Za-z0-9]+)$/;
const QUEUEABLE_ITEM = /^(spotify:(track|episode):)?[A-Za-z0-9]+$/;

/**
 * Expands an album or playlist into the URIs of its tracks/episodes, in order,
 * starting at `offset`. Removed tracks and local files can't be queued, so they
 * are skipped and counted.
 */
async function collectQueueUris(
  type: 'album' | 'playlist',
  id: string,
  offset: number,
  limit: number,
): Promise<{ uris: string[]; skipped: number; total: number }> {
  type Entry = {
    uri?: string;
    item?: { uri?: string } | null;
    track?: { uri?: string } | null;
  };
  const uris: string[] = [];
  let skipped = 0;
  let total = 0;
  let next = offset;

  while (uris.length + skipped < limit) {
    const pageSize = Math.min(50, limit - uris.length - skipped);
    // Playlist entries wrap the track; album tracks are the entries themselves.
    const page = await spotifyFetch<{ items?: Entry[]; total: number }>(
      type === 'playlist' ? `playlists/${id}/items` : `albums/${id}/tracks`,
      {
        query: {
          limit: pageSize,
          offset: next,
          ...(type === 'playlist' ? { additional_types: 'track,episode' } : {}),
        },
      },
    );
    const items = page.items ?? [];
    total = page.total;

    for (const entry of items) {
      const uri = entry.item?.uri ?? entry.track?.uri ?? entry.uri;
      if (uri && QUEUEABLE_ITEM.test(uri)) uris.push(uri);
      else skipped++;
    }

    next += items.length;
    if (items.length < pageSize || next >= total) break;
  }

  return { uris, skipped, total };
}

const addToQueue = defineTool({
  name: 'addToQueue',
  description:
    'Add items to the end of the playback queue, in order, without interrupting what is playing. ' +
    'Pass `trackIds` to queue several tracks or episodes in one call, or `type` + `id` (or `uri`) ' +
    'for a single track/episode or a whole album or playlist, which is expanded into its tracks. ' +
    `Queues at most ${MAX_QUEUE_ITEMS} items per call; use \`offset\` to continue through a longer album or playlist.`,
  schema: {
    trackIds: z
      .array(
        z
          .string()
          .regex(
            QUEUEABLE_ITEM,
            'Must be a Spotify ID or a spotify:track:/spotify:episode: URI',
          ),
      )
      .min(1)
      .max(MAX_QUEUE_ITEMS)
      .optional()
      .describe(
        `Spotify IDs or URIs to queue in order (max ${MAX_QUEUE_ITEMS}). ` +
          'Plain IDs are assumed to be tracks; pass spotify:episode:{id} for podcast episodes.',
      ),
    uri: z
      .string()
      .optional()
      .describe(
        'Spotify URI of a single track, episode, album or playlist (overrides type and id)',
      ),
    type: z
      .enum(['track', 'episode', 'album', 'playlist'])
      .optional()
      .describe('The type of item to queue'),
    id: spotifyId.optional().describe('The Spotify ID of the item to queue'),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'Album/playlist only: index of the first track to queue (default: 0)',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_QUEUE_ITEMS)
      .optional()
      .describe(
        `Album/playlist only: maximum number of tracks to queue (default and max: ${MAX_QUEUE_ITEMS})`,
      ),
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to add the items to'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { trackIds, uri, deviceId, offset = 0 } = args;
    const limit = args.limit ?? MAX_QUEUE_ITEMS;
    const fail = (text: string) => ({
      content: [{ type: 'text' as const, text }],
      isError: true,
    });

    let type = args.type;
    let id = args.id;
    if (uri) {
      const match = QUEUE_URI.exec(uri);
      if (!match) {
        return fail(
          `Error: Can't queue ${uri}. Spotify can only queue tracks and episodes; ` +
            'albums and playlists are expanded into their tracks. Artists are not supported.',
        );
      }
      type = match[1] as typeof type;
      id = match[2];
    }

    if (trackIds && (type || id)) {
      return fail(
        'Error: Pass either trackIds or a single uri/type+id, not both',
      );
    }
    if (!(trackIds || (type && id))) {
      return fail('Error: Must provide trackIds, a uri, or both a type and id');
    }

    let uris: string[];
    let note = '';
    try {
      if (trackIds) {
        uris = trackIds.map((item) =>
          item.startsWith('spotify:') ? item : `spotify:track:${item}`,
        );
      } else if ((type === 'album' || type === 'playlist') && id) {
        const expanded = await collectQueueUris(type, id, offset, limit);
        uris = expanded.uris;
        if (expanded.skipped > 0) {
          note += ` Skipped ${expanded.skipped} removed or local track${expanded.skipped === 1 ? '' : 's'}.`;
        }
        const end = offset + uris.length + expanded.skipped;
        if (end < expanded.total) {
          note += ` The ${type} has ${expanded.total - end} more; call again with offset ${end} to continue.`;
        }
        if (uris.length === 0) {
          return fail(
            `Error: No queueable tracks found in this ${type}.${note}`,
          );
        }
      } else {
        uris = [`spotify:${type}:${id}`];
      }
    } catch (error) {
      return fail(
        `Error reading ${type}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // One at a time and in order: parallel POSTs could land in the queue shuffled.
    let queued = 0;
    try {
      for (const item of uris) {
        await spotifyFetch('me/player/queue', {
          method: 'POST',
          query: { uri: item, device_id: deviceId },
        });
        queued++;
      }
    } catch (error) {
      return fail(
        `Queued ${queued} of ${uris.length} items before Spotify returned an error: ${
          error instanceof Error ? error.message : String(error)
        }. Not queued, starting with: ${uris[queued]}`,
      );
    }

    const what =
      uris.length === 1 && !trackIds && type !== 'album' && type !== 'playlist'
        ? uris[0]
        : `${uris.length} item${uris.length === 1 ? '' : 's'}${
            type === 'album' || type === 'playlist' ? ` from ${type} ${id}` : ''
          }`;
    return {
      content: [{ type: 'text', text: `Added ${what} to queue.${note}` }],
    };
  },
});

const setVolume = defineTool({
  name: 'setVolume',
  description:
    'Set the playback volume to a specific percentage (0-100). Requires Spotify Premium.',
  schema: {
    volumePercent: z
      .number()
      .min(0)
      .max(100)
      .describe('The volume to set (0-100)'),
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to set volume on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { volumePercent, deviceId } = args;

    try {
      await handleSpotifyRequest(async (spotifyApi) => {
        await spotifyApi.player.setPlaybackVolume(
          Math.round(volumePercent),
          deviceId || '',
        );
      });

      return {
        content: [
          {
            type: 'text',
            text: `Volume set to ${Math.round(volumePercent)}%`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error setting volume: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
});

const adjustVolume = defineTool({
  name: 'adjustVolume',
  description:
    'Adjust the playback volume up or down by a relative amount. Use positive values to increase, negative to decrease. Requires Spotify Premium.',
  schema: {
    adjustment: z
      .number()
      .min(-100)
      .max(100)
      .describe(
        'The amount to adjust volume by (-100 to 100). Positive increases, negative decreases.',
      ),
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to adjust volume on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { adjustment, deviceId } = args;

    try {
      // First get the current playback state to find current volume
      const playback = await handleSpotifyRequest(async (spotifyApi) => {
        return await spotifyApi.player.getPlaybackState();
      });

      if (!playback?.device) {
        return {
          content: [
            {
              type: 'text',
              text: 'No active device found. Make sure Spotify is open and playing on a device.',
            },
          ],
        };
      }

      const currentVolume = playback.device.volume_percent;
      if (currentVolume === null || currentVolume === undefined) {
        return {
          content: [
            {
              type: 'text',
              text: 'Unable to get current volume from device.',
            },
          ],
        };
      }

      const newVolume = Math.min(100, Math.max(0, currentVolume + adjustment));

      await handleSpotifyRequest(async (spotifyApi) => {
        await spotifyApi.player.setPlaybackVolume(
          Math.round(newVolume),
          deviceId || '',
        );
      });

      const direction = adjustment > 0 ? 'increased' : 'decreased';
      return {
        content: [
          {
            type: 'text',
            text: `Volume ${direction} from ${currentVolume}% to ${Math.round(newVolume)}%`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error adjusting volume: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
});

export const playTools = [
  playMusic,
  pausePlayback,
  skipToNext,
  skipToPrevious,
  createPlaylist,
  addTracksToPlaylist,
  resumePlayback,
  addToQueue,
  setVolume,
  adjustVolume,
];
