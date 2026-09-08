import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';
import { createSpotifyApi } from './utils.js';

// Proactively refresh the Spotify token every 45 minutes so it never
// expires mid-session (tokens last 60 minutes; this keeps a safe buffer).
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

serveStdio(createServer, {
  onerror(error) {
    console.error('MCP transport error:', error);
  },
});
