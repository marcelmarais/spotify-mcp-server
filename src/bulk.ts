import { z } from 'zod';
import { collectPages } from './paging.js';
import { resolvePlaylist } from './resolve.js';
import { defineTool, toolError } from './tool.js';
import type {
  SpotifyEpisode,
  SpotifyHandlerExtra,
  SpotifyTrack,
} from './types.js';
import { spotifyFetch } from './utils.js';

const listSchema = {
  query: z
    .string()
    .optional()
    .describe(
      'Only include entries whose title, artist or album contains this text (case-insensitive)',
    ),
  maxItems: z
    .number()
    .int()
    .min(1)
    .max(10000)
    .optional()
    .describe(
      'Maximum number of entries to return (default 500). If more exist, the result names the offset to continue from.',
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Start scanning at this position (default 0)'),
  format: z
    .enum(['compact', 'ids'])
    .optional()
    .describe(
      '"compact" (default): one line per entry "Title — Artist [id]". "ids": only the comma-separated IDs, the cheapest output for feeding other tools.',
    ),
};

interface Entry {
  id: string;
  line: string;
  haystack: string;
}

function trackEntry(track: SpotifyTrack): Entry {
  const artists = track.artists.map((a) => a.name).join(', ');
  return {
    id: track.id,
    line: `${track.name} — ${artists} [${track.id}]`,
    haystack: `${track.name} ${artists} ${track.album?.name ?? ''}`,
  };
}

function episodeEntry(episode: SpotifyEpisode): Entry {
  const show = episode.show?.name ?? 'Unknown show';
  return {
    id: episode.id,
    line: `${episode.name} — ${show} [${episode.id}]`,
    haystack: `${episode.name} ${show}`,
  };
}

const matches = (entry: Entry, query?: string) =>
  !query || entry.haystack.toLowerCase().includes(query.toLowerCase());

function render(
  title: string,
  entries: Entry[],
  total: number,
  args: { query?: string; format?: 'compact' | 'ids' },
  nextOffset?: number,
) {
  const filter = args.query ? `, matching "${args.query}"` : '';
  const header = `# ${title} (${entries.length} of ${total}${filter})`;
  const body =
    args.format === 'ids'
      ? entries.map((e) => e.id).join(',')
      : entries.map((e) => e.line).join('\n');
  const footer =
    nextOffset !== undefined
      ? `\n\nMore available. Next offset: ${nextOffset}`
      : '';
  return {
    content: [
      {
        type: 'text' as const,
        text: `${header}\n\n${body || 'Nothing found.'}${footer}`,
      },
    ],
  };
}

const getAllSavedTracks = defineTool({
  name: 'getAllSavedTracks',
  description:
    'Get the user\'s Liked Songs across all pages in a single call, optionally filtered by text. Prefer this over paging getUsersSavedTracks by hand. Use format "ids" to feed the result into other tools.',
  schema: listSchema,
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { query, maxItems = 500, offset = 0 } = args;
    try {
      const { results, total, nextOffset } = await collectPages<
        { track: SpotifyTrack | null },
        Entry
      >({
        fetchPage: (o, limit) =>
          spotifyFetch('me/tracks', { query: { limit, offset: o } }),
        select: (item) => {
          if (!item.track) return null;
          const entry = trackEntry(item.track);
          return matches(entry, query) ? entry : null;
        },
        startOffset: offset,
        maxItems,
      });
      return render('Liked Songs', results, total, args, nextOffset);
    } catch (error) {
      return toolError('reading Liked Songs', error);
    }
  },
});

const getAllPlaylistTracks = defineTool({
  name: 'getAllPlaylistTracks',
  description:
    'Get all tracks and episodes of a playlist across all pages in a single call, optionally filtered by text. Prefer this over paging getPlaylistTracks by hand.',
  schema: {
    playlistId: z
      .string()
      .describe('The playlist, by Spotify ID or by name (case-insensitive)'),
    ...listSchema,
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { playlistId, query, maxItems = 500, offset = 0 } = args;
    type Row = {
      item?: SpotifyTrack | SpotifyEpisode | null;
      track?: SpotifyTrack | SpotifyEpisode | null;
    };
    try {
      const playlist = await resolvePlaylist(playlistId);
      if (!playlist) {
        throw new Error(`No playlist matching "${playlistId}" found`);
      }
      const { results, total, nextOffset } = await collectPages<Row, Entry>({
        fetchPage: (o, limit) =>
          spotifyFetch(`playlists/${playlist.id}/items`, {
            query: { limit, offset: o, additional_types: 'track,episode' },
          }),
        select: (row) => {
          const item = row.item ?? row.track;
          if (!item) {
            return query
              ? null
              : { id: '', line: '[Removed track]', haystack: '' };
          }
          const entry =
            item.type === 'episode'
              ? episodeEntry(item as SpotifyEpisode)
              : trackEntry(item as SpotifyTrack);
          return matches(entry, query) ? entry : null;
        },
        startOffset: offset,
        maxItems,
      });
      const entries =
        args.format === 'ids' ? results.filter((e) => e.id) : results;
      return render('Playlist tracks', entries, total, args, nextOffset);
    } catch (error) {
      return toolError('reading playlist tracks', error);
    }
  },
});

const getAllMyPlaylists = defineTool({
  name: 'getAllMyPlaylists',
  description:
    "Get all of the user's playlists across all pages in a single call, optionally filtered by name.",
  schema: listSchema,
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { query, maxItems = 500, offset = 0 } = args;
    type Row = {
      id: string;
      name: string;
      items?: { total: number };
      tracks?: { total: number };
    };
    try {
      const { results, total, nextOffset } = await collectPages<Row, Entry>({
        fetchPage: (o, limit) =>
          spotifyFetch('me/playlists', { query: { limit, offset: o } }),
        select: (playlist) => {
          if (!playlist) return null;
          const count = playlist.items?.total ?? playlist.tracks?.total ?? 0;
          const entry = {
            id: playlist.id,
            line: `${playlist.name} (${count} tracks) [${playlist.id}]`,
            haystack: playlist.name,
          };
          return matches(entry, query) ? entry : null;
        },
        startOffset: offset,
        maxItems,
      });
      return render('Playlists', results, total, args, nextOffset);
    } catch (error) {
      return toolError('reading playlists', error);
    }
  },
});

export const bulkTools = [
  getAllSavedTracks,
  getAllPlaylistTracks,
  getAllMyPlaylists,
];
