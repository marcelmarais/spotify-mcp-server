import fs from 'node:fs';
import path from 'node:path';
import {
  GenericCache,
  type ICachable,
  type ICacheStore,
} from '@spotify/web-api-ts-sdk';

type CacheFileContents = Record<string, ICachable>;

export default class FileBackedCachingStrategy extends GenericCache {
  constructor(cacheFile: string) {
    super(new FileBackedCacheStore(cacheFile));
  }
}

class FileBackedCacheStore implements ICacheStore {
  private readonly memory = new Map<string, string>();

  constructor(private readonly cacheFile: string) {}

  public get(key: string): string | null {
    const memoryValue = this.memory.get(key);
    if (memoryValue) {
      return memoryValue;
    }

    const fileValue = this.readCacheFile()[key];
    if (!fileValue) {
      return null;
    }

    const serialized = JSON.stringify(fileValue);
    this.memory.set(key, serialized);
    return serialized;
  }

  public set(key: string, value: string): void {
    this.memory.set(key, value);

    const item = parseCacheItem(value);
    if (!item || item.expiresOnAccess) {
      this.removePersisted(key);
      return;
    }

    const cache = this.readCacheFile();
    cache[key] = item;
    this.writeCacheFile(cache);
  }

  public remove(key: string): void {
    this.memory.delete(key);
    this.removePersisted(key);
  }

  private removePersisted(key: string): void {
    const cache = this.readCacheFile();
    if (!(key in cache)) {
      return;
    }

    delete cache[key];
    this.writeCacheFile(cache);
  }

  private readCacheFile(): CacheFileContents {
    try {
      if (!fs.existsSync(this.cacheFile)) {
        return {};
      }

      const parsed = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }

      return parsed as CacheFileContents;
    } catch {
      return {};
    }
  }

  private writeCacheFile(cache: CacheFileContents): void {
    const dir = path.dirname(this.cacheFile);
    fs.mkdirSync(dir, { recursive: true });

    const tempFile = path.join(
      dir,
      `.${path.basename(this.cacheFile)}.${process.pid}.tmp`,
    );

    fs.writeFileSync(tempFile, `${JSON.stringify(cache, null, 2)}\n`, {
      mode: 0o600,
    });
    fs.renameSync(tempFile, this.cacheFile);
  }
}

function parseCacheItem(value: string): ICachable | null {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed as ICachable;
  } catch {
    return null;
  }
}
