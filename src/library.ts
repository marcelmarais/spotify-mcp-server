import { z } from 'zod';
import { defineTool, toolError } from './tool.js';
import type { SpotifyHandlerExtra } from './types.js';
import { spotifyFetch } from './utils.js';

const trackIdsSchema = z
  .array(z.string())
  .min(1)
  .max(40)
  .describe('Array of Spotify track IDs (1-40)');

const toUris = (trackIds: string[]) =>
  trackIds.map((id) => `spotify:track:${id}`).join(',');

const saveTracksToLibrary = defineTool({
  name: 'saveTracksToLibrary',
  description:
    'Save one or more tracks to the user\'s "Liked Songs" library by track ID (max 40 per request)',
  schema: { trackIds: trackIdsSchema },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { trackIds } = args;
    try {
      await spotifyFetch('me/library', {
        method: 'PUT',
        query: { uris: toUris(trackIds) },
      });
      return {
        content: [
          {
            type: 'text',
            text: `Successfully saved ${trackIds.length} track${trackIds.length === 1 ? '' : 's'} to your Liked Songs`,
          },
        ],
      };
    } catch (error) {
      return toolError('saving tracks', error);
    }
  },
});

const checkUsersSavedTracks = defineTool({
  name: 'checkUsersSavedTracks',
  description:
    'Check whether tracks are saved in the user\'s "Liked Songs" library (max 40 per request)',
  schema: { trackIds: trackIdsSchema },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { trackIds } = args;
    try {
      const saved = await spotifyFetch<boolean[]>('me/library/contains', {
        query: { uris: toUris(trackIds) },
      });
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

export const libraryTools = [saveTracksToLibrary, checkUsersSavedTracks];
