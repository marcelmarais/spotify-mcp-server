#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { albumTools } from './albums.js';
import { playTools } from './play.js';
import { playlistTools } from './playlist.js';
import { readTools } from './read.js';
import { authorizeSpotify } from './utils.js';

async function runServer() {
  const server = new McpServer({
    name: 'spotify-controller',
    version: '1.0.0',
  });

  for (const tool of [
    ...readTools,
    ...playTools,
    ...albumTools,
    ...playlistTools,
  ]) {
    server.tool(tool.name, tool.description, tool.schema, tool.handler);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function runAuth() {
  console.log('Starting Spotify authentication flow...');
  await authorizeSpotify();
  console.log('Authentication completed successfully!');
}

const subcommand = process.argv[2];

const task = subcommand === 'auth' ? runAuth() : runServer();

task.catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
