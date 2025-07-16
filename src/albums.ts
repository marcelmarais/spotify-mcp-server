import type { MaxInt } from '@spotify/web-api-ts-sdk';
import { z } from 'zod';
import type { SpotifyHandlerExtra, tool } from './types.js';
import { formatDuration, handleSpotifyRequest } from './utils.js';

const getAlbum: tool<{
  albumId: z.ZodString;
}> = {
  name: 'getAlbum',
  description: 'Get detailed information about a specific album by its Spotify ID',
  schema: {
    albumId: z.string().describe('The Spotify ID of the album'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { albumId } = args;

    try {
      const album = await handleSpotifyRequest(async (spotifyApi) => {
        return await spotifyApi.albums.get(albumId);
      });

      const artists = album.artists.map((a) => a.name).join(', ');
      const releaseDate = album.release_date;
      const totalTracks = album.total_tracks;
      const albumType = album.album_type;

      return {
        content: [
          {
            type: 'text',
            text: `# Album Details\n\n` +
              `**Name**: "${album.name}"\n` +
              `**Artists**: ${artists}\n` +
              `**Release Date**: ${releaseDate}\n` +
              `**Type**: ${albumType}\n` +
              `**Total Tracks**: ${totalTracks}\n` +
              `**ID**: ${album.id}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting album: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const getMultipleAlbums: tool<{
  albumIds: z.ZodArray<z.ZodString>;
}> = {
  name: 'getMultipleAlbums',
  description: 'Get detailed information about multiple albums by their Spotify IDs (max 20)',
  schema: {
    albumIds: z.array(z.string()).max(20).describe('Array of Spotify album IDs (max 20)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { albumIds } = args;

    if (albumIds.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No album IDs provided',
          },
        ],
      };
    }

    try {
      const albums = await handleSpotifyRequest(async (spotifyApi) => {
        return await spotifyApi.albums.get(albumIds);
      });

      if (albums.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No albums found for the provided IDs',
            },
          ],
        };
      }

      const formattedAlbums = albums
        .map((album, i) => {
          if (!album) return `${i + 1}. [Album not found]`;
          
          const artists = album.artists.map((a) => a.name).join(', ');
          return `${i + 1}. "${album.name}" by ${artists} (${album.release_date}) - ${album.total_tracks} tracks - ID: ${album.id}`;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `# Multiple Albums\n\n${formattedAlbums}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting albums: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const getAlbumTracks: tool<{
  albumId: z.ZodString;
  limit: z.ZodOptional<z.ZodNumber>;
  offset: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'getAlbumTracks',
  description: 'Get tracks from a specific album with pagination support',
  schema: {
    albumId: z.string().describe('The Spotify ID of the album'),
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
    const { albumId, limit = 20, offset = 0 } = args;

    try {
      const tracks = await handleSpotifyRequest(async (spotifyApi) => {
        return await spotifyApi.albums.tracks(
          albumId,
          undefined,
          limit as MaxInt<50>,
          offset,
        );
      });

      if (tracks.items.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No tracks found in this album',
            },
          ],
        };
      }

      const formattedTracks = tracks.items
        .map((track, i) => {
          if (!track) return `${i + 1}. [Track not found]`;
          
          const artists = track.artists.map((a) => a.name).join(', ');
          const duration = formatDuration(track.duration_ms);
          return `${offset + i + 1}. "${track.name}" by ${artists} (${duration}) - ID: ${track.id}`;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `# Album Tracks (${offset + 1}-${offset + tracks.items.length} of ${tracks.total})\n\n${formattedTracks}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting album tracks: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const getNewReleases: tool<{
  limit: z.ZodOptional<z.ZodNumber>;
  offset: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'getNewReleases',
  description: 'Get a list of new album releases featured in Spotify',
  schema: {
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum number of albums to return (1-50)'),
    offset: z
      .number()
      .min(0)
      .optional()
      .describe('Offset for pagination (0-based index)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { limit = 20, offset = 0 } = args;

    try {
      const newReleases = await handleSpotifyRequest(async (spotifyApi) => {
        return await spotifyApi.browse.getNewReleases(
          limit as MaxInt<50>,
          offset,
        );
      });

      if (newReleases.albums.items.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No new releases found',
            },
          ],
        };
      }

      const formattedAlbums = newReleases.albums.items
        .map((album, i) => {
          if (!album) return `${i + 1}. [Album not found]`;
          
          const artists = album.artists.map((a) => a.name).join(', ');
          return `${offset + i + 1}. "${album.name}" by ${artists} (${album.release_date}) - ID: ${album.id}`;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `# New Releases (${offset + 1}-${offset + newReleases.albums.items.length} of ${newReleases.albums.total})\n\n${formattedAlbums}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting new releases: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const getUsersSavedAlbums: tool<{
  limit: z.ZodOptional<z.ZodNumber>;
  offset: z.ZodOptional<z.ZodNumber>;
}> = {
  name: 'getUsersSavedAlbums',
  description: 'Get albums saved in the user\'s "Your Music" library',
  schema: {
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum number of albums to return (1-50)'),
    offset: z
      .number()
      .min(0)
      .optional()
      .describe('Offset for pagination (0-based index)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { limit = 20, offset = 0 } = args;

    try {
      const savedAlbums = await handleSpotifyRequest(async (spotifyApi) => {
        return await spotifyApi.currentUser.albums.savedAlbums(
          limit as MaxInt<50>,
          offset,
        );
      });

      if (savedAlbums.items.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: "You don't have any saved albums in your library",
            },
          ],
        };
      }

      const formattedAlbums = savedAlbums.items
        .map((item, i) => {
          const album = item.album;
          if (!album) return `${i + 1}. [Album not found]`;
          
          const artists = album.artists.map((a) => a.name).join(', ');
          const addedDate = new Date(item.added_at).toLocaleDateString();
          return `${offset + i + 1}. "${album.name}" by ${artists} (${album.release_date}) - ID: ${album.id} - Added: ${addedDate}`;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `# Your Saved Albums (${offset + 1}-${offset + savedAlbums.items.length} of ${savedAlbums.total})\n\n${formattedAlbums}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting saved albums: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const saveAlbumsForUser: tool<{
  albumIds: z.ZodArray<z.ZodString>;
}> = {
  name: 'saveAlbumsForUser',
  description: 'Save albums to the user\'s "Your Music" library',
  schema: {
    albumIds: z.array(z.string()).max(20).describe('Array of Spotify album IDs to save (max 20)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { albumIds } = args;

    if (albumIds.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No album IDs provided',
          },
        ],
      };
    }

    try {
      await handleSpotifyRequest(async (spotifyApi) => {
        return await spotifyApi.currentUser.albums.saveAlbums(albumIds);
      });

      return {
        content: [
          {
            type: 'text',
            text: `Successfully saved ${albumIds.length} album${albumIds.length === 1 ? '' : 's'} to your library`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error saving albums: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const removeAlbumsForUser: tool<{
  albumIds: z.ZodArray<z.ZodString>;
}> = {
  name: 'removeAlbumsForUser',
  description: 'Remove albums from the user\'s "Your Music" library',
  schema: {
    albumIds: z.array(z.string()).max(20).describe('Array of Spotify album IDs to remove (max 20)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { albumIds } = args;

    if (albumIds.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No album IDs provided',
          },
        ],
      };
    }

    try {
      await handleSpotifyRequest(async (spotifyApi) => {
        return await spotifyApi.currentUser.albums.removeAlbums(albumIds);
      });

      return {
        content: [
          {
            type: 'text',
            text: `Successfully removed ${albumIds.length} album${albumIds.length === 1 ? '' : 's'} from your library`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error removing albums: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const checkUsersSavedAlbums: tool<{
  albumIds: z.ZodArray<z.ZodString>;
}> = {
  name: 'checkUsersSavedAlbums',
  description: 'Check if albums are saved in the user\'s "Your Music" library',
  schema: {
    albumIds: z.array(z.string()).max(20).describe('Array of Spotify album IDs to check (max 20)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { albumIds } = args;

    if (albumIds.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No album IDs provided',
          },
        ],
      };
    }

    try {
      const savedStatus = await handleSpotifyRequest(async (spotifyApi) => {
        return await spotifyApi.currentUser.albums.hasSavedAlbums(albumIds);
      });

      const formattedResults = albumIds
        .map((albumId, i) => {
          const isSaved = savedStatus[i];
          return `${i + 1}. ${albumId}: ${isSaved ? 'Saved' : 'Not saved'}`;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `# Album Save Status\n\n${formattedResults}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error checking saved albums: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

export const albumTools = [
  getAlbum,
  getMultipleAlbums,
  getAlbumTracks,
  getNewReleases,
  getUsersSavedAlbums,
  saveAlbumsForUser,
  removeAlbumsForUser,
  checkUsersSavedAlbums,
];