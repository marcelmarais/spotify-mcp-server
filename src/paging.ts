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

const CONCURRENCY = 4;

/**
 * Pages through a Spotify list until it is exhausted or maxItems matches were
 * found. After the first page reveals the total, further pages are fetched in
 * small concurrent batches; results are still processed in offset order.
 */
export async function collectPages<T, R>(
  options: CollectOptions<T, R>,
): Promise<Collected<R>> {
  const { fetchPage, select, startOffset, maxItems } = options;
  const results: R[] = [];
  let total = 0;
  let nextPageOffset = startOffset;
  let first = true;

  while (first || nextPageOffset < total) {
    const stillNeeded = Math.ceil((maxItems - results.length) / PAGE_SIZE);
    const remainingPages = first
      ? 1
      : Math.ceil((total - nextPageOffset) / PAGE_SIZE);
    const batch = first
      ? 1
      : Math.min(CONCURRENCY, stillNeeded, remainingPages);
    const offsets = Array.from(
      { length: batch },
      (_, i) => nextPageOffset + i * PAGE_SIZE,
    );
    first = false;

    const pages = await Promise.all(
      offsets.map((offset) => fetchPage(offset, PAGE_SIZE)),
    );
    for (let p = 0; p < pages.length; p++) {
      const page = pages[p] as PageResult<T>;
      total = page.total;
      const items = page.items ?? [];
      const base = offsets[p] as number;
      for (let i = 0; i < items.length; i++) {
        const selected = select(items[i] as T);
        if (selected === null) continue;
        results.push(selected);
        if (results.length >= maxItems) {
          const next = base + i + 1;
          return {
            results,
            total,
            nextOffset: next < total ? next : undefined,
          };
        }
      }
      if (items.length === 0) return { results, total };
    }
    nextPageOffset = (offsets[offsets.length - 1] as number) + PAGE_SIZE;
  }
  return { results, total };
}

/** Maps items with at most `limit` promises in flight, preserving order. */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await fn(items[index] as T, index);
      }
    },
  );
  await Promise.all(workers);
  return out;
}
