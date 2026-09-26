import { z } from 'zod';
import {
  chunk,
  MAX_BULK_IDS,
  partialFailure,
  processInChunks,
} from './paging.js';
import { defineTool, toolError } from './tool.js';
import type { SpotifyHandlerExtra } from './types.js';
import { spotifyFetch } from './utils.js';

// Spotify accepts at most 40 URIs per library request.
const LIBRARY_CHUNK = 40;

const trackIdsSchema = z
  .array(z.string())
  .min(1)
  .max(MAX_BULK_IDS)
  .describe(
    `Array of Spotify track IDs (1-${MAX_BULK_IDS}); large lists are processed in chunks automatically`,
  );

const toUris = (trackIds: string[]) =>
  trackIds.map((id) => `spotify:track:${id}`).join(',');

const plural = (n: number) => `track${n === 1 ? '' : 's'}`;

const saveTracksToLibrary = defineTool({
  name: 'saveTracksToLibrary',
  description:
    'Save tracks to the user\'s "Liked Songs" library by track ID. Any number of IDs is fine, chunking is handled internally.',
  schema: { trackIds: trackIdsSchema },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { trackIds } = args;
    const { processed, error } = await processInChunks(
      trackIds,
      LIBRARY_CHUNK,
      (part) =>
        spotifyFetch('me/library', {
          method: 'PUT',
          query: { uris: toUris(part) },
        }),
    );
    if (error) {
      return partialFailure('saving tracks', processed, trackIds.length, error);
    }
    return {
      content: [
        {
          type: 'text',
          text: `Successfully saved ${processed} ${plural(processed)} to your Liked Songs`,
        },
      ],
    };
  },
});

const removeUsersSavedTracks = defineTool({
  name: 'removeUsersSavedTracks',
  description:
    'Remove tracks from the user\'s "Liked Songs" library by track ID. Any number of IDs is fine, chunking is handled internally.',
  schema: { trackIds: trackIdsSchema },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { trackIds } = args;
    const { processed, error } = await processInChunks(
      trackIds,
      LIBRARY_CHUNK,
      (part) =>
        spotifyFetch('me/library', {
          method: 'DELETE',
          query: { uris: toUris(part) },
        }),
    );
    if (error) {
      return partialFailure(
        'removing tracks',
        processed,
        trackIds.length,
        error,
      );
    }
    return {
      content: [
        {
          type: 'text',
          text: `Successfully removed ${processed} ${plural(processed)} from your Liked Songs`,
        },
      ],
    };
  },
});

const checkUsersSavedTracks = defineTool({
  name: 'checkUsersSavedTracks',
  description:
    'Check whether tracks are saved in the user\'s "Liked Songs" library. Any number of IDs is fine, chunking is handled internally.',
  schema: { trackIds: trackIdsSchema },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { trackIds } = args;
    try {
      const saved: boolean[] = [];
      for (const part of chunk(trackIds, LIBRARY_CHUNK)) {
        const result = await spotifyFetch<boolean[]>('me/library/contains', {
          query: { uris: toUris(part) },
        });
        saved.push(...result);
      }
      const lines = trackIds.map(
        (id, i) => `${i + 1}. ${id}: ${saved[i] ? 'Saved' : 'Not saved'}`,
      );
      return {
        content: [
          { type: 'text', text: `# Liked Songs Status\n\n${lines.join('\n')}` },
        ],
      };
    } catch (error) {
      return toolError('checking saved tracks', error);
    }
  },
});

export const libraryTools = [
  saveTracksToLibrary,
  removeUsersSavedTracks,
  checkUsersSavedTracks,
];
