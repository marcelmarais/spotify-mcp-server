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

export async function serveHttp(
  factory: McpServerFactory,
  { host, port }: HttpOptions,
): Promise<Server> {
  const onerror = (error: Error) => console.error('MCP HTTP error:', error);
  const handle = toNodeHandler(createMcpHandler(factory, { onerror }), {
    onerror,
  });
  let guards: Guard[] = [];

  const server = createHttpServer((req, res) => {
    if (!guards.every((guard) => guard(req, res))) return;
    const url = URL.parse(req.url ?? '/', 'http://localhost');
    if (!url) {
      res.writeHead(400).end();
      return;
    }
    if (url.pathname !== '/mcp') {
      res.writeHead(404).end();
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
