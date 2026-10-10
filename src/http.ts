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
  resourceUrl: string;
  resourceMetadataUrl: string;
  /**
   * The resource URL as explicitly set via SPOTIFY_RESOURCE_URL, if any.
   * When present it is the canonical identifier the MCP client uses to reach
   * this server (e.g. a Docker service name or a reverse-proxy public URL)
   * and must not be replaced by the local bind address (e.g. 0.0.0.0 in
   * Docker). Undefined when the caller must derive it from the bound port.
   */
  explicitResourceUrl?: string;
  /** Returns the effective resource URL, e.g. with the bound port. */
  resolveResourceUrl?: () => string;
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
    resourceUrl,
    resourceMetadataUrl: `${resourceUrl}/.well-known/oauth-protected-resource`,
    ...(env.SPOTIFY_RESOURCE_URL
      ? { explicitResourceUrl: env.SPOTIFY_RESOURCE_URL }
      : {}),
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
          resource: auth.resolveResourceUrl?.() ?? auth.resourceUrl,
          authorization_servers: auth.authorizationServers,
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
          'WWW-Authenticate': `Bearer realm="spotify", resource_metadata="${auth.resourceMetadataUrl}"`,
        });
        res.end('Unauthorized');
        return;
      }
      // The Bearer token is a valid Spotify access token issued to the
      // MCP client by the authorization server; use it for this request's
      // Spotify API calls and keep it out of the local config file.
      void withSpotifyRequestToken(match[1], () => handle(req, res));
      return;
    }

    void handle(req, res);
  });

  server.once('listening', () => {
    const bound = server.address();
    if (typeof bound === 'object' && bound && isLoopbackAddress(bound.address))
      guards = loopbackGuards(host, bound.address);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return server;
}
