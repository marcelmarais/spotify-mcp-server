import { z } from 'zod';
import { getRecommendations } from './read.js';
import type { SpotifyHandlerExtra, tool } from './types.js';
import {
  getAccessTokenString,
  getDefaultDeviceId,
  handleSpotifyRequest,
  loadSpotifyConfig,
} from './utils.js';

const setShuffle: tool<{
  state: z.ZodBoolean;
  deviceId: z.ZodOptional<z.ZodString>;
}> = {
  name: 'setShuffle',
  description:
    'Enable or disable shuffle mode on the active device (PUT /v1/me/player/shuffle)',
  schema: {
    state: z
      .boolean()
      .describe('Whether to enable (true) or disable (false) shuffle'),
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to apply shuffle on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { state, deviceId } = args;

    // Call Spotify REST directly and ignore body (204 expected)
    const token = await getAccessTokenString();
    const params = new URLSearchParams({ state: String(state) });
    const targetDeviceId = deviceId || (await getDefaultDeviceId());
    if (targetDeviceId) params.append('device_id', targetDeviceId);
    const url = `https://api.spotify.com/v1/me/player/shuffle?${params.toString()}`;
    try {
      await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (_err) {
      // Intentionally ignore non-JSON or empty-body responses and network hiccups.
    }

    return {
      content: [
        {
          type: 'text',
          text: `Shuffle ${state ? 'enabled' : 'disabled'}`,
        },
      ],
    };
  },
};

const playMusic: tool<{
  uri: z.ZodOptional<z.ZodString>;
  type: z.ZodOptional<z.ZodEnum<['track', 'album', 'artist', 'playlist']>>;
  id: z.ZodOptional<z.ZodString>;
  deviceId: z.ZodOptional<z.ZodString>;
}> = {
  name: 'playMusic',
  description: 'Start playing a Spotify track, album, artist, or playlist',
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
      .describe('The Spotify device ID to play on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { uri, type, id, deviceId } = args;

    if (!(uri || (type && id))) {
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

    let spotifyUri = uri;
    if (!spotifyUri && type && id) {
      spotifyUri = `spotify:${type}:${id}`;
    }

    await handleSpotifyRequest(async (spotifyApi) => {
      // Use provided deviceId, or default device, or empty string
      const targetDeviceId = deviceId || (await getDefaultDeviceId()) || '';

      try {
        // First, try to play directly on the specified (or active) device
        if (spotifyUri) {
          const isTrack =
            spotifyUri.includes('track') || (type && type === 'track');
          if (isTrack) {
            await spotifyApi.player.startResumePlayback(
              targetDeviceId,
              undefined,
              [spotifyUri],
            );
          } else {
            await spotifyApi.player.startResumePlayback(
              targetDeviceId,
              spotifyUri,
            );
          }
        } else {
          await spotifyApi.player.startResumePlayback(targetDeviceId);
        }
      } catch (_error) {
        // If the initial playback fails (e.g., no active device), find and transfer.
        console.error(
          'Initial playback failed, attempting to find and transfer to a device...',
        );
        const devicesResponse = await spotifyApi.player.getAvailableDevices();
        let devices = devicesResponse.devices || [];
        if (devices.length === 0) {
          throw new Error(
            'No available Spotify devices found. Please open Spotify on a device and try again.',
          );
        }

        // Filter out the "Cobertura VAHS" device
        devices = devices.filter((d) => d.name !== 'Cobertura VAHS');

        if (devices.length === 0) {
          throw new Error('No suitable Spotify devices found to play on.');
        }

        // Prioritize default device from config, then provided deviceId, then active, then first
        const config = loadSpotifyConfig();
        const selected =
          (config.defaultDeviceName &&
            devices.find((d) => d.name === config.defaultDeviceName)) ||
          devices.find((d) => d.id === deviceId) ||
          devices.find((d) => d.is_active) ||
          devices[0];

        if (!selected?.id) {
          throw new Error(
            'Could not determine a valid Spotify device to play on.',
          );
        }

        console.error(`Transferring playback to device: ${selected.name}`);
        // Transfer playback to the selected device, which should auto-play.
        await spotifyApi.player.transferPlayback([selected.id], true);

        // After transfer, explicitly start playing the content
        if (spotifyUri) {
          const isTrack =
            spotifyUri.includes('track') || (type && type === 'track');

          if (isTrack) {
            await spotifyApi.player.startResumePlayback(
              selected.id,
              undefined,
              [spotifyUri],
            );
          } else {
            await spotifyApi.player.startResumePlayback(
              selected.id,
              spotifyUri,
            );
          }
        } else {
          // If no URI was provided, just resume playback
          await spotifyApi.player.startResumePlayback(selected.id);
        }
      }
    });

    return {
      content: [
        {
          type: 'text',
          text: `Started playing ${type || 'music'} ${id ? `(ID: ${id})` : ''}`,
        },
      ],
    };
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

    try {
      // Use direct REST API call to avoid JSON parsing issues
      const accessToken = await getAccessTokenString();
      const targetDeviceId = deviceId || (await getDefaultDeviceId());

      const response = await fetch(
        'https://api.spotify.com/v1/me/player/pause',
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          ...(targetDeviceId && {
            body: JSON.stringify({ device_id: targetDeviceId }),
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Spotify API error: ${response.status} ${errorText}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: 'Playback paused',
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error pausing playback: ${
              error instanceof Error ? error.message : String(error)
            }`,
            isError: true,
          },
        ],
      };
    }
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

    try {
      // Use direct REST API call to avoid JSON parsing issues
      const accessToken = await getAccessTokenString();
      const targetDeviceId = deviceId || (await getDefaultDeviceId());

      const response = await fetch(
        'https://api.spotify.com/v1/me/player/next',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          ...(targetDeviceId && {
            body: JSON.stringify({ device_id: targetDeviceId }),
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Spotify API error: ${response.status} ${errorText}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: 'Skipped to next track',
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error skipping to next track: ${
              error instanceof Error ? error.message : String(error)
            }`,
            isError: true,
          },
        ],
      };
    }
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
      const targetDeviceId = deviceId || (await getDefaultDeviceId()) || '';
      await spotifyApi.player.skipToPrevious(targetDeviceId);
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
          text: `Successfully created playlist "${name}"
Playlist ID: ${result.id}`,
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
  description: 'Add tracks to a Spotify playlist',
  schema: {
    playlistId: z.string().describe('The Spotify ID of the playlist'),
    trackIds: z.array(z.string()).describe('Array of Spotify track IDs to add'),
    position: z
      .number()
      .nonnegative()
      .optional()
      .describe('Position to insert the tracks (0-based index)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { playlistId, trackIds, position } = args;

    if (trackIds.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No track IDs provided',
          },
        ],
      };
    }

    try {
      const trackUris = trackIds.map((id) => `spotify:track:${id}`);

      await handleSpotifyRequest(async (spotifyApi) => {
        await spotifyApi.playlists.addItemsToPlaylist(
          playlistId,
          trackUris,
          position,
        );
      });

      return {
        content: [
          {
            type: 'text',
            text: `Successfully added ${trackIds.length} track${
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
            text: `Error adding tracks to playlist: ${
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

    await handleSpotifyRequest(async (spotifyApi) => {
      const targetDeviceId = deviceId || (await getDefaultDeviceId()) || '';
      await spotifyApi.player.startResumePlayback(targetDeviceId);
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Playback resumed',
        },
      ],
    };
  },
};

const addToQueue: tool<{
  uri: z.ZodOptional<z.ZodString>;
  type: z.ZodOptional<
    z.ZodEnum<['track', 'album', 'artist', 'playlist', 'radio']>
  >;
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
      .enum(['track', 'album', 'artist', 'playlist', 'radio'])
      .optional()
      .describe('The type of item to play'),
    id: z.string().optional().describe('The Spotify ID of the item to play'),
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to add the track to'),
  },
  handler: async (args, extra) => {
    const { uri, type, id, deviceId } = args;
    const targetDeviceId = deviceId || (await getDefaultDeviceId());

    let spotifyUri = uri;
    if (!spotifyUri && type && id) {
      spotifyUri = `spotify:${type}:${id}`;
    }

    if (!spotifyUri) {
      if (type === 'radio' && id) {
        try {
          const recommendations = await getRecommendations.handler(
            { seed_tracks: id, limit: 20 },
            extra,
          );
          if (recommendations.content[0].type === 'text') {
            const trackIds = (
              recommendations.content[0].text.match(/ID: (\S+)/g) || []
            ).map((s: string) => s.replace('ID: ', ''));
            for (const trackId of trackIds) {
              try {
                await handleSpotifyRequest(async (spotifyApi) => {
                  await spotifyApi.player.addItemToPlaybackQueue(
                    `spotify:track:${trackId}`,
                    targetDeviceId || undefined,
                  );
                });
              } catch (error) {
                console.error(
                  `Failed to add track ${trackId} to queue:`,
                  error,
                );
                // Continue with other tracks even if one fails
              }
            }
            return {
              content: [
                {
                  type: 'text',
                  text: `Added ${trackIds.length} recommended tracks to queue`,
                },
              ],
            };
          }
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error getting recommendations: ${
                  error instanceof Error ? error.message : String(error)
                }`,
                isError: true,
              },
            ],
          };
        }
      }
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

    try {
      // Use direct REST API call to avoid JSON parsing issues
      const accessToken = await getAccessTokenString();

      // Build the request URL with query parameters
      const url = new URL('https://api.spotify.com/v1/me/player/queue');
      url.searchParams.append('uri', spotifyUri);
      if (targetDeviceId) {
        url.searchParams.append('device_id', targetDeviceId);
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Spotify API error: ${response.status} ${errorText}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: `Added item ${spotifyUri} to queue`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error adding item to queue: ${
              error instanceof Error ? error.message : String(error)
            }`,
            isError: true,
          },
        ],
      };
    }
  },
};

const clearQueue: tool<{
  deviceId: z.ZodOptional<z.ZodString>;
}> = {
  name: 'clearQueue',
  description: 'Clear the Spotify playback queue by playing a single track',
  schema: {
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to clear queue on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { deviceId } = args;

    try {
      // Use direct REST API call to clear queue by playing a single track
      const accessToken = await getAccessTokenString();

      // Play a silent track to effectively clear the queue
      const targetDeviceId = deviceId || (await getDefaultDeviceId());
      const response = await fetch(
        'https://api.spotify.com/v1/me/player/play',
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            uris: ['spotify:track:3gVhsZtseYtY1fMuyYq06F'], // Play Sonne to clear queue
            ...(targetDeviceId && { device_id: targetDeviceId }),
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Spotify API error: ${response.status} ${errorText}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: 'Queue cleared - now playing single track',
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error clearing queue: ${
              error instanceof Error ? error.message : String(error)
            }`,
            isError: true,
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
  setShuffle,
  clearQueue,
];
