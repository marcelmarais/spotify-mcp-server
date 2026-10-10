import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import {
  authOptionsFromEnv,
  formatHost,
  httpOptionsFromEnv,
  serveHttp,
} from './http.js';
import { createServer } from './server.js';
import { createSpotifyApi } from './utils.js';

// Proactively refresh the Spotify token every 45 minutes so it never
// expires mid-session (tokens last 60 minutes; this keeps a safe buffer).
// Skipped in OAuth mode: tokens arrive fresh from the MCP client per request.
const http = httpOptionsFromEnv();
if (http && !authOptionsFromEnv(process.env, http)) {
  setInterval(
    async () => {
      try {
        await createSpotifyApi();
      } catch {
        // Errors will surface on the next tool call; nothing actionable here.
      }
    },
    45 * 60 * 1000,
  ).unref();
}
if (http) {
  // Auth mode (MCP_AUTH=spotify): MCP clients (e.g. MCPHub) perform the
  // Spotify OAuth flow themselves and present the resulting access token as
  // Bearer. The token is used per request and never written to
  // spotify-config.json.
  const auth = authOptionsFromEnv(process.env, http);
  let server!: Server;
  server = await serveHttp(
    createServer,
    http,
    auth
      ? {
          ...auth,
          resolveResourceUrl: () =>
            `http://${formatHost(http.host)}:${
              (server.address() as AddressInfo | null)?.port ?? http.port
            }`,
        }
      : undefined,
  );
  const { port } = server.address() as AddressInfo;
  console.error(
    `Spotify MCP server listening on http://${formatHost(http.host)}:${port}/mcp${
      auth ? ' (OAuth: Bearer tokens required)' : ''
    }`,
  );
} else {
  serveStdio(createServer, {
    onerror(error) {
      console.error('MCP transport error:', error);
    },
  });
}
