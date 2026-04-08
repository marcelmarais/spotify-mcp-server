import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { albumTools } from './albums.js';
import { playTools } from './play.js';
import { playlistTools } from './playlist.js';
import { readTools } from './read.js';
import type { SpotifyHandlerExtra } from './types.js';

type LogLevel = 'INFO' | 'ERROR';

const SENSITIVE_KEY_PATTERN =
  /token|secret|password|authorization|accesskey|refreshkey|clientsecret/i;

let invocationCounter = 0;

function nextInvocationId(): string {
  invocationCounter += 1;
  return `req-${Date.now()}-${invocationCounter}`;
}

function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 3) return '[Truncated]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    const limited = value.slice(0, 10).map((v) => sanitizeForLog(v, depth + 1));
    if (value.length > 10) limited.push(`[+${value.length - 10} more items]`);
    return limited;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const entries = Object.entries(obj).slice(0, 20);
    const out: Record<string, unknown> = {};

    for (const [key, nestedValue] of entries) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = sanitizeForLog(nestedValue, depth + 1);
      }
    }

    const keyCount = Object.keys(obj).length;
    if (keyCount > 20) {
      out.__truncatedKeys = `[+${keyCount - 20} more keys]`;
    }

    return out;
  }

  return `[Unsupported:${typeof value}]`;
}

function summarizeToolResponse(result: unknown): Record<string, unknown> {
  const safeResult = sanitizeForLog(result) as
    | Record<string, unknown>
    | unknown;
  const content =
    safeResult && typeof safeResult === 'object'
      ? (safeResult as { content?: unknown }).content
      : undefined;

  if (!Array.isArray(content)) {
    return {
      hasContentArray: false,
      responsePreview: safeResult,
    };
  }

  const first = content[0] as { type?: unknown; text?: unknown } | undefined;
  const text = typeof first?.text === 'string' ? first.text : '';

  return {
    hasContentArray: true,
    contentItems: content.length,
    firstContentType: first?.type,
    firstTextLength: text.length,
    firstTextPreview: text.length > 140 ? `${text.slice(0, 137)}...` : text,
  };
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const suffix = meta ? ` ${JSON.stringify(meta)}` : '';
  // MCP over stdio must keep stdout clean, so logs go to stderr.
  process.stderr.write(`[${timestamp}] [${level}] ${message}${suffix}\n`);
}

const server = new McpServer({
  name: 'spotify-controller',
  version: '1.0.0',
});

const allTools = [...readTools, ...playTools, ...albumTools, ...playlistTools];

[...allTools].forEach((tool) => {
  server.tool(
    tool.name,
    tool.description,
    tool.schema,
    async (args: any, extra: SpotifyHandlerExtra) => {
      const invocationId = nextInvocationId();
      const startedAt = Date.now();
      const argKeys = args ? Object.keys(args) : [];
      const safeArgs = sanitizeForLog(args);
      const requestMeta = sanitizeForLog(extra);

      log('INFO', 'Tool call started', {
        invocationId,
        tool: tool.name,
        argKeys,
        args: safeArgs,
        requestMeta,
      });

      try {
        const result = await tool.handler(args, extra);
        const durationMs = Date.now() - startedAt;
        const responseSummary = summarizeToolResponse(result);
        log('INFO', 'Tool call completed', {
          invocationId,
          tool: tool.name,
          durationMs,
          response: responseSummary,
        });
        return result;
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const message = error instanceof Error ? error.message : String(error);
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        const errorStack =
          error instanceof Error && error.stack
            ? error.stack.split('\n').slice(0, 4).join('\n')
            : undefined;
        log('ERROR', 'Tool call failed', {
          invocationId,
          tool: tool.name,
          durationMs,
          errorName,
          error: message,
          errorStack,
        });
        throw error;
      }
    },
  );
});

async function main() {
  log('INFO', 'Starting Spotify MCP server', {
    serverName: 'spotify-controller',
    version: '1.0.0',
    toolCount: allTools.length,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log('INFO', 'Spotify MCP server connected to stdio transport');
}

process.on('SIGINT', () => {
  log('INFO', 'Received SIGINT, exiting');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('INFO', 'Received SIGTERM, exiting');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  log('ERROR', 'Unhandled promise rejection', { error: message });
});

process.on('uncaughtException', (error) => {
  log('ERROR', 'Uncaught exception', { error: error.message });
  process.exit(1);
});

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  log('ERROR', 'Fatal error in main()', { error: message });
  process.exit(1);
});
