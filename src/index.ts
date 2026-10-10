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
// Skipped in OAuth mode: tokens arrive fresh from the MCP client per
// request, and no local refresh token exists.
if (!authOptionsFromEnv()) {
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
const http = httpOptionsFromEnv();
if (http) {
  // Auth mode (MCP_AUTH=spotify): MCP clients (e.g. MCPHub) perform the
  // Spotify OAuth flow themselves and present the resulting access token as
  // Bearer. The token is used per request and never written to
  // spotify-config.json. serveHttp resolves the protected-resource address
  // once the socket binds (bound port) so metadata and 401 challenges agree.
  const auth = authOptionsFromEnv();
  const server = await serveHttp(createServer, http, auth);
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
