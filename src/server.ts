import { McpServer } from '@modelcontextprotocol/server';
import { albumTools } from './albums.js';
import { bulkTools } from './bulk.js';
import { libraryTools } from './library.js';
import { playTools } from './play.js';
import { playlistTools } from './playlist.js';
import { readTools } from './read.js';
import { workflowTools } from './workflows.js';

export function createServer() {
  const server = new McpServer({
    name: 'spotify-controller',
    version: '1.0.0',
  });

  [
    ...readTools,
    ...playTools,
    ...albumTools,
    ...playlistTools,
    ...libraryTools,
    ...bulkTools,
    ...workflowTools,
  ].forEach((tool) => {
    tool.register(server);
  });

  return server;
}
