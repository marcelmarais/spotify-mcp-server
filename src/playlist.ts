import { z } from 'zod';
import { MAX_BULK_IDS, partialFailure, processInChunks } from './paging.js';
import { playlistIdFrom, playlistParam } from './resolve.js';
import { defineTool, toolError } from './tool.js';
import type { SpotifyHandlerExtra } from './types.js';
import { handleSpotifyRequest, spotifyFetch } from './utils.js';

const getPlaylist = defineTool({
  name: 'getPlaylist',
  description:
    'Get details of a specific Spotify playlist including tracks count, description and owner',
  schema: {
    playlistId: playlistParam,
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { playlistId: playlistRef } = args;

    try {
      const playlistId = await playlistIdFrom(playlistRef);
      const playlist = await handleSpotifyRequest(async (spotifyApi) => {
        return await spotifyApi.playlists.getPlaylist(playlistId);
      });

      const owner =
        playlist.owner?.display_name ?? playlist.owner?.id ?? 'Unknown';
      const tracksTotal =
        playlist.tracks?.total ??
        (playlist as { items?: { total?: number } }).items?.total ??
        0;
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
});

const updatePlaylist = defineTool({
  name: 'updatePlaylist',
  description:
    'Update the details of a Spotify playlist (name, description, public/private, collaborative)',
  schema: {
    playlistId: playlistParam,
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
      playlistId: playlistRef,
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

    try {
      const playlistId = await playlistIdFrom(playlistRef);
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
});

const removeTracksFromPlaylist = defineTool({
  name: 'removeTracksFromPlaylist',
  description:
    'Remove tracks from a Spotify playlist by ID or URI. Any number of IDs is fine, chunking is handled internally.',
  schema: {
    playlistId: playlistParam,
    trackIds: z
      .array(z.string())
      .min(1)
      .max(MAX_BULK_IDS)
      .describe(
        `Array of Spotify track IDs or URIs to remove (1-${MAX_BULK_IDS})`,
      ),
    snapshotId: z
      .string()
      .optional()
      .describe(
        'The playlist snapshot ID to target a specific version (optional, applied to the first request only)',
      ),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { playlistId: playlistRef, trackIds, snapshotId } = args;
    const uris = trackIds.map((id) =>
      id.startsWith('spotify:') ? id : `spotify:track:${id}`,
    );
    let playlistId: string;
    try {
      playlistId = await playlistIdFrom(playlistRef);
    } catch (error) {
      return toolError('removing tracks from playlist', error);
    }

    // Hit /items directly: SDK targets the deprecated /tracks endpoint
    // (see spotifyFetch JSDoc for context on the March 2026 migration).
    const { processed, error } = await processInChunks(
      uris,
      100,
      (part, start) =>
        spotifyFetch(`playlists/${playlistId}/items`, {
          method: 'DELETE',
          body: {
            items: part.map((uri) => ({ uri })),
            ...(snapshotId && start === 0 ? { snapshot_id: snapshotId } : {}),
          },
        }),
    );
    if (error) {
      return partialFailure(
        'removing tracks from playlist',
        processed,
        uris.length,
        error,
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: `Successfully removed ${processed} track${
            processed === 1 ? '' : 's'
          } from playlist (ID: ${playlistId})`,
        },
      ],
    };
  },
});

const reorderPlaylistItems = defineTool({
  name: 'reorderPlaylistItems',
  description:
    'Reorder a range of tracks within a Spotify playlist by moving them to a new position',
  schema: {
    playlistId: playlistParam,
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
    const {
      playlistId: playlistRef,
      rangeStart,
      insertBefore,
      rangeLength,
      snapshotId,
    } = args;

    try {
      const playlistId = await playlistIdFrom(playlistRef);
      // Hit /items directly: see spotifyFetch JSDoc for context.
      await spotifyFetch(`playlists/${playlistId}/items`, {
        method: 'PUT',
        body: {
          range_start: rangeStart,
          insert_before: insertBefore,
          ...(rangeLength !== undefined ? { range_length: rangeLength } : {}),
          ...(snapshotId ? { snapshot_id: snapshotId } : {}),
        },
      });

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
});

const unfollowPlaylist = defineTool({
  name: 'unfollowPlaylist',
  description:
    "Remove a playlist from the current user's library (unfollow). " +
    'Note: Spotify does not allow permanent deletion of playlists via the API.',
  schema: {
    playlistId: z
      .string()
      .describe(
        'The playlist to unfollow, by Spotify ID or by name (case-insensitive)',
      ),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { playlistId: playlistRef } = args;

    try {
      const playlistId = await playlistIdFrom(playlistRef);
      await spotifyFetch(`playlists/${playlistId}/followers`, {
        method: 'DELETE',
      });

      return {
        content: [
          {
            type: 'text',
            text: `Successfully unfollowed playlist (ID: ${playlistId})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error unfollowing playlist: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  },
});

export const playlistTools = [
  getPlaylist,
  updatePlaylist,
  removeTracksFromPlaylist,
  reorderPlaylistItems,
  unfollowPlaylist,
];
