import { z } from 'zod';
import type { SpotifyHandlerExtra, tool } from './types.js';
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

const playMusic: tool<{
  uri: z.ZodOptional<z.ZodString>;
  context_uri: z.ZodOptional<z.ZodString>;
  type: z.ZodOptional<z.ZodEnum<['track', 'album', 'artist', 'playlist']>>;
  id: z.ZodOptional<z.ZodString>;
  deviceId: z.ZodOptional<z.ZodString>;
  device_id: z.ZodOptional<z.ZodString>;
  offset: z.ZodOptional<z.ZodNumber>;
}> = {
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
};

const pausePlayback: tool<{
  deviceId: z.ZodOptional<z.ZodString>;
}> = {
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
};

const skipToNext: tool<{
  deviceId: z.ZodOptional<z.ZodString>;
}> = {
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
};

const skipToPrevious: tool<{
  deviceId: z.ZodOptional<z.ZodString>;
}> = {
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
};

const createPlaylist: tool<{
  name: z.ZodString;
  description: z.ZodOptional<z.ZodString>;
  public: z.ZodOptional<z.ZodBoolean>;
}> = {
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

    const result = await handleSpotifyRequest(async (spotifyApi) => {
      const me = await spotifyApi.currentUser.profile();

      return await spotifyApi.playlists.createPlaylist(me.id, {
        name,
        description,
        public: isPublic,
      });
    });

    return {
      content: [
        {
          type: 'text',
          text: `Successfully created playlist "${name}"\nPlaylist ID: ${result.id}\nPlaylist URL: ${result.external_urls.spotify}`,
        },
      ],
    };
  },
};

const addTracksToPlaylist: tool<{
  playlistId: z.ZodString;
  trackIds: z.ZodArray<z.ZodString>;
  position: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'addTracksToPlaylist',
  description:
    'Add tracks or podcast episodes to a Spotify playlist. ' +
    'Accepts Spotify track IDs, episode IDs, or full Spotify URIs (e.g. spotify:episode:xxx).',
  schema: {
    playlistId: z.string().describe('The Spotify ID of the playlist'),
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
};

const resumePlayback: tool<{
  deviceId: z.ZodOptional<z.ZodString>;
}> = {
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
};

const addToQueue: tool<{
  uri: z.ZodOptional<z.ZodString>;
  type: z.ZodOptional<z.ZodEnum<['track', 'album', 'artist', 'playlist']>>;
  id: z.ZodOptional<z.ZodString>;
  deviceId: z.ZodOptional<z.ZodString>;
}> = {
  name: 'addToQueue',
  description: 'Adds a track, album, artist or playlist to the playback queue',
  schema: {
    uri: z
      .string()
      .optional()
      .describe('The Spotify URI to play (overrides type and id)'),
    type: z
      .enum(['track', 'album', 'artist', 'playlist'])
      .optional()
      .describe('The type of item to play'),
    id: z.string().optional().describe('The Spotify ID of the item to play'),
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to add the track to'),
  },
  handler: async (args) => {
    const { uri, type, id, deviceId } = args;

    let spotifyUri = uri;
    if (!spotifyUri && type && id) {
      spotifyUri = `spotify:${type}:${id}`;
    }

    if (!spotifyUri) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Must provide either a URI or both a type and ID',
            isError: true,
          },
        ],
      };
    }

    await handleSpotifyRequest(async (spotifyApi) => {
      await spotifyApi.player.addItemToPlaybackQueue(
        spotifyUri,
        deviceId || '',
      );
    });

    return {
      content: [
        {
          type: 'text',
          text: `Added item ${spotifyUri} to queue`,
        },
      ],
    };
  },
};

const setVolume: tool<{
  volumePercent: z.ZodNumber;
  deviceId: z.ZodOptional<z.ZodString>;
}> = {
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
};

const adjustVolume: tool<{
  adjustment: z.ZodNumber;
  deviceId: z.ZodOptional<z.ZodString>;
}> = {
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
};

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
