import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { albumTools } from './albums.js';
import { playTools } from './play.js';
import { playlistTools } from './playlist.js';
import { readTools } from './read.js';

const server = new McpServer({
  name: 'spotify-controller',
  version: '1.0.0',
});

[...readTools, ...playTools, ...albumTools, ...playlistTools].forEach(
  (tool) => {
    const safeHandler = tool.handler as (
      args: unknown,
      extra: unknown,
    ) => Promise<{ content: Array<{ type: 'text'; text: string }> }> | {
      content: Array<{ type: 'text'; text: string }>;
    };

    server.tool(
      tool.name,
      tool.description,
      tool.schema,
      async (args: unknown, extra: unknown) => {
        try {
          return await safeHandler(args, extra);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error in ${tool.name}: ${message}`,
              },
            ],
          };
        }
      },
    );
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
