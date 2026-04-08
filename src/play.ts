import { z } from 'zod';
import type { SpotifyHandlerExtra, tool } from './types.js';
import { formatDuration, handleSpotifyRequest } from './utils.js';

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
      const device = deviceId || '';

      // When playing an album or playlist, turn off shuffle so it plays in order
      if (type === 'album') {
        try {
          await spotifyApi.player.togglePlaybackShuffle(false, device);
        } catch (_) {
          // Ignore shuffle toggle errors (e.g. no active device yet)
        }
      }

      if (!spotifyUri) {
        await spotifyApi.player.startResumePlayback(device);
        return;
      }

      if (type === 'track') {
        await spotifyApi.player.startResumePlayback(device, undefined, [
          spotifyUri,
        ]);
      } else {
        await spotifyApi.player.startResumePlayback(device, spotifyUri);
      }
    });

    return {
      content: [
        {
          type: 'text',
          text: `Started playing ${type || 'music'} ${id ? `(ID: ${id})` : ''}${type === 'album' ? ' (shuffle turned off)' : ''}`,
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
  description:
    'Skip to the next track in the current Spotify playback queue and display the new track info',
  schema: {
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to skip on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { deviceId } = args;

    try {
      // Skip to next track
      await handleSpotifyRequest(async (spotifyApi) => {
        await spotifyApi.player.skipToNext(deviceId || '');
      });

      // Add a small delay to let Spotify catch up
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Fetch and display the now-playing track
      const playback = await handleSpotifyRequest(async (spotifyApi) => {
        return await spotifyApi.player.getPlaybackState();
      });

      if (!playback?.item) {
        return {
          content: [
            {
              type: 'text',
              text: 'Skipped to next track\n\nNo track is currently playing',
            },
          ],
        };
      }

      const item = playback.item as any;

      // Check if it's a track
      if (item.type === 'track' && item.artists && item.album) {
        const artists = item.artists.map((a: any) => a.name).join(', ');
        const album = item.album?.name || 'Unknown';
        const duration = formatDuration(item.duration_ms);
        const progress = formatDuration(playback.progress_ms || 0);

        const device = playback.device;
        const deviceInfo = device
          ? `${device.name} (${device.type})`
          : 'Unknown device';
        const volume =
          device?.volume_percent !== null &&
          device?.volume_percent !== undefined
            ? `${device.volume_percent}%`
            : 'N/A';
        const shuffle = playback.shuffle_state ? 'On' : 'Off';
        const repeat = playback.repeat_state || 'off';

        return {
          content: [
            {
              type: 'text',
              text: `# Skipped to next track\n\n**Track**: "${item.name}"\n**Artist**: ${artists}\n**Album**: ${album}\n**Progress**: ${progress} / ${duration}\n**ID**: ${item.id}\n\n**Device**: ${deviceInfo}\n**Volume**: ${volume}\n**Shuffle**: ${shuffle} | **Repeat**: ${repeat}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: 'Skipped to next track\n\nCurrently playing item is not a track (might be a podcast episode)',
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
    'Skip to the previous track in the current Spotify playback queue and display the new track info',
  schema: {
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to skip on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { deviceId } = args;

    try {
      // Skip to previous track
      await handleSpotifyRequest(async (spotifyApi) => {
        await spotifyApi.player.skipToPrevious(deviceId || '');
      });

      // Add a small delay to let Spotify catch up
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Fetch and display the now-playing track
      const playback = await handleSpotifyRequest(async (spotifyApi) => {
        return await spotifyApi.player.getPlaybackState();
      });

      if (!playback?.item) {
        return {
          content: [
            {
              type: 'text',
              text: 'Skipped to previous track\n\nNo track is currently playing',
            },
          ],
        };
      }

      const item = playback.item as any;

      // Check if it's a track
      if (item.type === 'track' && item.artists && item.album) {
        const artists = item.artists.map((a: any) => a.name).join(', ');
        const album = item.album?.name || 'Unknown';
        const duration = formatDuration(item.duration_ms);
        const progress = formatDuration(playback.progress_ms || 0);
        const _isPlaying = playback.is_playing;

        const device = playback.device;
        const deviceInfo = device
          ? `${device.name} (${device.type})`
          : 'Unknown device';
        const volume =
          device?.volume_percent !== null &&
          device?.volume_percent !== undefined
            ? `${device.volume_percent}%`
            : 'N/A';
        const shuffle = playback.shuffle_state ? 'On' : 'Off';
        const repeat = playback.repeat_state || 'off';

        return {
          content: [
            {
              type: 'text',
              text: `# Skipped to previous track\n\n**Track**: "${item.name}"\n**Artist**: ${artists}\n**Album**: ${album}\n**Progress**: ${progress} / ${duration}\n**ID**: ${item.id}\n\n**Device**: ${deviceInfo}\n**Volume**: ${volume}\n**Shuffle**: ${shuffle} | **Repeat**: ${repeat}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: 'Skipped to previous track\n\nCurrently playing item is not a track (might be a podcast episode)',
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error skipping to previous track: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
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
      await spotifyApi.player.startResumePlayback(deviceId || '');
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

const setShuffle: tool<{
  state: z.ZodBoolean;
  deviceId: z.ZodOptional<z.ZodString>;
}> = {
  name: 'setShuffle',
  description:
    'Turn shuffle on or off for the current playback. Requires Spotify Premium.',
  schema: {
    state: z.boolean().describe('true to turn shuffle on, false to turn it off'),
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to set shuffle on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { state, deviceId } = args;

    try {
      await handleSpotifyRequest(async (spotifyApi) => {
        await spotifyApi.player.togglePlaybackShuffle(state, deviceId || '');
      });

      return {
        content: [
          {
            type: 'text',
            text: `Shuffle turned ${state ? 'on' : 'off'}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error setting shuffle: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const setRepeat: tool<{
  state: z.ZodEnum<['off', 'track', 'context']>;
  deviceId: z.ZodOptional<z.ZodString>;
}> = {
  name: 'setRepeat',
  description:
    'Set the repeat mode for playback. "off" disables repeat, "track" repeats the current track, "context" repeats the current album/playlist. Requires Spotify Premium.',
  schema: {
    state: z
      .enum(['off', 'track', 'context'])
      .describe('Repeat mode: "off", "track", or "context" (album/playlist)'),
    deviceId: z
      .string()
      .optional()
      .describe('The Spotify device ID to set repeat on'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { state, deviceId } = args;

    try {
      await handleSpotifyRequest(async (spotifyApi) => {
        await spotifyApi.player.setRepeatMode(state, deviceId || '');
      });

      const modeDescription =
        state === 'off'
          ? 'off'
          : state === 'track'
            ? 'on (current track)'
            : 'on (album/playlist)';

      return {
        content: [
          {
            type: 'text',
            text: `Repeat set to ${modeDescription}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error setting repeat: ${
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
  setShuffle,
  setRepeat,
];
