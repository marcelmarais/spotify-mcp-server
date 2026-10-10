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
const auth = authOptionsFromEnv();
if (!auth) {
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
  // spotify-config.json.
  if (auth) {
    // The resource address is resolved once after the socket binds:
    // SPOTIFY_RESOURCE_URL (if set) is the canonical URL the MCP client uses
    // to reach this server (e.g. a Docker service name or reverse-proxy URL)
    // and wins over the bind address; otherwise derive it from the bound
    // port. The metadata document and the 401 challenge reuse this single
    // value.
    const resource: { value?: string } = {};
    const server = await serveHttp(createServer, http, {
      ...auth,
      resolveResourceUrl: () => resource.value ?? auth.resolveResourceUrl(),
    });
    const address = server.address() as AddressInfo | null;
    resource.value =
      auth.explicitResourceUrl ??
      `http://${formatHost(http.host)}:${address?.port ?? http.port}`;
    console.error(
      `Spotify MCP server listening on http://${formatHost(http.host)}:${address?.port ?? http.port}/mcp (OAuth: Bearer tokens required)`,
    );
  } else {
    const server = await serveHttp(createServer, http);
    const { port } = server.address() as AddressInfo;
    console.error(
      `Spotify MCP server listening on http://${formatHost(http.host)}:${port}/mcp`,
    );
  }
} else {
  serveStdio(createServer, {
    onerror(error) {
      console.error('MCP transport error:', error);
    },
  });
}
