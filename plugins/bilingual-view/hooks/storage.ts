import type { StorageIO } from './ports.ts';
import type { RecordEntry, State } from './state.ts';
import { diagnosticStatus } from './diagnostics.ts';

const PREFIX = 'bilingual-view.v1.';
export const CACHE_FILE_MAX_BYTES = 4 * 1024 * 1024;
export const outputWorkKey = (id: string): string => 'output:' + id;
export const memoryKey = (session: string, id: string): string => JSON.stringify([session, id]);
export type RecordReader = (id: string) => Promise<RecordEntry | null>;
export function cacheFilePath(session: string): string {
  if (!session) throw new Error('Missing cache session');
  return 'cache/' + encodeURIComponent(session) + '.json';
}

function validRecord(value: unknown): value is RecordEntry {
  if (!value || typeof value !== 'object') return false;
  const r = value as RecordEntry;
  return r.v === 1 && ['user', 'assistant', 'question', 'answer'].includes(r.kind) && typeof r.at === 'number'
    && (r.chineseSource === undefined || ['original', 'translation'].includes(r.chineseSource))
    && Array.isArray(r.blocks) && r.blocks.length <= 128 && r.blocks.every(b => b
      && typeof b.source === 'string' && typeof b.display === 'string'
      && ['ready', 'pending', 'error'].includes(b.status));
}

async function readFile(io: StorageIO, path: string): Promise<Record<string, unknown>> {
  if (!await io.cacheFiles.exists(path)) return {};
  const value: unknown = JSON.parse(await io.cacheFiles.read(path));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid cache file');
  return value as Record<string, unknown>;
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

/** Apply the limit to the complete JSON after an insertion, replacement or removal. */
function boundedJson(file: Record<string, unknown>): string {
  const serialized = JSON.stringify(file);
  let bytes = byteLength(serialized);
  if (bytes <= CACHE_FILE_MAX_BYTES) return serialized;
  const entries = Object.entries(file).sort(([, a], [, b]) =>
    (validRecord(a) ? a.at : 0) - (validRecord(b) ? b.at : 0));
  let count = entries.length;
  for (const [key, value] of entries) {
    if (bytes <= CACHE_FILE_MAX_BYTES) break;
    // Compact JSON consists of members separated by single-byte commas.
    bytes -= byteLength(JSON.stringify(key) + ':' + JSON.stringify(value)) + (count > 1 ? 1 : 0);
    delete file[key];
    count--;
  }
  return JSON.stringify(file);
}

/** Serialize this instance's file read/modify/write operations, including input saves. */
function updateFile(io: StorageIO, state: State, session: string, id: string, record: RecordEntry, completeOutput: boolean): Promise<void> {
  const update = state.cacheWrites.then(async () => {
    const path = cacheFilePath(session), key = PREFIX + id;
    // An unfit single record cannot be made to fit by evicting other records.
    const fits = byteLength(JSON.stringify({ [key]: record })) <= CACHE_FILE_MAX_BYTES;
    if (!fits) {
      if (record.kind === 'assistant') state.diagnostics.record('cache.write', session, id, 'too_large', {}, true);
      await io.toast('This display cache entry exceeds 4 MiB and was not saved to the session file.');
      if (!completeOutput) return;
    }
    const file = await readFile(io, path);
    if (fits) file[key] = record;
    // Replace work before bounding the file, so completion never counts twice.
    if (completeOutput) delete file[PREFIX + outputWorkKey(id)];
    await io.cacheFiles.write(path, boundedJson(file));
    if (fits && record.kind === 'assistant') state.diagnostics.record('cache.write', session, id, 'file_written',
      { cache: diagnosticStatus(record) }, true);
  });
  state.cacheWrites = update.catch(() => undefined);
  return update;
}

function rememberRecord(state: State, session: string, id: string, saved: unknown): RecordEntry | null {
  const key = memoryKey(session, id);
  // A missing disk entry does not invalidate a still-cached record.
  const record = validRecord(saved) ? saved : state.records.get(key) ?? null;
  state.records.set(key, record);
  return record;
}

/** Reuse one parsed session file for a batch of queries, never for writes. */
export function sessionRecordReader(io: StorageIO, state: State, session: string): RecordReader {
  let afterWrites: Promise<unknown> | undefined;
  let snapshot: Promise<Record<string, unknown>> | undefined;
  return async id => {
    for (;;) {
      const writes = state.cacheWrites;
      if (!snapshot || afterWrites !== writes) {
        afterWrites = writes;
        snapshot = writes.then(() => readFile(io, cacheFilePath(session)));
      }
      let file: Record<string, unknown> | undefined;
      try { file = await snapshot; }
      catch {
        if (writes !== state.cacheWrites) continue;
        state.diagnostics.record('cache.read', session, id, 'failed', {}, true);
      }
      // Task progress or an input save may write while this batch is reading.
      // Wait for that write and reload before returning an older record.
      if (writes !== state.cacheWrites) continue;
      return rememberRecord(state, session, id, file?.[PREFIX + id]);
    }
  };
}

export async function readRecord(io: StorageIO, state: State, session: string, id: string, fresh = false): Promise<RecordEntry | null> {
  const key = memoryKey(session, id);
  const cached = state.records.get(key);
  if (!fresh && cached !== undefined) return cached;
  let saved: unknown;
  try { saved = (await readFile(io, cacheFilePath(session)))[PREFIX + id]; } catch {
    state.diagnostics.record('cache.read', session, id, 'failed', {}, true);
    saved = null;
  }
  return rememberRecord(state, session, id, saved);
}

export async function saveRecord(io: StorageIO, state: State, session: string, id: string, record: RecordEntry,
  completeOutput = false): Promise<void> {
  if (completeOutput) state.records.delete(memoryKey(session, outputWorkKey(id)));
  state.records.set(memoryKey(session, id), record);
  try { await updateFile(io, state, session, id, record, completeOutput); }
  catch {
    if (record.kind === 'assistant') state.diagnostics.record('cache.write', session, id, 'failed', {}, true);
    await io.toast('The display cache could not be saved. It remains available in this session; resuming may show the original text.');
  }
}
