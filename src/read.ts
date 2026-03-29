import type { MaxInt } from '@spotify/web-api-ts-sdk';
import { z } from 'zod';
import type { SpotifyHandlerExtra, SpotifyTrack, tool } from './types.js';
import {
  formatDuration,
  getValidConfig,
  handleSpotifyRequest,
} from './utils.js';

function isTrack(item: any): item is SpotifyTrack {
  return (
    item &&
    item.type === 'track' &&
    Array.isArray(item.artists) &&
    item.album &&
    typeof item.album.name === 'string'
  );
}

const searchSpotify: tool<{
  query: z.ZodString;
  type: z.ZodEnum<['track', 'album', 'artist', 'playlist']>;
  limit: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'searchSpotify',
  description: 'Search for tracks, albums, artists, or playlists on Spotify',
  schema: {
    query: z.string().describe('The search query'),
    type: z
      .enum(['track', 'album', 'artist', 'playlist'])
      .describe(
        'The type of item to search for either track, album, artist, or playlist',
      ),
    limit: z
      .number()
      .min(1)
      .max(10)
      .optional()
      .describe('Maximum number of results to return (1-10)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { query, type, limit } = args;
    const limitValue = Math.min(limit ?? 10, 10);

    try {
      const results = await handleSpotifyRequest(async (spotifyApi) => {
        return await spotifyApi.search(
          query,
          [type],
          undefined,
          limitValue as MaxInt<50>,
        );
      });

      let formattedResults = '';

      if (type === 'track' && results.tracks) {
        formattedResults = results.tracks.items
          .map((track, i) => {
            const artists = track.artists.map((a) => a.name).join(', ');
            const duration = formatDuration(track.duration_ms);
            return `${i + 1}. "${
              track.name
            }" by ${artists} (${duration}) - ID: ${track.id}`;
          })
          .join('\n');
      } else if (type === 'album' && results.albums) {
        formattedResults = results.albums.items
          .map((album, i) => {
            const artists = album.artists.map((a) => a.name).join(', ');
            return `${i + 1}. "${album.name}" by ${artists} - ID: ${album.id}`;
          })
          .join('\n');
      } else if (type === 'artist' && results.artists) {
        formattedResults = results.artists.items
          .map((artist, i) => {
            return `${i + 1}. ${artist.name} - ID: ${artist.id}`;
          })
          .join('\n');
      } else if (type === 'playlist' && results.playlists) {
        formattedResults = results.playlists.items
          .map((playlist, i) => {
            return `${i + 1}. "${playlist?.name ?? 'Unknown Playlist'} (${
              playlist?.description ?? 'No description'
            } tracks)" by ${playlist?.owner?.display_name} - ID: ${
              playlist?.id
            }`;
          })
          .join('\n');
      }

      return {
        content: [
          {
            type: 'text',
            text:
              formattedResults.length > 0
                ? `# Search results for "${query}" (type: ${type})\n\n${formattedResults}`
                : `No ${type} results found for "${query}"`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error searching for ${type}s: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const getNowPlaying: tool<Record<string, never>> = {
  name: 'getNowPlaying',
  description:
    'Get information about the currently playing track on Spotify, including device and volume info',
  schema: {},
  handler: async (_args, _extra: SpotifyHandlerExtra) => {
    try {
      const playback = await handleSpotifyRequest(async (spotifyApi) => {
        return await spotifyApi.player.getPlaybackState();
      });

      if (!playback?.item) {
        return {
          content: [
            {
              type: 'text',
              text: 'Nothing is currently playing on Spotify',
            },
          ],
        };
      }

      const item = playback.item;

      if (!isTrack(item)) {
        return {
          content: [
            {
              type: 'text',
              text: 'Currently playing item is not a track (might be a podcast episode)',
            },
          ],
        };
      }

      const artists = item.artists.map((a) => a.name).join(', ');
      const album = item.album.name;
      const duration = formatDuration(item.duration_ms);
      const progress = formatDuration(playback.progress_ms || 0);
      const isPlaying = playback.is_playing;

      const device = playback.device;
      const deviceInfo = device
        ? `${device.name} (${device.type})`
        : 'Unknown device';
      const volume =
        device?.volume_percent !== null && device?.volume_percent !== undefined
          ? `${device.volume_percent}%`
          : 'N/A';
      const shuffle = playback.shuffle_state ? 'On' : 'Off';
      const repeat = playback.repeat_state || 'off';

      return {
        content: [
          {
            type: 'text',
            text:
              `# Currently ${isPlaying ? 'Playing' : 'Paused'}\n\n` +
              `**Track**: "${item.name}"\n` +
              `**Artist**: ${artists}\n` +
              `**Album**: ${album}\n` +
              `**Progress**: ${progress} / ${duration}\n` +
              `**ID**: ${item.id}\n\n` +
              `**Device**: ${deviceInfo}\n` +
              `**Volume**: ${volume}\n` +
              `**Shuffle**: ${shuffle} | **Repeat**: ${repeat}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting current track: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const getMyPlaylists: tool<{
  limit: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'getMyPlaylists',
  description: "Get a list of the current user's playlists on Spotify",
  schema: {
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum number of playlists to return (1-50)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { limit = 50 } = args;

    const playlists = await handleSpotifyRequest(async (spotifyApi) => {
      return await spotifyApi.currentUser.playlists.playlists(
        limit as MaxInt<50>,
      );
    });

    if (playlists.items.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: "You don't have any playlists on Spotify",
          },
        ],
      };
    }

    const formattedPlaylists = playlists.items
      .map((playlist, i) => {
        const tracksTotal = (playlist as any).items?.total ?? 0;
        return `${i + 1}. "${playlist.name}" (${tracksTotal} tracks) - ID: ${
          playlist.id
        }`;
      })
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `# Your Spotify Playlists\n\n${formattedPlaylists}`,
        },
      ],
    };
  },
};

const getPlaylistTracks: tool<{
  playlistId: z.ZodString;
  limit: z.ZodOptional<z.ZodNumber>;
  offset: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'getPlaylistTracks',
  description: 'Get a list of tracks in a Spotify playlist',
  schema: {
    playlistId: z.string().describe('The Spotify ID of the playlist'),
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum number of tracks to return (1-50)'),
    offset: z
      .number()
      .min(0)
      .optional()
      .describe('Offset for pagination (0-based index)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { playlistId, limit = 50, offset = 0 } = args;

    const config = await getValidConfig();
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });

    const response = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistId}/items?${params}`,
      { headers: { Authorization: `Bearer ${config.accessToken}` } },
    );

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Failed to get playlist tracks: ${errorData}`);
    }

    const playlistTracks = await response.json();

    if ((playlistTracks.items?.length ?? 0) === 0) {
      return {
        content: [
          {
            type: 'text',
            text: "This playlist doesn't have any tracks",
          },
        ],
      };
    }

    const formattedTracks = playlistTracks.items
      .map((item: any, i: number) => {
        const track = item.item ?? item.track;
        if (!track) return `${offset + i + 1}. [Removed track]`;

        if (isTrack(track)) {
          const artists = track.artists.map((a: any) => a.name).join(', ');
          const duration = formatDuration(track.duration_ms);
          return `${offset + i + 1}. "${track.name}" by ${artists} (${duration}) - ID: ${track.id}`;
        }

        return `${offset + i + 1}. Unknown item`;
      })
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `# Tracks in Playlist (${offset + 1}-${offset + playlistTracks.items.length} of ${playlistTracks.total})\n\n${formattedTracks}`,
        },
      ],
    };
  },
};

const getRecentlyPlayed: tool<{
  limit: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'getRecentlyPlayed',
  description: 'Get a list of recently played tracks on Spotify',
  schema: {
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum number of tracks to return (1-50)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { limit = 50 } = args;

    const history = await handleSpotifyRequest(async (spotifyApi) => {
      return await spotifyApi.player.getRecentlyPlayedTracks(
        limit as MaxInt<50>,
      );
    });

    if (history.items.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: "You don't have any recently played tracks on Spotify",
          },
        ],
      };
    }

    const formattedHistory = history.items
      .map((item, i) => {
        const track = item.track;
        if (!track) return `${i + 1}. [Removed track]`;

        if (isTrack(track)) {
          const artists = track.artists.map((a) => a.name).join(', ');
          const duration = formatDuration(track.duration_ms);
          const playedAt = item.played_at
            ? new Date(item.played_at).toLocaleString()
            : 'Unknown time';
          return `${i + 1}. "${track.name}" by ${artists} (${duration}) - ID: ${track.id} - Played at: ${playedAt}`;
        }

        return `${i + 1}. Unknown item`;
      })
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `# Recently Played Tracks\n\n${formattedHistory}`,
        },
      ],
    };
  },
};

const getUsersSavedTracks: tool<{
  limit: z.ZodOptional<z.ZodNumber>;
  offset: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'getUsersSavedTracks',
  description:
    'Get a list of tracks saved in the user\'s "Liked Songs" library',
  schema: {
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum number of tracks to return (1-50)'),
    offset: z
      .number()
      .min(0)
      .optional()
      .describe('Offset for pagination (0-based index)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { limit = 50, offset = 0 } = args;

    const savedTracks = await handleSpotifyRequest(async (spotifyApi) => {
      return await spotifyApi.currentUser.tracks.savedTracks(
        limit as MaxInt<50>,
        offset,
      );
    });

    if (savedTracks.items.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: "You don't have any saved tracks in your Liked Songs",
          },
        ],
      };
    }

    const formattedTracks = savedTracks.items
      .map((item, i) => {
        const track = item.track;
        if (!track) return `${i + 1}. [Removed track]`;

        if (isTrack(track)) {
          const artists = track.artists.map((a) => a.name).join(', ');
          const duration = formatDuration(track.duration_ms);
          const addedDate = new Date(item.added_at).toLocaleDateString();
          return `${offset + i + 1}. "${track.name}" by ${artists} (${duration}) - ID: ${track.id} - Added: ${addedDate}`;
        }

        return `${i + 1}. Unknown item`;
      })
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `# Your Liked Songs (${offset + 1}-${offset + savedTracks.items.length} of ${savedTracks.total})\n\n${formattedTracks}`,
        },
      ],
    };
  },
};

const getQueue: tool<{
  limit: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'getQueue',
  description:
    'Get a list of the currently playing track and the next items in your Spotify queue',
  schema: {
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum number of upcoming items to show (1-50)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { limit = 10 } = args;

    try {
      const queue = await handleSpotifyRequest(async (spotifyApi) => {
        return await spotifyApi.player.getUsersQueue();
      });

      const current = (queue as any)?.currently_playing;
      const upcoming = ((queue as any)?.queue ?? []) as any[];

      const header = '# Spotify Queue\n\n';

      let currentText = 'Nothing is currently playing';
      if (current) {
        const name = current?.name ?? 'Unknown';
        const artists = Array.isArray(current?.artists)
          ? (current.artists as Array<{ name: string }>)
              .map((a) => a.name)
              .join(', ')
          : 'Unknown';
        const duration =
          typeof current?.duration_ms === 'number'
            ? formatDuration(current.duration_ms)
            : 'Unknown';
        currentText = `Currently Playing: "${name}" by ${artists} (${duration})`;
      }

      if (upcoming.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `${header}${currentText}\n\nNo upcoming items in the queue`,
            },
          ],
        };
      }

      const toShow = upcoming.slice(0, limit);
      const formatted = toShow
        .map((track, i) => {
          const name = track?.name ?? 'Unknown';
          const artists = Array.isArray(track?.artists)
            ? (track.artists as Array<{ name: string }>)
                .map((a) => a.name)
                .join(', ')
            : 'Unknown';
          const duration =
            typeof track?.duration_ms === 'number'
              ? formatDuration(track.duration_ms)
              : 'Unknown';
          const id = track?.id ?? 'Unknown';
          return `${i + 1}. "${name}" by ${artists} (${duration}) - ID: ${id}`;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `${header}${currentText}\n\nNext ${toShow.length} in queue:\n\n${formatted}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching queue: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const getAvailableDevices: tool<Record<string, never>> = {
  name: 'getAvailableDevices',
  description:
    "Get information about the user's available Spotify Connect devices",
  schema: {},
  handler: async (_args, _extra: SpotifyHandlerExtra) => {
    try {
      const devices = await handleSpotifyRequest(async (spotifyApi) => {
        return await spotifyApi.player.getAvailableDevices();
      });

      if (!devices.devices || devices.devices.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No available devices found. Make sure Spotify is open on at least one device.',
            },
          ],
        };
      }

      const formattedDevices = devices.devices
        .map((device, i) => {
          const status = device.is_active ? '▶ Active' : '○ Inactive';
          const volume =
            device.volume_percent !== null
              ? `${device.volume_percent}%`
              : 'N/A';
          const restricted = device.is_restricted ? ' (Restricted)' : '';
          return `${i + 1}. ${device.name} (${device.type})${restricted}\n   Status: ${status} | Volume: ${volume} | ID: ${device.id}`;
        })
        .join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `# Available Spotify Devices\n\n${formattedDevices}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting available devices: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const saveUsersTracks: tool<{
  trackIds: z.ZodArray<z.ZodString>;
}> = {
  name: 'saveUsersTracks',
  description: 'Save (like) one or more tracks to the user\'s "Liked Songs" library (max 50 per request)',
  schema: {
    trackIds: z
      .array(z.string())
      .max(50)
      .describe('Array of Spotify track IDs to save (max 50)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { trackIds } = args;

    if (trackIds.length === 0) {
      return {
        content: [{ type: 'text', text: 'Error: No track IDs provided' }],
      };
    }

    try {
      const config = await getValidConfig();
      const uris = trackIds.map((id) => `spotify:track:${id}`).join(',');

      const response = await fetch(
        `https://api.spotify.com/v1/me/library?uris=${encodeURIComponent(uris)}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
          },
        },
      );

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to save tracks: ${errorData}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: `Successfully saved ${trackIds.length} track${trackIds.length === 1 ? '' : 's'} to your Liked Songs`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error saving tracks to Liked Songs: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const removeUsersSavedTracks: tool<{
  trackIds: z.ZodArray<z.ZodString>;
}> = {
  name: 'removeUsersSavedTracks',
  description:
    'Remove one or more tracks from the user\'s "Liked Songs" library (max 40 per request)',
  schema: {
    trackIds: z
      .array(z.string())
      .max(40)
      .describe('Array of Spotify track IDs to remove (max 40)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { trackIds } = args;

    if (trackIds.length === 0) {
      return {
        content: [{ type: 'text', text: 'Error: No track IDs provided' }],
      };
    }

    try {
      const config = await getValidConfig();

      const uris = trackIds.map((id) => `spotify:track:${id}`).join(',');
      const response = await fetch(
        `https://api.spotify.com/v1/me/library?uris=${encodeURIComponent(uris)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
          },
        },
      );

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Spotify API error ${response.status}: ${errorData}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: `Successfully removed ${trackIds.length} track${trackIds.length === 1 ? '' : 's'} from your Liked Songs`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error removing tracks from Liked Songs: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const followArtists: tool<{
  artistIds: z.ZodArray<z.ZodString>;
  action: z.ZodEnum<['follow', 'unfollow']>;
}> = {
  name: 'followArtists',
  description: 'Follow or unfollow one or more Spotify artists',
  schema: {
    artistIds: z.array(z.string()).min(1).describe('Array of Spotify artist IDs'),
    action: z.enum(['follow', 'unfollow']).describe("'follow' to follow, 'unfollow' to unfollow"),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { artistIds, action } = args;
    try {
      const config = await getValidConfig();
      const uris = artistIds.map((id) => `spotify:artist:${id}`).join(',');
      const response = await fetch(
        `https://api.spotify.com/v1/me/library?uris=${encodeURIComponent(uris)}`,
        {
          method: action === 'follow' ? 'PUT' : 'DELETE',
          headers: { Authorization: `Bearer ${config.accessToken}` },
        },
      );
      if (!response.ok) throw new Error(await response.text());
      const verb = action === 'follow' ? 'Following' : 'Unfollowed';
      return { content: [{ type: 'text', text: `${verb} ${artistIds.length} artist${artistIds.length === 1 ? '' : 's'}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error ${args.action}ing artists: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  },
};

const getFollowedArtists: tool<{
  limit: z.ZodOptional<z.ZodNumber>;
  after: z.ZodOptional<z.ZodString>;
}> = {
  name: 'getFollowedArtists',
  description: "Get artists followed by the current user",
  schema: {
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum number of artists to return (1-50)'),
    after: z
      .string()
      .optional()
      .describe('The last artist ID from a previous request for pagination'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { limit = 50, after } = args;

    try {
      const config = await getValidConfig();
      const params = new URLSearchParams({ type: 'artist', limit: String(limit) });
      if (after) params.set('after', after);

      const response = await fetch(
        `https://api.spotify.com/v1/me/following?${params}`,
        { headers: { Authorization: `Bearer ${config.accessToken}` } },
      );

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to get followed artists: ${errorData}`);
      }

      const data = await response.json();
      const artists = data.artists;

      if (artists.items.length === 0) {
        return {
          content: [{ type: 'text', text: "You aren't following any artists" }],
        };
      }

      const formatted = artists.items
        .map((a: any, i: number) => `${i + 1}. ${a.name} - ID: ${a.id}`)
        .join('\n');

      const nextCursor = artists.cursors?.after
        ? `\n\nNext page cursor: ${artists.cursors.after}`
        : '';

      return {
        content: [
          {
            type: 'text',
            text: `# Followed Artists (${artists.items.length} of ${artists.total})\n\n${formatted}${nextCursor}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting followed artists: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
};

const getSavedAudiobooks: tool<{
  limit: z.ZodOptional<z.ZodNumber>;
  offset: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'getSavedAudiobooks',
  description: "Get audiobooks saved in the current user's library",
  schema: {
    limit: z.number().min(1).max(50).optional().describe('Maximum number of audiobooks to return (1-50)'),
    offset: z.number().min(0).optional().describe('Offset for pagination'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { limit = 20, offset = 0 } = args;

    try {
      const config = await getValidConfig();
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });

      const response = await fetch(
        `https://api.spotify.com/v1/me/audiobooks?${params}`,
        { headers: { Authorization: `Bearer ${config.accessToken}` } },
      );

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to get saved audiobooks: ${errorData}`);
      }

      const data = await response.json();

      if (data.items.length === 0) {
        return {
          content: [{ type: 'text', text: "You don't have any saved audiobooks" }],
        };
      }

      const formatted = data.items
        .map((item: any, i: number) => {
          const b = item.audiobook ?? item;
          const authors = b.authors?.map((a: any) => a.name).join(', ') ?? 'Unknown';
          return `${offset + i + 1}. "${b.name}" by ${authors} - ID: ${b.id}`;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `# Saved Audiobooks (${offset + 1}-${offset + data.items.length} of ${data.total})\n\n${formatted}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting saved audiobooks: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
};

const getSavedEpisodes: tool<{
  limit: z.ZodOptional<z.ZodNumber>;
  offset: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'getSavedEpisodes',
  description: "Get podcast episodes saved in the current user's library",
  schema: {
    limit: z.number().min(1).max(50).optional().describe('Maximum number of episodes to return (1-50)'),
    offset: z.number().min(0).optional().describe('Offset for pagination'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { limit = 20, offset = 0 } = args;

    try {
      const config = await getValidConfig();
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });

      const response = await fetch(
        `https://api.spotify.com/v1/me/episodes?${params}`,
        { headers: { Authorization: `Bearer ${config.accessToken}` } },
      );

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to get saved episodes: ${errorData}`);
      }

      const data = await response.json();

      if (data.items.length === 0) {
        return {
          content: [{ type: 'text', text: "You don't have any saved episodes" }],
        };
      }

      const formatted = data.items
        .map((item: any, i: number) => {
          const ep = item.episode ?? item;
          const duration = formatDuration(ep.duration_ms);
          return `${offset + i + 1}. "${ep.name}" (${duration}) - ID: ${ep.id}`;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `# Saved Episodes (${offset + 1}-${offset + data.items.length} of ${data.total})\n\n${formatted}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting saved episodes: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
};

const getSavedShows: tool<{
  limit: z.ZodOptional<z.ZodNumber>;
  offset: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'getSavedShows',
  description: "Get podcast shows saved in the current user's library",
  schema: {
    limit: z.number().min(1).max(50).optional().describe('Maximum number of shows to return (1-50)'),
    offset: z.number().min(0).optional().describe('Offset for pagination'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { limit = 20, offset = 0 } = args;

    try {
      const config = await getValidConfig();
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });

      const response = await fetch(
        `https://api.spotify.com/v1/me/shows?${params}`,
        { headers: { Authorization: `Bearer ${config.accessToken}` } },
      );

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to get saved shows: ${errorData}`);
      }

      const data = await response.json();

      if (data.items.length === 0) {
        return {
          content: [{ type: 'text', text: "You don't have any saved shows" }],
        };
      }

      const formatted = data.items
        .map((item: any, i: number) => {
          const show = item.show ?? item;
          return `${offset + i + 1}. "${show.name}" - ${show.total_episodes} episodes - ID: ${show.id}`;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `# Saved Shows (${offset + 1}-${offset + data.items.length} of ${data.total})\n\n${formatted}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting saved shows: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
};

const getUserTopItems: tool<{
  type: z.ZodEnum<['artists', 'tracks']>;
  timeRange: z.ZodOptional<z.ZodEnum<['short_term', 'medium_term', 'long_term']>>;
  limit: z.ZodOptional<z.ZodNumber>;
  offset: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'getUserTopItems',
  description: "Get the current user's top artists or tracks over a given time range",
  schema: {
    type: z.enum(['artists', 'tracks']).describe("Type of items to retrieve: 'artists' or 'tracks'"),
    timeRange: z
      .enum(['short_term', 'medium_term', 'long_term'])
      .optional()
      .describe("Time range: 'short_term' (~4 weeks), 'medium_term' (~6 months), 'long_term' (all time). Default: medium_term"),
    limit: z.number().min(1).max(50).optional().describe('Maximum number of items to return (1-50)'),
    offset: z.number().min(0).optional().describe('Offset for pagination'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { type, timeRange = 'medium_term', limit = 20, offset = 0 } = args;
    try {
      const config = await getValidConfig();
      const params = new URLSearchParams({ time_range: timeRange, limit: String(limit), offset: String(offset) });
      const response = await fetch(`https://api.spotify.com/v1/me/top/${type}?${params}`, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      if (data.items.length === 0) return { content: [{ type: 'text', text: `No top ${type} found` }] };
      const formatted = data.items
        .map((item: any, i: number) => {
          if (type === 'artists') return `${offset + i + 1}. ${item.name} - ID: ${item.id}`;
          const artists = item.artists?.map((a: any) => a.name).join(', ');
          return `${offset + i + 1}. "${item.name}" by ${artists} - ID: ${item.id}`;
        })
        .join('\n');
      const rangeLabel: Record<string, string> = { short_term: '~4 weeks', medium_term: '~6 months', long_term: 'all time' };
      return {
        content: [{
          type: 'text',
          text: `# Your Top ${type === 'artists' ? 'Artists' : 'Tracks'} (${rangeLabel[timeRange]})\n\n${formatted}`,
        }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error getting top ${type}: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  },
};

const getCurrentUserProfile: tool<Record<string, never>> = {
  name: 'getCurrentUserProfile',
  description: 'Get profile information for the current authenticated Spotify user',
  schema: {},
  handler: async (_args, _extra: SpotifyHandlerExtra) => {
    try {
      const config = await getValidConfig();
      const response = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!response.ok) throw new Error(await response.text());
      const u = await response.json();
      return {
        content: [{
          type: 'text',
          text: `# ${u.display_name ?? u.id}\n\n**ID**: ${u.id}\n**URI**: ${u.uri}\n**Profile URL**: ${u.external_urls?.spotify ?? 'N/A'}`,
        }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error getting profile: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  },
};

const getArtist: tool<{ artistId: z.ZodString }> = {
  name: 'getArtist',
  description: 'Get metadata for a single Spotify artist',
  schema: { artistId: z.string().describe('The Spotify ID of the artist') },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    try {
      const config = await getValidConfig();
      const response = await fetch(`https://api.spotify.com/v1/artists/${args.artistId}`, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!response.ok) throw new Error(await response.text());
      const a = await response.json();
      const genres = a.genres?.join(', ') || 'N/A';
      return {
        content: [{
          type: 'text',
          text: `# ${a.name}\n\n**Genres**: ${genres}\n**ID**: ${a.id}\n**URI**: ${a.uri}`,
        }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error getting artist: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  },
};

const getArtistAlbums: tool<{
  artistId: z.ZodString;
  limit: z.ZodOptional<z.ZodNumber>;
  offset: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'getArtistAlbums',
  description: "Get albums released by a Spotify artist",
  schema: {
    artistId: z.string().describe('The Spotify ID of the artist'),
    limit: z.number().min(1).max(50).optional().describe('Maximum number of albums to return (1-50)'),
    offset: z.number().min(0).optional().describe('Offset for pagination'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { artistId, limit = 20, offset = 0 } = args;
    try {
      const config = await getValidConfig();
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      const response = await fetch(`https://api.spotify.com/v1/artists/${artistId}/albums?${params}`, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      if (data.items.length === 0) return { content: [{ type: 'text', text: 'No albums found for this artist' }] };
      const formatted = data.items
        .map((a: any, i: number) => `${offset + i + 1}. "${a.name}" (${a.album_type}, ${a.release_date}) - ID: ${a.id}`)
        .join('\n');
      return { content: [{ type: 'text', text: `# Albums by Artist (${offset + 1}-${offset + data.items.length} of ${data.total})\n\n${formatted}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error getting artist albums: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  },
};

const getTrack: tool<{ trackId: z.ZodString }> = {
  name: 'getTrack',
  description: 'Get metadata for a single Spotify track',
  schema: { trackId: z.string().describe('The Spotify ID of the track') },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    try {
      const config = await getValidConfig();
      const response = await fetch(`https://api.spotify.com/v1/tracks/${args.trackId}`, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!response.ok) throw new Error(await response.text());
      const t = await response.json();
      const artists = t.artists.map((a: any) => a.name).join(', ');
      const duration = formatDuration(t.duration_ms);
      return {
        content: [{
          type: 'text',
          text: `# "${t.name}"\n\n**Artists**: ${artists}\n**Album**: ${t.album?.name}\n**Duration**: ${duration}\n**ID**: ${t.id}\n**URI**: ${t.uri}`,
        }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error getting track: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  },
};

const getShow: tool<{ showId: z.ZodString }> = {
  name: 'getShow',
  description: 'Get metadata for a single Spotify podcast show',
  schema: { showId: z.string().describe('The Spotify ID of the show') },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    try {
      const config = await getValidConfig();
      const response = await fetch(`https://api.spotify.com/v1/shows/${args.showId}`, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!response.ok) throw new Error(await response.text());
      const s = await response.json();
      return {
        content: [{
          type: 'text',
          text: `# "${s.name}"\n\n**Total Episodes**: ${s.total_episodes}\n**ID**: ${s.id}\n**URI**: ${s.uri}`,
        }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error getting show: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  },
};

const getShowEpisodes: tool<{
  showId: z.ZodString;
  limit: z.ZodOptional<z.ZodNumber>;
  offset: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'getShowEpisodes',
  description: 'Get episodes belonging to a Spotify podcast show',
  schema: {
    showId: z.string().describe('The Spotify ID of the show'),
    limit: z.number().min(1).max(50).optional().describe('Maximum number of episodes to return (1-50)'),
    offset: z.number().min(0).optional().describe('Offset for pagination'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { showId, limit = 20, offset = 0 } = args;
    try {
      const config = await getValidConfig();
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      const response = await fetch(`https://api.spotify.com/v1/shows/${showId}/episodes?${params}`, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      if (data.items.length === 0) return { content: [{ type: 'text', text: 'No episodes found' }] };
      const formatted = data.items
        .map((ep: any, i: number) => `${offset + i + 1}. "${ep.name}" (${formatDuration(ep.duration_ms)}) - ID: ${ep.id}`)
        .join('\n');
      return { content: [{ type: 'text', text: `# Episodes (${offset + 1}-${offset + data.items.length} of ${data.total})\n\n${formatted}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error getting show episodes: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  },
};

const getEpisode: tool<{ episodeId: z.ZodString }> = {
  name: 'getEpisode',
  description: 'Get metadata for a single Spotify podcast episode',
  schema: { episodeId: z.string().describe('The Spotify ID of the episode') },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    try {
      const config = await getValidConfig();
      const response = await fetch(`https://api.spotify.com/v1/episodes/${args.episodeId}`, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!response.ok) throw new Error(await response.text());
      const ep = await response.json();
      const duration = formatDuration(ep.duration_ms);
      return {
        content: [{
          type: 'text',
          text: `# "${ep.name}"\n\n**Show**: ${ep.show?.name}\n**Duration**: ${duration}\n**Release Date**: ${ep.release_date}\n**ID**: ${ep.id}\n**URI**: ${ep.uri}`,
        }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error getting episode: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  },
};

const getAudiobook: tool<{ audiobookId: z.ZodString }> = {
  name: 'getAudiobook',
  description: 'Get metadata for a single Spotify audiobook',
  schema: { audiobookId: z.string().describe('The Spotify ID of the audiobook') },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    try {
      const config = await getValidConfig();
      const response = await fetch(`https://api.spotify.com/v1/audiobooks/${args.audiobookId}`, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!response.ok) throw new Error(await response.text());
      const b = await response.json();
      const authors = b.authors?.map((a: any) => a.name).join(', ') || 'Unknown';
      return {
        content: [{
          type: 'text',
          text: `# "${b.name}"\n\n**Authors**: ${authors}\n**Total Chapters**: ${b.total_chapters}\n**ID**: ${b.id}\n**URI**: ${b.uri}`,
        }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error getting audiobook: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  },
};

const getAudiobookChapters: tool<{
  audiobookId: z.ZodString;
  limit: z.ZodOptional<z.ZodNumber>;
  offset: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'getAudiobookChapters',
  description: 'Get chapters belonging to a Spotify audiobook',
  schema: {
    audiobookId: z.string().describe('The Spotify ID of the audiobook'),
    limit: z.number().min(1).max(50).optional().describe('Maximum number of chapters to return (1-50)'),
    offset: z.number().min(0).optional().describe('Offset for pagination'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { audiobookId, limit = 20, offset = 0 } = args;
    try {
      const config = await getValidConfig();
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      const response = await fetch(`https://api.spotify.com/v1/audiobooks/${audiobookId}/chapters?${params}`, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      if (data.items.length === 0) return { content: [{ type: 'text', text: 'No chapters found' }] };
      const formatted = data.items
        .map((ch: any, i: number) => `${offset + i + 1}. "${ch.name}" (${formatDuration(ch.duration_ms)}) - ID: ${ch.id}`)
        .join('\n');
      return { content: [{ type: 'text', text: `# Chapters (${offset + 1}-${offset + data.items.length} of ${data.total})\n\n${formatted}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error getting audiobook chapters: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  },
};

const getChapter: tool<{ chapterId: z.ZodString }> = {
  name: 'getChapter',
  description: 'Get metadata for a single Spotify audiobook chapter',
  schema: { chapterId: z.string().describe('The Spotify ID of the chapter') },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    try {
      const config = await getValidConfig();
      const response = await fetch(`https://api.spotify.com/v1/chapters/${args.chapterId}`, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!response.ok) throw new Error(await response.text());
      const ch = await response.json();
      const duration = formatDuration(ch.duration_ms);
      return {
        content: [{
          type: 'text',
          text: `# "${ch.name}"\n\n**Audiobook**: ${ch.audiobook?.name}\n**Duration**: ${duration}\n**Chapter**: ${ch.chapter_number}\n**ID**: ${ch.id}\n**URI**: ${ch.uri}`,
        }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error getting chapter: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  },
};

export const readTools = [
  searchSpotify,
  getNowPlaying,
  getMyPlaylists,
  getPlaylistTracks,
  getRecentlyPlayed,
  getUsersSavedTracks,
  saveUsersTracks,
  removeUsersSavedTracks,
  followArtists,
  getFollowedArtists,
  getSavedAudiobooks,
  getSavedEpisodes,
  getSavedShows,
  getUserTopItems,
  getCurrentUserProfile,
  getArtist,
  getArtistAlbums,
  getTrack,
  getShow,
  getShowEpisodes,
  getEpisode,
  getAudiobook,
  getAudiobookChapters,
  getChapter,
  getQueue,
  getAvailableDevices,
];
