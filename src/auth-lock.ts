import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

export interface AuthLockOptions {
  lockFile: string;
  ttlMs: number;
  pollIntervalMs: number;
}

interface HeldLock {
  handle: fs.promises.FileHandle;
  id: string;
}

export async function withAuthLock<T>(
  options: AuthLockOptions,
  action: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  let lock: HeldLock | null = null;

  while (!lock) {
    lock = await tryAcquireLock(options);
    if (lock) {
      break;
    }

    if (Date.now() - startedAt >= options.ttlMs) {
      throw new Error('Timed out waiting for Spotify authentication lock.');
    }

    await sleep(options.pollIntervalMs);
  }

  try {
    return await action();
  } finally {
    await lock.handle.close();
    await releaseLock(options, lock.id);
  }
}

async function tryAcquireLock(
  options: AuthLockOptions,
): Promise<HeldLock | null> {
  await removeStaleLock(options);

  try {
    const id = randomUUID();
    const handle = await fs.promises.open(options.lockFile, 'wx', 0o600);
    await handle.writeFile(
      JSON.stringify(
        {
          id,
          pid: process.pid,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + options.ttlMs).toISOString(),
        },
        null,
        2,
      ),
    );
    return { handle, id };
  } catch (error) {
    if (isFileExistsError(error)) {
      return null;
    }

    throw error;
  }
}

async function releaseLock(
  options: AuthLockOptions,
  expectedId: string,
): Promise<void> {
  try {
    const raw = await fs.promises.readFile(options.lockFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'id' in parsed &&
      parsed.id === expectedId
    ) {
      await fs.promises.rm(options.lockFile, { force: true });
    }
  } catch (error) {
    if (isNotFoundError(error) || error instanceof SyntaxError) {
      return;
    }

    throw error;
  }
}

async function removeStaleLock(options: AuthLockOptions): Promise<void> {
  try {
    const stats = await fs.promises.stat(options.lockFile);
    if (Date.now() - stats.mtimeMs < options.ttlMs) {
      return;
    }

    await fs.promises.rm(options.lockFile, { force: true });
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }

    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  );
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
