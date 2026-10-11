import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request Spotify access token, set by the HTTP transport in auth mode
 * (MCP_AUTH=spotify). The Bearer token sent by the MCP client IS a valid
 * Spotify access token: the client (e.g. MCPHub) performs the Spotify OAuth
 * flow itself, so this process never needs the client secret or a
 * refresh token.
 *
 * stdio mode (no auth layer) leaves the storage empty; code falls back to
 * the legacy spotify-config.json flow.
 */
const tokenStorage = new AsyncLocalStorage<string | null>();

export function withSpotifyRequestToken<T>(token: string, fn: () => T): T {
  return tokenStorage.run(token, fn);
}

export function getSpotifyRequestToken(): string | null {
  return tokenStorage.getStore() ?? null;
}
