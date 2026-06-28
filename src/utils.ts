import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import open from 'open';
import AuthorizationCodeWithPKCEStrategy from './AuthorizationCodeWithPKCEStrategy.js';
import FileBackedCachingStrategy from './FileBackedCachingStrategy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, '../spotify-config.json');
const TOKEN_CACHE_FILE = path.join(__dirname, '../spotify-token-cache.json');
const AUTH_LOCK_FILE = path.join(__dirname, '../spotify-auth.lock');
const AUTH_TIMEOUT_MS = 2 * 60 * 1000;
const AUTH_LOCK_POLL_INTERVAL_MS = 250;

const SPOTIFY_SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-modify-private',
  'playlist-modify-public',
  'user-library-read',
  'user-library-modify',
  'user-read-recently-played',
  'user-read-playback-position',
  'user-top-read',
];

export interface SpotifyConfig {
  clientId: string;
  redirectUri: string;
}

export function loadSpotifyConfig(): SpotifyConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(
      `Spotify configuration file not found at ${CONFIG_FILE}. Please create one with clientId and redirectUri.`,
    );
  }

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (!(config.clientId && config.redirectUri)) {
      throw new Error(
        'Spotify configuration must include clientId and redirectUri.',
      );
    }
    return config;
  } catch (error) {
    throw new Error(
      `Failed to parse Spotify configuration: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

let cachedSpotifyApi: SpotifyApi | null = null;
let authenticationPromise: Promise<void> | null = null;

export function initializeSpotifyApi(config: SpotifyConfig): void {
  const redirectUri = new URL(config.redirectUri);
  if (
    redirectUri.hostname !== 'localhost' &&
    redirectUri.hostname !== '127.0.0.1'
  ) {
    throw new Error(
      'Spotify redirectUri must use localhost or 127.0.0.1 for PKCE authentication.',
    );
  }

  const authStrategy = new AuthorizationCodeWithPKCEStrategy(
    config.clientId,
    config.redirectUri,
    SPOTIFY_SCOPES,
    async (authorizationUrl) =>
      await waitForAuthorizationCallback(redirectUri, authorizationUrl),
    {
      lockFile: AUTH_LOCK_FILE,
      ttlMs: AUTH_TIMEOUT_MS,
      pollIntervalMs: AUTH_LOCK_POLL_INTERVAL_MS,
    },
  );

  cachedSpotifyApi = new SpotifyApi(authStrategy, {
    cachingStrategy: new FileBackedCachingStrategy(TOKEN_CACHE_FILE),
  });
}

export function getSpotifyApi(): SpotifyApi {
  if (!cachedSpotifyApi) {
    throw new Error('Spotify API has not been initialized.');
  }
  return cachedSpotifyApi;
}

async function waitForAuthorizationCallback(
  redirectUri: URL,
  authorizationUrl: string,
): Promise<string> {
  const hostname = redirectUri.hostname;
  const port = Number.parseInt(
    redirectUri.port || (redirectUri.protocol === 'https:' ? '443' : '80'),
    10,
  );
  const callbackPath = redirectUri.pathname || '/callback';

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end('Missing request URL');
        return;
      }

      const callbackUrl = new URL(req.url, redirectUri.origin);
      if (callbackUrl.pathname !== callbackPath) {
        res.writeHead(404);
        res.end();
        return;
      }

      const error = callbackUrl.searchParams.get('error');
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(
          '<html><body><h1>Authentication Failed</h1><p>Please close this window and try again.</p></body></html>',
        );
        settle(() =>
          reject(new Error(`Spotify authorization failed: ${error}`)),
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<html><body><h1>Authentication Successful</h1><p>You can close this window and return to the application.</p></body></html>',
      );
      settle(() => resolve(callbackUrl.toString()));
    });

    const timeout = setTimeout(() => {
      settle(() =>
        reject(
          new Error(
            `Spotify authorization timed out after ${AUTH_TIMEOUT_MS / 1000} seconds.`,
          ),
        ),
      );
    }, AUTH_TIMEOUT_MS);

    function settle(callback: () => void): void {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      closeServer(server);
      callback();
    }

    server.on('error', (error) => {
      settle(() => reject(error));
    });
    server.listen(port, hostname, () => {
      console.error('Opening browser for Spotify authorization...');
      console.error('If no browser opens, visit this URL manually:');
      console.error(authorizationUrl);
      open(authorizationUrl).catch((error: Error) => {
        console.error(`Failed to open browser automatically: ${error.message}`);
      });
    });
  });
}

function closeServer(server: http.Server): void {
  try {
    server.close();
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
    if (code !== 'ERR_SERVER_NOT_RUNNING') {
      throw error;
    }
  }
}

async function authenticateSpotifyApi(spotifyApi: SpotifyApi): Promise<void> {
  authenticationPromise ??= (async () => {
    const authResult = await spotifyApi.authenticate();

    if (!authResult.authenticated) {
      throw new Error('Spotify authentication did not complete.');
    }
  })();

  try {
    await authenticationPromise;
  } finally {
    authenticationPromise = null;
  }
}

/**
 * SDK-backed Spotify Web API helper for endpoints not exposed by
 * @spotify/web-api-ts-sdk, such as /playlists/{id}/items.
 */
export async function spotifyFetch<T = unknown>(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    query?: Record<string, string | number | undefined>;
  } = {},
): Promise<T> {
  const { method = 'GET', body, query } = options;
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  const url = new URL(cleanEndpoint, 'https://api.spotify.com/v1/');
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
    }
  }

  const relativeUrl = `${url.pathname.replace(/^\/v1\//, '')}${url.search}`;
  return await handleSpotifyRequest(async (spotifyApi) => {
    return await spotifyApi.makeRequest<T>(method, relativeUrl, body);
  });
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}:${seconds.padStart(2, '0')}`;
}

export async function handleSpotifyRequest<T>(
  action: (spotifyApi: SpotifyApi) => Promise<T>,
): Promise<T> {
  try {
    const spotifyApi = getSpotifyApi();
    await authenticateSpotifyApi(spotifyApi);
    return await action(spotifyApi);
  } catch (error) {
    // Skip JSON parsing errors as these are actually successful operations
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (
      errorMessage.includes('Unexpected token') ||
      errorMessage.includes('Unexpected non-whitespace character') ||
      errorMessage.includes('Exponent part is missing a number in JSON')
    ) {
      return undefined as T;
    }
    // Rethrow other errors
    throw error;
  }
}
