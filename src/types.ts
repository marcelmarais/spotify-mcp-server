import type { ServerContext } from '@modelcontextprotocol/server';

export type SpotifyHandlerExtra = ServerContext;

export interface SpotifyArtist {
  id: string;
  name: string;
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  artists: SpotifyArtist[];
}

export interface SpotifyTrack {
  id: string;
  name: string;
  type: string;
  duration_ms: number;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
}

export interface SpotifyEpisodeShow {
  id: string;
  name: string;
}

export interface SpotifyEpisode {
  id: string;
  name: string;
  type: 'episode';
  description: string;
  duration_ms: number;
  release_date: string;
  show: SpotifyEpisodeShow | null;
}

export interface SpotifyShow {
  id: string;
  name: string;
  description: string;
  publisher: string;
  total_episodes: number;
}

/**
 * Simplified episode object returned by the Search API.
 * Does not include the `show` field — use the Episodes API for full objects.
 */
export interface SpotifySimplifiedEpisode {
  id: string;
  name: string;
  description: string;
  duration_ms: number;
  release_date: string;
}

export interface SpotifySearchEpisodesResponse {
  episodes: {
    items: Array<SpotifySimplifiedEpisode | null>;
  };
}

/** Full episode object returned by GET /episodes, includes show info. */
export interface SpotifyEpisodesResponse {
  episodes: Array<SpotifyEpisode | null>;
}

export interface SpotifySearchShowsResponse {
  shows: {
    items: Array<SpotifyShow | null>;
  };
}
