import { z } from 'zod';
import type { SpotifyHandlerExtra, tool } from './types.js';
import { handleSpotifyRequest, loadSpotifyConfig } from './utils.js';

const getPlaylist: tool<{
  playlistId: z.ZodString;
}> = {
  name: 'getPlaylist',
  description:
    'Get details of a specific Spotify playlist including tracks count, description and owner',
  schema: {
    playlistId: z.string().describe('The Spotify ID of the playlist'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { playlistId } = args;

    try {
      const playlist = await handleSpotifyRequest(async (spotifyApi) => {
        return await spotifyApi.playlists.getPlaylist(playlistId);
      });

      const owner =
        playlist.owner?.display_name ?? playlist.owner?.id ?? 'Unknown';
      const tracksTotal = playlist.tracks?.total ?? 0;
      const isPublic = playlist.public ? 'Public' : 'Private';
      const isCollaborative = playlist.collaborative ? ' | Collaborative' : '';
      const description = playlist.description
        ? `\n**Description**: ${playlist.description}`
        : '';
      const url = playlist.external_urls?.spotify ?? '';

      return {
        content: [
          {
            type: 'text',
            text:
              `# Playlist: "${playlist.name}"\n\n` +
              `**Owner**: ${owner}\n` +
              `**Tracks**: ${tracksTotal}\n` +
              `**Visibility**: ${isPublic}${isCollaborative}` +
              `${description}\n` +
              `**ID**: ${playlist.id}\n` +
              `**URL**: ${url}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting playlist: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const updatePlaylist: tool<{
  playlistId: z.ZodString;
  name: z.ZodOptional<z.ZodString>;
  description: z.ZodOptional<z.ZodString>;
  public: z.ZodOptional<z.ZodBoolean>;
  collaborative: z.ZodOptional<z.ZodBoolean>;
}> = {
  name: 'updatePlaylist',
  description:
    'Update the details of a Spotify playlist (name, description, public/private, collaborative). A playlist cannot be both public and collaborative at the same time.',
  schema: {
    playlistId: z.string().describe('The Spotify ID of the playlist'),
    name: z.string().optional().describe('New name for the playlist'),
    description: z
      .string()
      .optional()
      .describe('New description for the playlist'),
    public: z
      .boolean()
      .optional()
      .describe('Whether the playlist should be public'),
    collaborative: z
      .boolean()
      .optional()
      .describe(
        'Whether the playlist should be collaborative (requires public to be false)',
      ),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const {
      playlistId,
      name,
      description,
      public: isPublic,
      collaborative,
    } = args;

    if (
      !name &&
      description === undefined &&
      isPublic === undefined &&
      collaborative === undefined
    ) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: At least one field to update must be provided (name, description, public, collaborative)',
          },
        ],
      };
    }

    if (collaborative && isPublic) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: A playlist cannot be both collaborative and public at the same time.',
          },
        ],
      };
    }

    try {
      const body: Record<string, string | boolean> = {};
      if (name) body.name = name;
      if (description !== undefined) body.description = description;
      if (isPublic !== undefined) body.public = isPublic;
      if (collaborative !== undefined) body.collaborative = collaborative;

      await handleSpotifyRequest(async (spotifyApi) => {
        await spotifyApi.playlists.changePlaylistDetails(playlistId, body);
      });

      const changes = Object.keys(body).join(', ');
      return {
        content: [
          {
            type: 'text',
            text: `Successfully updated playlist (ID: ${playlistId})\nFields updated: ${changes}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error updating playlist: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const removeTracksFromPlaylist: tool<{
  playlistId: z.ZodString;
  trackIds: z.ZodArray<z.ZodString>;
  snapshotId: z.ZodOptional<z.ZodString>;
}> = {
  name: 'removeTracksFromPlaylist',
  description:
    'Remove one or more tracks from a Spotify playlist (max 100 tracks per request)',
  schema: {
    playlistId: z.string().describe('The Spotify ID of the playlist'),
    trackIds: z
      .array(z.string())
      .min(1)
      .max(100)
      .describe('Array of Spotify track IDs to remove (max 100)'),
    snapshotId: z
      .string()
      .optional()
      .describe(
        'The playlist snapshot ID to target a specific version (optional)',
      ),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { playlistId, trackIds, snapshotId } = args;

    try {
      const tracks = trackIds.map((id) => ({ uri: `spotify:track:${id}` }));
      const config = loadSpotifyConfig();

      const response = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/items`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tracks,
            ...(snapshotId ? { snapshot_id: snapshotId } : {}),
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to remove tracks: ${errorData}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: `Successfully removed ${trackIds.length} track${
              trackIds.length === 1 ? '' : 's'
            } from playlist (ID: ${playlistId})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error removing tracks from playlist: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

const reorderPlaylistItems: tool<{
  playlistId: z.ZodString;
  rangeStart: z.ZodNumber;
  insertBefore: z.ZodNumber;
  rangeLength: z.ZodOptional<z.ZodNumber>;
  snapshotId: z.ZodOptional<z.ZodString>;
}> = {
  name: 'reorderPlaylistItems',
  description:
    'Reorder a range of tracks within a Spotify playlist by moving them to a new position',
  schema: {
    playlistId: z.string().describe('The Spotify ID of the playlist'),
    rangeStart: z
      .number()
      .nonnegative()
      .describe('The position of the first item to move (0-based index)'),
    insertBefore: z
      .number()
      .nonnegative()
      .describe(
        'The position where the items should be inserted (0-based index)',
      ),
    rangeLength: z
      .number()
      .min(1)
      .optional()
      .describe('Number of consecutive items to move (defaults to 1)'),
    snapshotId: z
      .string()
      .optional()
      .describe(
        'The playlist snapshot ID to target a specific version (optional)',
      ),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { playlistId, rangeStart, insertBefore, rangeLength, snapshotId } =
      args;

    try {
      const config = loadSpotifyConfig();

      const response = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/items`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            range_start: rangeStart,
            insert_before: insertBefore,
            ...(rangeLength !== undefined ? { range_length: rangeLength } : {}),
            ...(snapshotId ? { snapshot_id: snapshotId } : {}),
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to reorder playlist items: ${errorData}`);
      }

      const count = rangeLength ?? 1;
      return {
        content: [
          {
            type: 'text',
            text: `Successfully moved ${count} track${
              count === 1 ? '' : 's'
            } from position ${rangeStart} to before position ${insertBefore} in playlist (ID: ${playlistId})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error reordering playlist items: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
};

export const playlistTools = [
  getPlaylist,
  updatePlaylist,
  removeTracksFromPlaylist,
  reorderPlaylistItems,
];
