import { z } from 'zod';
import {
  collectPages,
  mapConcurrent,
  partialFailure,
  processInChunks,
} from './paging.js';
import { resolvePlaylist } from './resolve.js';
import { defineTool, toolError } from './tool.js';
import type {
  SpotifyEpisode,
  SpotifyHandlerExtra,
  SpotifyTrack,
} from './types.js';
import { spotifyFetch } from './utils.js';

const ALL = Number.MAX_SAFE_INTEGER;
const LIKED = 'liked';

interface Song {
  id: string;
  name: string;
  artists: string[];
  album: string;
  addedAt?: string;
  durationMs: number;
}

const line = (s: Song) => `${s.name} — ${s.artists.join(', ')} [${s.id}]`;
const day = (iso?: string) => (iso ? iso.slice(0, 10) : 'n/a');

const sourceParam = (label: string) =>
  z
    .string()
    .describe(
      `${label}: the keyword "liked" for the Liked Songs, or a playlist by Spotify ID or name`,
    );

function toSong(
  item: SpotifyTrack | SpotifyEpisode | null | undefined,
  addedAt?: string,
): Song | null {
  if (!item?.id) return null;
  if (item.type === 'episode') {
    const ep = item as SpotifyEpisode;
    return {
      id: ep.id,
      name: ep.name,
      artists: [ep.show?.name ?? 'Unknown show'],
      album: '',
      addedAt,
      durationMs: ep.duration_ms,
    };
  }
  const track = item as SpotifyTrack;
  return {
    id: track.id,
    name: track.name,
    artists: track.artists.map((a) => a.name),
    album: track.album?.name ?? '',
    addedAt,
    durationMs: track.duration_ms,
  };
}

async function loadLiked(): Promise<Song[]> {
  const { results } = await collectPages<
    { added_at: string; track: SpotifyTrack | null },
    Song
  >({
    fetchPage: (offset, limit) =>
      spotifyFetch('me/tracks', { query: { limit, offset } }),
    select: (row) => toSong(row.track, row.added_at),
    startOffset: 0,
    maxItems: ALL,
  });
  return results;
}

async function loadPlaylist(id: string): Promise<Song[]> {
  type Row = {
    added_at?: string;
    item?: SpotifyTrack | SpotifyEpisode | null;
    track?: SpotifyTrack | SpotifyEpisode | null;
  };
  const { results } = await collectPages<Row, Song>({
    fetchPage: (offset, limit) =>
      spotifyFetch(`playlists/${id}/items`, {
        query: { limit, offset, additional_types: 'track,episode' },
      }),
    select: (row) => toSong(row.item ?? row.track, row.added_at),
    startOffset: 0,
    maxItems: ALL,
  });
  return results;
}

interface Source {
  label: string;
  isLiked: boolean;
  playlistId?: string;
  songs: Song[];
}

async function loadSource(source: string): Promise<Source> {
  if (source.trim().toLowerCase() === LIKED) {
    return { label: 'liked', isLiked: true, songs: await loadLiked() };
  }
  const playlist = await resolvePlaylist(source);
  if (!playlist) throw new Error(`No playlist matching "${source}" found`);
  return {
    label: playlist.name,
    isLiked: false,
    playlistId: playlist.id,
    songs: await loadPlaylist(playlist.id),
  };
}

const fold = (value: string) =>
  value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

const words = (value: string) =>
  fold(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * "title|primary artist" key. strict keeps version information in the title
 * (remix, remaster, ...), similar ignores (...) / [...] and " - Remaster" style suffixes.
 */
function songKey(song: Song, mode: 'strict' | 'similar' = 'strict'): string {
  const rawTitle =
    mode === 'similar'
      ? fold(song.name)
          .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
          .replace(/\s-\s.*$/, ' ')
      : song.name;
  const title = words(rawTitle) || song.name.toLowerCase().trim();
  const artistName = song.artists[0] ?? '';
  const artist = words(artistName) || artistName.toLowerCase();
  return `${title}|${artist}`;
}

/** Share of the query's words that appear in the song's title and artists. */
function coverage(query: string, song: Song): number {
  const wanted = words(query).split(' ').filter(Boolean);
  if (wanted.length === 0) return 0;
  const have = new Set(
    words(`${song.name} ${song.artists.join(' ')}`).split(' '),
  );
  return wanted.filter((w) => have.has(w)).length / wanted.length;
}

const MIN_COVERAGE = 0.7;

const uri = (id: string) => `spotify:track:${id}`;

// ---------------------------------------------------------------- duplicates

const findDuplicateTracks = defineTool({
  name: 'findDuplicateTracks',
  description:
    'Find duplicate songs in the Liked Songs or a playlist: same track more than once, or the same title and artist as different versions (remaster, radio edit, re-release). The oldest entry is kept, the rest are extras. With action="remove" the extras are removed (repeated copies of the very same track ID cannot be removed individually and are only reported).',
  schema: {
    source: sourceParam('Where to look'),
    match: z
      .enum(['strict', 'similar'])
      .optional()
      .describe(
        '"strict" (default): same title and artist. "similar": also treats remasters, radio edits and remixes with the same base title as duplicates (riskier together with action="remove")',
      ),
    action: z
      .enum(['report', 'remove'])
      .optional()
      .describe(
        '"report" (default) only lists duplicates, "remove" removes the extras',
      ),
    maxGroups: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe('Maximum number of duplicate groups to list (default 50)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const {
      source,
      match = 'strict',
      action = 'report',
      maxGroups = 50,
    } = args;
    try {
      const loaded = await loadSource(source);
      const groups = new Map<string, Song[]>();
      for (const song of loaded.songs) {
        const key = songKey(song, match);
        const group = groups.get(key);
        if (group) group.push(song);
        else groups.set(key, [song]);
      }
      const dupes = [...groups.values()].filter((g) => g.length > 1);

      const removable: string[] = [];
      const repeated: string[] = [];
      const rendered = dupes.map((group) => {
        const indexed = group.map((song, i) => ({ song, i }));
        indexed.sort((a, b) => {
          const ta = a.song.addedAt ? Date.parse(a.song.addedAt) : 0;
          const tb = b.song.addedAt ? Date.parse(b.song.addedAt) : 0;
          return ta - tb || a.i - b.i;
        });
        const keep = (indexed[0] as (typeof indexed)[number]).song;
        const lines = [`KEEP  ${line(keep)} (${day(keep.addedAt)})`];
        const noted = new Set<string>();
        for (const { song } of indexed.slice(1)) {
          lines.push(`EXTRA ${line(song)} (${day(song.addedAt)})`);
          if (song.id === keep.id) {
            if (!noted.has(song.id)) {
              repeated.push(`${keep.name} [${keep.id}]`);
              noted.add(song.id);
            }
          } else if (!removable.includes(song.id)) {
            removable.push(song.id);
          }
        }
        return lines.join('\n');
      });

      const shown = rendered.slice(0, maxGroups).join('\n\n');
      const more =
        rendered.length > maxGroups
          ? `\n\n… and ${rendered.length - maxGroups} more groups`
          : '';
      const repeatedNote = repeated.length
        ? `\n\nRepeated copies of the same track (cannot be removed individually): ${repeated.join(', ')}`
        : '';
      const summary = `# Duplicates in ${loaded.label}: ${dupes.length} duplicate group${dupes.length === 1 ? '' : 's'}, ${removable.length} removable extra${removable.length === 1 ? '' : 's'}`;

      let removedNote = '';
      if (action === 'remove' && removable.length > 0) {
        const uris = removable.map(uri);
        const { processed, error } = loaded.isLiked
          ? await processInChunks(uris, 40, (part) =>
              spotifyFetch('me/library', {
                method: 'DELETE',
                query: { uris: part.join(',') },
              }),
            )
          : await processInChunks(uris, 100, (part) =>
              spotifyFetch(`playlists/${loaded.playlistId}/items`, {
                method: 'DELETE',
                body: { items: part.map((u) => ({ uri: u })) },
              }),
            );
        if (error) {
          return partialFailure(
            'removing duplicates',
            processed,
            removable.length,
            error,
          );
        }
        removedNote = `\n\nRemoved ${processed} duplicate${processed === 1 ? '' : 's'} from ${loaded.label}.`;
      }

      return {
        content: [
          {
            type: 'text',
            text: `${summary}\n\n${shown || 'No duplicates found.'}${more}${repeatedNote}${removedNote}`,
          },
        ],
      };
    } catch (error) {
      return toolError('looking for duplicates', error);
    }
  },
});

// ------------------------------------------------------------------- compare

const comparePlaylists = defineTool({
  name: 'comparePlaylists',
  description:
    'Compare two song collections (Liked Songs and/or playlists): what is only in A, only in B and in both. Matches by track ID by default, or by normalised title and artist to also catch different versions.',
  schema: {
    a: sourceParam('First collection'),
    b: sourceParam('Second collection'),
    by: z
      .enum(['id', 'title-artist'])
      .optional()
      .describe(
        'Match by track ID (default) or by normalised title and artist',
      ),
    maxItems: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .optional()
      .describe('Maximum entries listed per section (default 100)'),
    format: z
      .enum(['compact', 'ids'])
      .optional()
      .describe(
        '"compact" (default) lists songs, "ids" lists only comma-separated IDs',
      ),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { a, b, by = 'id', maxItems = 100, format = 'compact' } = args;
    try {
      const left = await loadSource(a);
      const right = await loadSource(b);
      const key = (s: Song) => (by === 'id' ? s.id : songKey(s));
      const leftKeys = new Set(left.songs.map(key));
      const rightKeys = new Set(right.songs.map(key));
      const unique = (songs: Song[], other: Set<string>, wantIn: boolean) => {
        const seen = new Set<string>();
        return songs.filter((s) => {
          const k = key(s);
          if (other.has(k) !== wantIn || seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      };
      const onlyA = unique(left.songs, rightKeys, false);
      const onlyB = unique(right.songs, leftKeys, false);
      const both = unique(left.songs, rightKeys, true);

      const section = (title: string, songs: Song[]) => {
        const shown = songs.slice(0, maxItems);
        const body =
          format === 'ids'
            ? shown.map((s) => s.id).join(',')
            : shown.map(line).join('\n');
        const more =
          songs.length > shown.length
            ? `\n… and ${songs.length - shown.length} more`
            : '';
        return `## ${title} (${songs.length})\n${body || '—'}${more}`;
      };

      return {
        content: [
          {
            type: 'text',
            text:
              `# ${left.label} (${left.songs.length}) vs ${right.label} (${right.songs.length}), matched by ${by}\n\n` +
              [
                section(`Only in ${left.label}`, onlyA),
                section(`Only in ${right.label}`, onlyB),
                section('In both', both),
              ].join('\n\n'),
          },
        ],
      };
    } catch (error) {
      return toolError('comparing collections', error);
    }
  },
});

// ------------------------------------------------------------------ overview

const getLibraryOverview = defineTool({
  name: 'getLibraryOverview',
  description:
    "Summarise the user's library in one call: number of Liked Songs and playlists, total listening time, top artists, songs liked per year, oldest and newest likes and an estimate of duplicates.",
  schema: {
    topArtists: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('How many top artists to list (default 15)'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const { topArtists = 15 } = args;
    try {
      const liked = await loadLiked();
      const playlists = await spotifyFetch<{ total: number }>('me/playlists', {
        query: { limit: 1, offset: 0 },
      });

      const artistCounts = new Map<string, number>();
      const years = new Map<string, number>();
      const keys = new Map<string, number>();
      let totalMs = 0;
      for (const song of liked) {
        totalMs += song.durationMs;
        const artist = song.artists[0] ?? 'Unknown';
        artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
        const year = (song.addedAt ?? 'unknown').slice(0, 4);
        years.set(year, (years.get(year) ?? 0) + 1);
        const key = songKey(song);
        keys.set(key, (keys.get(key) ?? 0) + 1);
      }
      const duplicateExtras = [...keys.values()]
        .filter((n) => n > 1)
        .reduce((sum, n) => sum + n - 1, 0);
      const byDate = liked
        .filter((s) => s.addedAt)
        .sort(
          (x, y) => Date.parse(x.addedAt ?? '') - Date.parse(y.addedAt ?? ''),
        );
      const top = [...artistCounts.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, topArtists)
        .map(([name, n]) => `- ${name} (${n})`)
        .join('\n');
      const perYear = [...years.entries()]
        .sort((x, y) => x[0].localeCompare(y[0]))
        .map(([year, n]) => `- ${year}: ${n}`)
        .join('\n');
      const fmt = (s: Song) => `- ${line(s)} (${day(s.addedAt)})`;

      return {
        content: [
          {
            type: 'text',
            text:
              `# Library overview\n\n` +
              `Liked Songs: ${liked.length}\n` +
              `Playlists: ${playlists.total}\n` +
              `Total length of Liked Songs: ${(totalMs / 3600000).toFixed(1)} hours\n` +
              `Possible duplicates: ${duplicateExtras} extra copies (run findDuplicateTracks for details)\n\n` +
              `## Top artists\n${top || '—'}\n\n` +
              `## Liked per year\n${perYear || '—'}\n\n` +
              `## Oldest likes\n${byDate.slice(0, 3).map(fmt).join('\n') || '—'}\n\n` +
              `## Newest likes\n${byDate.slice(-3).reverse().map(fmt).join('\n') || '—'}`,
          },
        ],
      };
    } catch (error) {
      return toolError('building the library overview', error);
    }
  },
});

// ------------------------------------------------------ playlist from queries

const createPlaylistFromQueries = defineTool({
  name: 'createPlaylistFromQueries',
  description:
    'Build a playlist from plain-text song descriptions such as "Artist - Title": every line is searched on Spotify (best match wins), the playlist is created if it does not exist (or extended if it does, skipping songs already in it) and the resolved matches plus anything not found are reported. Use dryRun=true to check the matches first.',
  schema: {
    name: z
      .string()
      .min(1)
      .describe(
        'Playlist name (an existing playlist with this exact name is extended)',
      ),
    queries: z
      .array(z.string().min(1))
      .min(1)
      .max(500)
      .describe('Song descriptions, e.g. "Wheatus - Teenage Dirtbag"'),
    description: z
      .string()
      .optional()
      .describe('Description for a newly created playlist'),
    public: z
      .boolean()
      .optional()
      .describe('Make a newly created playlist public (default false)'),
    dryRun: z
      .boolean()
      .optional()
      .describe('Only search and report, do not create or change anything'),
  },
  handler: async (args, _extra: SpotifyHandlerExtra) => {
    const {
      name,
      queries,
      description,
      public: isPublic = false,
      dryRun = false,
    } = args;
    try {
      const found = await mapConcurrent(queries, 4, async (query) => {
        const q = query.replace(/\s+-\s+/g, ' ').trim();
        const res = await spotifyFetch<{ tracks?: { items: SpotifyTrack[] } }>(
          'search',
          { query: { q, type: 'track', limit: 5 } },
        );
        let best: { song: Song; score: number } | undefined;
        for (const item of res.tracks?.items ?? []) {
          const song = toSong(item);
          if (!song) continue;
          const score = coverage(query, song);
          if (!best || score > best.score) best = { song, score };
        }
        return { query, best };
      });
      const resolved = found
        .filter((f) => f.best && f.best.score >= MIN_COVERAGE)
        .map((f) => ({
          query: f.query,
          song: (f.best as { song: Song }).song,
        }));
      const uncertain = found.filter(
        (f) => f.best && f.best.score < MIN_COVERAGE,
      ) as { query: string; best: { song: Song } }[];
      const missing = found.filter((f) => !f.best).map((f) => f.query);

      const uniqueSongs: Song[] = [];
      for (const { song } of resolved) {
        if (!uniqueSongs.some((s) => s.id === song.id)) uniqueSongs.push(song);
      }

      let playlist = await resolvePlaylist(name, { exactOnly: true });
      const existing = new Set<string>();
      if (playlist) {
        for (const s of await loadPlaylist(playlist.id)) existing.add(s.id);
      }
      const toAdd = uniqueSongs.filter((s) => !existing.has(s.id));
      const alreadyThere = uniqueSongs.length - toAdd.length;

      const mapping = resolved
        .map((r) => `${r.query} → ${line(r.song)}`)
        .join('\n');
      const uncertainNote = uncertain.length
        ? `\n\nUncertain, not added (${uncertain.length}) - refine the query or add the ID yourself:\n${uncertain
            .map((u) => `- ${u.query} → ${line(u.best.song)}`)
            .join('\n')}`
        : '';
      const notFound = missing.length
        ? `\n\nNot found (${missing.length}):\n${missing.map((m) => `- ${m}`).join('\n')}`
        : '';
      const body = `\n\n${mapping || 'No matches.'}${uncertainNote}${notFound}`;
      const plural = (n: number) => `${n} track${n === 1 ? '' : 's'}`;

      if (dryRun) {
        return {
          content: [
            {
              type: 'text',
              text:
                `Dry run: found ${plural(uniqueSongs.length)} for ${queries.length} queries; ` +
                `playlist "${name}" ${playlist ? 'exists' : 'would be created'} (${alreadyThere} already in it, ${toAdd.length} to add). Nothing was changed.${body}`,
            },
          ],
        };
      }

      const created = !playlist;
      if (!playlist) {
        const made = await spotifyFetch<{ id: string }>('me/playlists', {
          method: 'POST',
          body: {
            name,
            public: isPublic,
            ...(description ? { description } : {}),
          },
        });
        playlist = { id: made.id, name };
      }
      const playlistId = playlist.id;
      const { processed, error } = await processInChunks(
        toAdd.map((s) => uri(s.id)),
        100,
        (part) =>
          spotifyFetch(`playlists/${playlistId}/items`, {
            method: 'POST',
            body: { uris: part },
          }),
      );
      if (error) {
        return partialFailure(
          'adding songs to the playlist',
          processed,
          toAdd.length,
          error,
        );
      }

      const headline = created
        ? `Created playlist "${name}" with ${plural(processed)}`
        : `Added ${plural(processed)} to "${name}" (${alreadyThere} already there)`;
      return { content: [{ type: 'text', text: `${headline}.${body}` }] };
    } catch (error) {
      return toolError('creating the playlist', error);
    }
  },
});

export const analysisTools = [
  findDuplicateTracks,
  comparePlaylists,
  getLibraryOverview,
  createPlaylistFromQueries,
];
