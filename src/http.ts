import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { BlockList, isIPv6 } from 'node:net';
import {
  hostHeaderValidation,
  originValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node';
import {
  createMcpHandler,
  type McpServerFactory,
} from '@modelcontextprotocol/server';
import { withSpotifyRequestToken } from './request-context.js';
import { SPOTIFY_SCOPES, validateSpotifyToken } from './utils.js';

export interface HttpOptions {
  host: string;
  port: number;
}

type Guard = (req: IncomingMessage, res: ServerResponse) => boolean;

export function httpOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): HttpOptions | undefined {
  if (env.MCP_TRANSPORT !== 'http') return undefined;
  const port = Number(env.MCP_HTTP_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid MCP_HTTP_PORT: ${env.MCP_HTTP_PORT}`);
  }
  return { host: env.MCP_HTTP_HOST || '127.0.0.1', port };
}

const loopback = new BlockList();
loopback.addSubnet('127.0.0.0', 8, 'ipv4');
loopback.addAddress('::1', 'ipv6');
loopback.addSubnet('::ffff:127.0.0.0', 104, 'ipv6');

export function isLoopbackAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  try {
    return loopback.check(ip, isIPv6(ip) ? 'ipv6' : 'ipv4');
  } catch {
    return false;
  }
}

export function formatHost(address: string): string {
  return isIPv6(address) ? `[${address}]` : address;
}

function loopbackGuards(configuredHost: string, address: string): Guard[] {
  const hostnames = ['localhost', '127.0.0.1', '[::1]'];
  for (const name of [configuredHost, address]) {
    const hostname = URL.parse(`http://${formatHost(name)}`)?.hostname;
    if (hostname) hostnames.push(hostname);
  }
  return [hostHeaderValidation(hostnames), originValidation(hostnames)];
}

interface AuthOptions {
  authorizationServers: string[];
  /**
   * The resource URL as explicitly set via SPOTIFY_RESOURCE_URL, if any.
   * When present it is the canonical identifier the MCP client uses to reach
   * this server (e.g. a Docker service name or a reverse-proxy public URL)
   * and must not be replaced by the local bind address (e.g. 0.0.0.0 in
   * Docker).
   */
  explicitResourceUrl?: string;
  /** Returns the effective resource URL, e.g. with the bound port. */
  resolveResourceUrl: () => string;
}

export function authOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  base?: HttpOptions,
): AuthOptions | undefined {
  if (env.MCP_AUTH !== 'spotify') return undefined;
  const host = env.SPOTIFY_RESOURCE_HOST || base?.host || '127.0.0.1';
  const port = env.SPOTIFY_RESOURCE_PORT || String(base?.port ?? 3000);
  const resourceUrl =
    env.SPOTIFY_RESOURCE_URL || `http://${formatHost(host)}:${port}`;
  return {
    authorizationServers: env.SPOTIFY_AUTHORIZATION_SERVERS?.split(',').filter(
      Boolean,
    ) ?? ['https://accounts.spotify.com'],
    explicitResourceUrl: env.SPOTIFY_RESOURCE_URL,
    resolveResourceUrl: () => resourceUrl,
  };
}

export async function serveHttp(
  factory: McpServerFactory,
  { host, port }: HttpOptions,
  auth?: AuthOptions,
): Promise<Server> {
  const onerror = (error: Error) => console.error('MCP HTTP error:', error);
  const handle = toNodeHandler(createMcpHandler(factory, { onerror }), {
    onerror,
  });
  let guards: Guard[] = [];

  // The resource address is resolved once after the socket binds and is then
  // reused for the metadata document and every 401 challenge, so they can
  // never advertise different addresses (including port 0 before listen).
  // Before the server is listening, fall back to the configured port.
  let resourceUrl = auth
    ? (auth.explicitResourceUrl ?? `http://${formatHost(host)}:${port}`)
    : '';
  const resourceMetadataUrl = () =>
    `${resourceUrl}/.well-known/oauth-protected-resource`;

  const server = createHttpServer((req, res) => {
    const url = URL.parse(req.url ?? '/', 'http://localhost');
    if (!url) {
      res.writeHead(400).end();
      return;
    }

    // Protected resource metadata (RFC 9728). Served unauthenticated and
    // without the loopback Host/Origin guards so external MCP clients can
    // discover the authorization server. Only present in auth mode.
    if (url.pathname === '/.well-known/oauth-protected-resource') {
      if (!auth) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      });
      res.end(
        JSON.stringify({
          resource: resourceUrl,
          authorization_servers: auth.authorizationServers,
          scopes_supported: [...SPOTIFY_SCOPES],
        }),
      );
      return;
    }

    if (!guards.every((guard) => guard(req, res))) return;
    if (url.pathname !== '/mcp') {
      res.writeHead(404).end();
      return;
    }

    if (auth) {
      const header = req.headers.authorization ?? '';
      const match = /^Bearer (.+)$/.exec(header);
      if (!match?.[1]) {
        res.writeHead(401, {
          'WWW-Authenticate': `Bearer realm="spotify", resource_metadata="${resourceMetadataUrl()}"`,
        });
        res.end('Unauthorized');
        return;
      }
      // The Bearer token is a valid Spotify access token issued to the
      // MCP client by the authorization server; use it for this request's
      // Spotify API calls and keep it out of the local config file.
      void (async () => {
        let tokenError: unknown;
        try {
          await ensureTokenValid(match[1]);
        } catch (error) {
          tokenError = error;
        }
        if (tokenError) {
          let status: number = 502;
          if (
            tokenError instanceof Error &&
            'status' in tokenError &&
            typeof tokenError.status === 'number'
          ) {
            status = tokenError.status === 401 ? 401 : 502;
          }
          res.writeHead(status, {
            'WWW-Authenticate': `Bearer realm="spotify", error="${
              status === 401 ? 'invalid_token' : 'server_error'
            }", resource_metadata="${resourceMetadataUrl()}"`,
          });
          res.end('Unauthorized');
          return;
        }
        withSpotifyRequestToken(match[1], () => void handle(req, res));
      })();
      return;
    }

    void handle(req, res);
  });

  server.once('listening', () => {
    const bound = server.address();
    if (typeof bound === 'object' && bound && isLoopbackAddress(bound.address))
      guards = loopbackGuards(host, bound.address);
    if (auth) {
      resourceUrl = auth.explicitResourceUrl ?? auth.resolveResourceUrl();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return server;
}

/**
 * Validates Bearer tokens lazily: the first request of each distinct token
 * (i.e. token rotation by the MCP client) triggers a Spotify /me ping;
 * validated tokens are memoised so steady-state requests add no latency.
 * The ping is skipped entirely under test mocking of global fetch.
 */
const validatedTokens = new Set<string>();

export function resetTokenValidationCache(): void {
  validatedTokens.clear();
}

async function ensureTokenValid(token: string): Promise<void> {
  if (validatedTokens.has(token)) return;
  await validateSpotifyToken(token);
  validatedTokens.add(token);
}
