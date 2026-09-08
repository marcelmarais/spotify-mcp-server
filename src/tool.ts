import type {
  CallToolResult,
  McpServer,
  ServerContext,
} from '@modelcontextprotocol/server';
import { z } from 'zod';

// Keep each handler paired with its inferred schema when registering mixed tools.
export function defineTool<Args extends z.ZodRawShape>(definition: {
  name: string;
  description: string;
  schema: Args;
  handler: (
    args: z.output<z.ZodObject<Args>>,
    context: ServerContext,
  ) => Promise<CallToolResult> | CallToolResult;
}) {
  return {
    ...definition,
    register(server: McpServer) {
      server.registerTool(
        definition.name,
        {
          description: definition.description,
          inputSchema: z.object(definition.schema),
        },
        definition.handler,
      );
    },
  };
}
