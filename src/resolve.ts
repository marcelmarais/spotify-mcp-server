import { collectPages } from './paging.js';
import { spotifyFetch } from './utils.js';

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

export interface PlaylistRef {
  id: string;
  name: string;
}

export const looksLikeSpotifyId = (value: string) => SPOTIFY_ID.test(value);

async function listAllPlaylists(): Promise<PlaylistRef[]> {
  const { results } = await collectPages<PlaylistRef, PlaylistRef>({
    fetchPage: (offset, limit) =>
      spotifyFetch('me/playlists', { query: { limit, offset } }),
    select: (playlist) =>
      playlist ? { id: playlist.id, name: playlist.name } : null,
    startOffset: 0,
    maxItems: Number.MAX_SAFE_INTEGER,
  });
  return results;
}

/**
 * Resolves a playlist given by Spotify ID or by name. Names match
 * case-insensitively: exact first, then (unless exactOnly) as a unique
 * substring. Returns null when nothing matches, throws when ambiguous.
 */
export async function resolvePlaylist(
  nameOrId: string,
  options: { exactOnly?: boolean } = {},
): Promise<PlaylistRef | null> {
  if (looksLikeSpotifyId(nameOrId)) {
    return { id: nameOrId, name: nameOrId };
  }
  const wanted = nameOrId.trim().toLowerCase();
  const all = await listAllPlaylists();
  const pick = (candidates: PlaylistRef[]) => {
    if (candidates.length <= 1) return candidates[0] ?? null;
    const names = candidates.map((c) => `"${c.name}" [${c.id}]`).join(', ');
    throw new Error(
      `"${nameOrId}" matches several playlists: ${names}. Use the exact name or the ID.`,
    );
  };
  const exact = pick(all.filter((p) => p.name.toLowerCase() === wanted));
  if (exact || options.exactOnly) return exact;
  return pick(all.filter((p) => p.name.toLowerCase().includes(wanted)));
}
