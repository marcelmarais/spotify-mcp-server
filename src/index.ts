import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { albumTools } from './albums.js';
import { playTools } from './play.js';
import { playlistTools } from './playlist.js';
import { readTools } from './read.js';
import { createSpotifyApi } from './utils.js';

const server = new McpServer({
  name: 'spotify-controller',
  version: '1.0.0',
});

[...readTools, ...playTools, ...albumTools, ...playlistTools].forEach(
  (tool) => {
    server.tool(tool.name, tool.description, tool.schema, tool.handler);
  },
);

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
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
