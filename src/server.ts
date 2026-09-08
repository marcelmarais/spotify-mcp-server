import { McpServer } from '@modelcontextprotocol/server';
import { albumTools } from './albums.js';
import { playTools } from './play.js';
import { playlistTools } from './playlist.js';
import { readTools } from './read.js';

export function createServer() {
  const server = new McpServer({
    name: 'spotify-controller',
    version: '1.0.0',
  });

  [...readTools, ...playTools, ...albumTools, ...playlistTools].forEach(
    (tool) => {
      tool.register(server);
    },
  );

  return server;
}
