import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { albumTools } from './albums.js';
import { deviceTools } from './devices.js';
import { playTools } from './play.js';
import { readTools } from './read.js';

const allTools = [
  ...readTools,
  ...playTools,
  ...albumTools,
  ...deviceTools,
];

// Helper function to convert Zod schema to JSON schema
function zodToJsonSchema(zodSchema: any): any {
  const def = zodSchema._def;
  
  if (def.typeName === 'ZodString') {
    return {
      type: 'string',
      description: def.description || '',
    };
  }
  
  if (def.typeName === 'ZodNumber') {
    return {
      type: 'number',
      description: def.description || '',
    };
  }
  
  if (def.typeName === 'ZodBoolean') {
    return {
      type: 'boolean',
      description: def.description || '',
    };
  }
  
  if (def.typeName === 'ZodArray') {
    return {
      type: 'array',
      items: zodToJsonSchema(def.type),
      description: def.description || '',
    };
  }
  
  if (def.typeName === 'ZodEnum') {
    return {
      type: 'string',
      enum: def.values,
      description: def.description || '',
    };
  }
  
  if (def.typeName === 'ZodOptional') {
    return zodToJsonSchema(def.innerType);
  }
  
  if (def.typeName === 'ZodUnion') {
    // For unions, we'll use the first type as the primary type
    const firstType = def.options[0];
    return zodToJsonSchema(firstType);
  }
  
  // Default fallback
  return {
    type: 'string',
    description: def.description || '',
  };
}

// Convert tools to MCP format
const mcpTools = allTools.map((tool) => {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  
  Object.entries(tool.schema).forEach(([key, schema]) => {
    const isOptional = schema._def.typeName === 'ZodOptional';
    properties[key] = zodToJsonSchema(schema);
    
    if (!isOptional) {
      required.push(key);
    }
  });
  
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: 'object',
      properties,
      required,
    },
  };
});

async function main() {
  const server = new Server(
    {
      name: 'spotify-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
    }
  );

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: mcpTools,
    };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    const tool = allTools.find(t => t.name === name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    try {
      // Create a mock SpotifyHandlerExtra for MCP server context
      const mockExtra = {
        signal: new AbortController().signal,
        requestId: 'mcp-request',
        sendNotification: async () => {},
        sendRequest: async () => ({}),
      };
      
      // Type assertion to handle the generic args from MCP
      const result = await tool.handler(args as any, mockExtra);
      return {
        content: result.content,
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing tool "${name}": ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Spotify MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
