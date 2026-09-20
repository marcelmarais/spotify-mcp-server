import { z } from 'zod';
import { collectPages, partialFailure, processInChunks } from './paging.js';
import { looksLikeSpotifyId, resolvePlaylist } from './resolve.js';
import { defineTool, toolError } from './tool.js';
import type { SpotifyHandlerExtra, SpotifyTrack } from './types.js';
import { spotifyFetch } from './utils.js';

const ALL = Number.MAX_SAFE_INTEGER;

interface LikedSong {
  id: string;
  line: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function parseDate(
  value: string | undefined,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  const time = Date.parse(value);
  if (Number.isNaN(time))
    throw new Error(`${field} is not a valid date: ${value}`);
  return time;
}

const moveLikedSongsToPlaylist = defineTool({
  name: 'moveLikedSongsToPlaylist',
  description:
    'Move (or copy) Liked Songs into a playlist in one step: selects songs from the Liked Songs by filter, ' +
    'creates the target playlist if it does not exist, adds only songs that are not already in it, ' +
    'and then removes them from the Liked Songs. Handles pagination and chunking internally. ' +
    'Runs as a dry run by default; set dryRun=false to apply. Use it to archive, clean up or split the Liked Songs.',
  schema: {
    toPlaylist: z
      .string()
      .describe(
        'Target playlist by name (created as private playlist if missing) or by Spotify ID',
      ),
    all: z
      .boolean()
      .optional()
      .describe(
        'Select ALL Liked Songs. Required if no other selector is given.',
      ),
    query: z
      .string()
      .optional()
      .describe('Select songs whose title, artist or album contains this text'),
    trackIds: z
      .array(z.string())
      .optional()
      .describe('Select only these track IDs (must be in the Liked Songs)'),
    addedBefore: z
      .string()
      .optional()
      .describe('Select songs liked before this date (ISO, e.g. 2023-01-01)'),
    addedAfter: z
      .string()
      .optional()
      .describe('Select songs liked after this date (ISO, e.g. 2023-01-01)'),
    removeFromLiked: z
      .boolean()
      .optional()
      .describe(
        'Remove the songs from the Liked Songs after adding (default true = move, false = copy)',
      ),
    dryRun: z
      .boolean()
      .optional()
      .describe('Only report what would happen (default true)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const {
      toPlaylist,
      all,
      query,
      trackIds,
      addedBefore,
      addedAfter,
      removeFromLiked = true,
      dryRun = true,
    } = args;

    const hasSelector =
      all === true ||
      query !== undefined ||
      trackIds !== undefined ||
      addedBefore !== undefined ||
      addedAfter !== undefined;
    if (!hasSelector) {
      return toolError(
        'moving liked songs',
        new Error(
          'Select what to move: pass all=true, or query, trackIds, addedBefore or addedAfter.',
        ),
      );
    }

    try {
      const before = parseDate(addedBefore, 'addedBefore');
      const after = parseDate(addedAfter, 'addedAfter');
      const wantedIds = trackIds ? new Set(trackIds) : undefined;
      const needle = query?.toLowerCase();

      const { results: selected } = await collectPages<
        { added_at: string; track: SpotifyTrack | null },
        LikedSong
      >({
        fetchPage: (offset, limit) =>
          spotifyFetch('me/tracks', { query: { limit, offset } }),
        select: (item) => {
          const track = item.track;
          if (!track) return null;
          const artists = track.artists.map((a) => a.name).join(', ');
          if (wantedIds && !wantedIds.has(track.id)) return null;
          if (
            needle &&
            !`${track.name} ${artists} ${track.album?.name ?? ''}`
              .toLowerCase()
              .includes(needle)
          ) {
            return null;
          }
          const added = Date.parse(item.added_at);
          if (before !== undefined && !(added < before)) return null;
          if (after !== undefined && !(added > after)) return null;
          return {
            id: track.id,
            line: `${track.name} — ${artists} [${track.id}]`,
          };
        },
        startOffset: 0,
        maxItems: ALL,
      });

      if (selected.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No liked songs match the selection. Nothing to do.',
            },
          ],
        };
      }

      const verb = removeFromLiked ? 'Moved' : 'Copied';
      let playlist = await resolvePlaylist(toPlaylist, { exactOnly: true });
      const existing = new Set<string>();
      if (playlist) {
        const { results } = await collectPages<
          { item?: SpotifyTrack | null; track?: SpotifyTrack | null },
          string
        >({
          fetchPage: (offset, limit) =>
            spotifyFetch(`playlists/${playlist?.id}/items`, {
              query: { limit, offset, additional_types: 'track,episode' },
            }),
          select: (row) => (row.item ?? row.track)?.id ?? null,
          startOffset: 0,
          maxItems: ALL,
        });
        for (const id of results) existing.add(id);
      }
      const toAdd = selected.filter((s) => !existing.has(s.id));
      const alreadyThere = selected.length - toAdd.length;
      const label =
        playlist && !looksLikeSpotifyId(toPlaylist)
          ? playlist.name
          : toPlaylist;

      if (dryRun) {
        const sample = selected
          .slice(0, 10)
          .map((s) => `- ${s.line}`)
          .join('\n');
        const more =
          selected.length > 10 ? `\n… and ${selected.length - 10} more` : '';
        const target = playlist
          ? `playlist "${label}" exists`
          : `playlist "${toPlaylist}" would be created`;
        return {
          content: [
            {
              type: 'text',
              text:
                `Dry run: would ${removeFromLiked ? 'move' : 'copy'} ${plural(selected.length, 'liked song')} ` +
                `to "${toPlaylist}" (${alreadyThere} already there, ${toAdd.length} to add)` +
                `${removeFromLiked ? ` and remove ${selected.length} from Liked Songs` : ''}; ${target}. ` +
                `Nothing was changed; pass dryRun=false to apply.\n\n${sample}${more}`,
            },
          ],
        };
      }

      if (!playlist) {
        const created = await spotifyFetch<{ id: string }>('me/playlists', {
          method: 'POST',
          body: { name: toPlaylist, public: false },
        });
        playlist = { id: created.id, name: toPlaylist };
      }
      const playlistId = playlist.id;

      const { processed, error } = await processInChunks(
        toAdd.map((s) => `spotify:track:${s.id}`),
        100,
        (part) =>
          spotifyFetch(`playlists/${playlistId}/items`, {
            method: 'POST',
            body: { uris: part },
          }),
      );
      if (error) {
        return partialFailure(
          `adding songs to "${toPlaylist}" (nothing was removed from Liked Songs)`,
          processed,
          toAdd.length,
          error,
        );
      }

      let removed = 0;
      if (removeFromLiked) {
        const result = await processInChunks(
          selected.map((s) => `spotify:track:${s.id}`),
          40,
          (part) =>
            spotifyFetch('me/library', {
              method: 'DELETE',
              query: { uris: part.join(',') },
            }),
        );
        removed = result.processed;
        if (result.error) {
          return partialFailure(
            `removing songs from Liked Songs after adding them to "${toPlaylist}"`,
            removed,
            selected.length,
            result.error,
          );
        }
      }

      return {
        content: [
          {
            type: 'text',
            text:
              `${verb} ${plural(selected.length, 'liked song')} to "${toPlaylist}": ` +
              `${processed} added, ${alreadyThere} already there.` +
              `${removeFromLiked ? ` Removed ${removed} from Liked Songs.` : ''}`,
          },
        ],
      };
    } catch (error) {
      return toolError('moving liked songs', error);
    }
  },
});

export const workflowTools = [moveLikedSongsToPlaylist];
