/** Bounded, access-ordered cache. Eviction never reaches persistent storage. */
export class MemoryCache<T> {
  private readonly entries = new Map<string, { value: T; bytes: number }>();
  private bytes = 0;
  readonly maxEntries: number;
  readonly maxBytes: number;

  constructor(maxEntries: number, maxBytes: number) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isInteger(maxBytes) || maxBytes < 1) {
      throw new Error('Cache limits must be positive integers.');
    }
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }

  get size(): number { return this.entries.size; }
  /** UTF-8 serialized payload accounting, not the JavaScript heap size. */
  get byteSize(): number { return this.bytes; }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Reinsert after mutating a cached value to refresh its payload accounting. */
  set(key: string, value: T): boolean {
    const bytes = new TextEncoder().encode(JSON.stringify([key, value])).length;
    this.delete(key);
    // An oversized item is usable by the caller but is not retained in memory.
    if (bytes > this.maxBytes) return false;
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      this.delete(this.entries.keys().next().value!);
    }
    return true;
  }

  delete(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.bytes -= entry.bytes;
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}

export const DISPLAY_CACHE_MAX_ENTRIES = 500;
export const DISPLAY_CACHE_MAX_BYTES = 4 * 1024 * 1024;
