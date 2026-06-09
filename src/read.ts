import type { MaxInt } from '@spotify/web-api-ts-sdk';
import { z } from 'zod';
import type {
  SpotifyEpisode,
  SpotifyEpisodesResponse,
  SpotifyHandlerExtra,
  SpotifySearchEpisodesResponse,
  SpotifySearchShowsResponse,
  SpotifyShow,
  SpotifySimplifiedEpisode,
  SpotifyTrack,
  tool,
} from './types.js';
import {
  createSpotifyApi,
  formatDuration,
  handleSpotifyRequest,
  loadSpotifyConfig,
  spotifyFetch,
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

const SEARCH_TYPES = [
  'track',
  'album',
  'artist',
  'playlist',
  'episode',
  'show',
] as const;
type SearchType = (typeof SEARCH_TYPES)[number];

function formatEpisode(ep: SpotifyEpisode, i: number): string {
  const duration = formatDuration(ep.duration_ms);
  const date = ep.release_date ? `, ${ep.release_date}` : '';
  const showName = ep.show?.name ?? 'Unknown show';
  return `${i + 1}. "${ep.name}" — ${showName} (${duration}${date}) - ID: ${ep.id}`;
}

function formatShow(show: SpotifyShow, i: number): string {
  return `${i + 1}. "${show.name}" by ${show.publisher} (${show.total_episodes} episodes) - ID: ${show.id}`;
}

const searchSpotify: tool<{
  query: z.ZodString;
  type: z.ZodEnum<[SearchType, ...SearchType[]]>;
  limit: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'searchSpotify',
  description:
    'Search for tracks, albums, artists, playlists, podcast episodes, or shows on Spotify. ' +
    'For episodes and shows, the query matches against title, description, and publisher. ' +
    'Use type "episode" to find individual podcast episodes by topic or guest name, ' +
    'and type "show" to find podcast series.',
  schema: {
    query: z
      .string()
      .describe(
        'The search query. Matches title, description, and publisher for podcasts.',
      ),
    type: z
      .enum(SEARCH_TYPES)
      .describe(
        'The type of item to search for: track, album, artist, playlist, episode (podcast episode), or show (podcast series)',
      ),
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum number of results to return (default: 10, max: 50)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { query, type, limit } = args;
    const limitValue = limit ?? 10;

    try {
      let formattedResults = '';

      if (type === 'episode') {
        // Search returns SimplifiedEpisodeObject (no `show` field).
        // Batch-fetch full episode objects to include show info.
        const searchResults = await spotifyFetch<SpotifySearchEpisodesResponse>(
          'search',
          {
            query: { q: query, type, limit: limitValue, market: 'from_token' },
          },
        );
        const ids = searchResults.episodes.items
          .filter((ep): ep is SpotifySimplifiedEpisode => ep !== null)
          .map((ep) => ep.id)
          .join(',');
        if (!ids) {
          formattedResults = '';
        } else {
          const full = await spotifyFetch<SpotifyEpisodesResponse>('episodes', {
            query: { ids, market: 'from_token' },
          });
          formattedResults = full.episodes
            .filter((ep): ep is SpotifyEpisode => ep !== null)
            .map(formatEpisode)
            .join('\n');
        }
      } else if (type === 'show') {
        const results = await spotifyFetch<SpotifySearchShowsResponse>(
          'search',
          {
            query: { q: query, type, limit: limitValue, market: 'from_token' },
          },
        );
        formattedResults = results.shows.items
          .filter((show): show is SpotifyShow => show !== null)
          .map(formatShow)
          .join('\n');
      } else {
        const results = await handleSpotifyRequest(async (spotifyApi) => {
          return await spotifyApi.search(
            query,
            [type],
            undefined,
            limitValue as MaxInt<50>,
          );
        });

        if (type === 'track' && results.tracks) {
          formattedResults = results.tracks.items
            .map((track, i) => {
              const artists = track.artists.map((a) => a.name).join(', ');
              const duration = formatDuration(track.duration_ms);
              const popularity =
                typeof track.popularity === 'number'
                  ? `, popularity: ${track.popularity}`
                  : '';
              return `${i + 1}. "${track.name}" by ${artists} (${duration}${popularity}) - ID: ${track.id}`;
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
            .map((artist, i) => `${i + 1}. ${artist.name} - ID: ${artist.id}`)
            .join('\n');
        } else if (type === 'playlist' && results.playlists) {
          formattedResults = results.playlists.items
            .map((playlist, i) => {
              return `${i + 1}. "${playlist?.name ?? 'Unknown Playlist'} (${
                playlist?.description ?? 'No description'
              } tracks)" by ${playlist?.owner?.display_name} - ID: ${playlist?.id}`;
            })
            .join('\n');
        }
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
            text: `Error searching for ${type}s: ${error instanceof Error ? error.message : String(error)}`,
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
        const tracksTotal = playlist.tracks?.total ? playlist.tracks.total : 0;
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

    // Hit /items directly: see spotifyFetch JSDoc for context.
    // Response wraps each entry's track under `item` (new) or `track` (legacy).
    // additional_types=episode is required for Spotify to return episode objects.
    type PlaylistItemEntry = {
      item?: SpotifyTrack | SpotifyEpisode | null;
      track?: SpotifyTrack | SpotifyEpisode | null;
    };
    const playlistTracks = await spotifyFetch<{
      items: PlaylistItemEntry[];
      total: number;
    }>(`playlists/${playlistId}/items`, {
      query: { limit, offset, additional_types: 'track,episode' },
    });

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
      .map((entry, i) => {
        const track = entry.item ?? entry.track;
        if (!track) return `${offset + i + 1}. [Removed track]`;

        if (isTrack(track)) {
          const artists = track.artists.map((a) => a.name).join(', ');
          const duration = formatDuration(track.duration_ms);
          return `${offset + i + 1}. "${track.name}" by ${artists} (${duration}) - ID: ${track.id}`;
        }

        if (track.type === 'episode') {
          return formatEpisode(track as SpotifyEpisode, offset + i);
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
      // Ensure token is fresh (handles auto-refresh if needed)
      await createSpotifyApi();
      const config = loadSpotifyConfig();

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

const TIME_RANGES = ['short_term', 'medium_term', 'long_term'] as const;
type TimeRange = (typeof TIME_RANGES)[number];

const TIME_RANGE_LABEL: Record<TimeRange, string> = {
  short_term: 'last ~4 weeks',
  medium_term: 'last ~6 months',
  long_term: 'last ~1 year',
};

const getTopTracks: tool<{
  timeRange: z.ZodOptional<z.ZodEnum<[TimeRange, ...TimeRange[]]>>;
  limit: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'getTopTracks',
  description:
    "Get the current user's top (most-played) tracks over a given time range. " +
    'This is the closest thing Spotify exposes to listening statistics.',
  schema: {
    timeRange: z
      .enum(TIME_RANGES)
      .optional()
      .describe(
        'Time range: short_term (~4 weeks), medium_term (~6 months), or long_term (~1 year). Default: medium_term.',
      ),
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum number of tracks to return (1-50)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { timeRange = 'medium_term', limit = 20 } = args;

    const top = await handleSpotifyRequest(async (spotifyApi) => {
      return await spotifyApi.currentUser.topItems(
        'tracks',
        timeRange,
        limit as MaxInt<50>,
      );
    });

    if (top.items.length === 0) {
      return {
        content: [
          { type: 'text', text: 'No top tracks found for this time range.' },
        ],
      };
    }

    const formatted = top.items
      .map((track, i) => {
        const artists = track.artists.map((a) => a.name).join(', ');
        const duration = formatDuration(track.duration_ms);
        return `${i + 1}. "${track.name}" by ${artists} (${duration}) - Popularity: ${track.popularity} - ID: ${track.id}`;
      })
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `# Top Tracks (${TIME_RANGE_LABEL[timeRange]})\n\n${formatted}`,
        },
      ],
    };
  },
};

const getTopArtists: tool<{
  timeRange: z.ZodOptional<z.ZodEnum<[TimeRange, ...TimeRange[]]>>;
  limit: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'getTopArtists',
  description:
    "Get the current user's top (most-played) artists over a given time range. " +
    'This is the closest thing Spotify exposes to listening statistics.',
  schema: {
    timeRange: z
      .enum(TIME_RANGES)
      .optional()
      .describe(
        'Time range: short_term (~4 weeks), medium_term (~6 months), or long_term (~1 year). Default: medium_term.',
      ),
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum number of artists to return (1-50)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { timeRange = 'medium_term', limit = 20 } = args;

    const top = await handleSpotifyRequest(async (spotifyApi) => {
      return await spotifyApi.currentUser.topItems(
        'artists',
        timeRange,
        limit as MaxInt<50>,
      );
    });

    if (top.items.length === 0) {
      return {
        content: [
          { type: 'text', text: 'No top artists found for this time range.' },
        ],
      };
    }

    const formatted = top.items
      .map((artist, i) => {
        const genres =
          artist.genres.length > 0
            ? ` - Genres: ${artist.genres.slice(0, 3).join(', ')}`
            : '';
        return `${i + 1}. ${artist.name} - Popularity: ${artist.popularity}${genres} - ID: ${artist.id}`;
      })
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `# Top Artists (${TIME_RANGE_LABEL[timeRange]})\n\n${formatted}`,
        },
      ],
    };
  },
};

export const readTools = [
  searchSpotify,
  getNowPlaying,
  getMyPlaylists,
  getPlaylistTracks,
  getRecentlyPlayed,
  getUsersSavedTracks,
  removeUsersSavedTracks,
  getQueue,
  getAvailableDevices,
  getTopTracks,
  getTopArtists,
];
