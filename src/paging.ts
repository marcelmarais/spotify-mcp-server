import type { CallToolResult } from '@modelcontextprotocol/server';
import { toolError } from './tool.js';

export const PAGE_SIZE = 50;
export const MAX_BULK_IDS = 5000;

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Runs `run` over `items` in sequential chunks. Stops at the first failing
 * chunk and reports how many items were processed before it.
 */
export async function processInChunks<T>(
  items: T[],
  size: number,
  run: (chunk: T[], startIndex: number) => Promise<void>,
): Promise<{ processed: number; error?: unknown }> {
  let processed = 0;
  for (const part of chunk(items, size)) {
    try {
      await run(part, processed);
    } catch (error) {
      return { processed, error };
    }
    processed += part.length;
  }
  return { processed };
}

export function partialFailure(
  action: string,
  processed: number,
  total: number,
  error: unknown,
): CallToolResult {
  return toolError(
    `${action} (${processed} of ${total} processed before the failure)`,
    error,
  );
}

export interface PageResult<T> {
  items: T[];
  total: number;
}

export interface CollectOptions<T, R> {
  fetchPage: (offset: number, limit: number) => Promise<PageResult<T>>;
  /** Maps an item to a result, or null to skip it (filtered out). */
  select: (item: T) => R | null;
  startOffset: number;
  maxItems: number;
}

export interface Collected<R> {
  results: R[];
  total: number;
  /** Library offset to continue from, or undefined when everything was scanned. */
  nextOffset?: number;
}

/** Pages through a Spotify list until it is exhausted or maxItems matches were found. */
export async function collectPages<T, R>(
  options: CollectOptions<T, R>,
): Promise<Collected<R>> {
  const { fetchPage, select, startOffset, maxItems } = options;
  const results: R[] = [];
  let offset = startOffset;
  let total = 0;
  while (true) {
    const page = await fetchPage(offset, PAGE_SIZE);
    total = page.total;
    const items = page.items ?? [];
    for (let i = 0; i < items.length; i++) {
      const selected = select(items[i] as T);
      if (selected === null) continue;
      results.push(selected);
      if (results.length >= maxItems) {
        const next = offset + i + 1;
        return { results, total, nextOffset: next < total ? next : undefined };
      }
    }
    offset += items.length;
    if (items.length === 0 || offset >= total) {
      return { results, total };
    }
  }
}
