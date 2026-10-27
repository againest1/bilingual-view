import type { RecordEntry } from './state.ts';

export const DIAGNOSTIC_MAX_EVENTS = 128;
export const DIAGNOSTIC_EVENT_BYTES = 32 * 1024;
export const DIAGNOSTIC_FILE_BYTES = 64 * 1024;
export const DIAGNOSTIC_FILE = 'diagnostics.json';

type Event = 'session.start' | 'session.end' | 'session.history' | 'history' | 'final'
  | 'translation' | 'redraw' | 'render.enter' | 'render.prepare' | 'render.result'
  | 'cache.read' | 'cache.write' | 'visible';
type CacheStatus = 'missing' | 'pending' | 'error' | 'ready';
type Detail = {
  view?: string; cache?: CacheStatus; count?: number; surface?: string;
  visibility?: 'visible' | 'hidden' | 'unknown';
};
type Entry = Detail & { event: Event; session: string; id: string; status: string; seq: number; ms: number };
const idLimit = (id: string): string => id.slice(0, 96);
const byteLength = (text: string): number => new TextEncoder().encode(text).length;

export function diagnosticStatus(record: Pick<RecordEntry, 'blocks'> | null | undefined): CacheStatus {
  if (!record?.blocks.length) return 'missing';
  if (record.blocks.some(block => block.status === 'error')) return 'error';
  return record.blocks.every(block => block.status === 'ready') ? 'ready' : 'pending';
}

/** Metadata only: no IO, timers, message text, provider details or raw errors. */
export class Diagnostics {
  private readonly started = performance.now();
  private readonly entries: Array<{ value: Entry; bytes: number }> = [];
  private readonly lastStates = new Map<string, string>();
  private bytes = 0;
  private sequence = 0;
  private dropped = 0;

  get size(): number { return this.entries.length; }
  get byteSize(): number { return this.bytes; }
  get trackedSize(): number { return this.lastStates.size; }

  record(event: Event, session: string, id: string, status: string, detail: Detail = {}, changesOnly = false): void {
    // Copy an explicit, bounded set of fields; never retain a caller's object.
    const fields = { event, session: idLimit(session), id: idLimit(id), status: status.slice(0, 48),
      ...(detail.view !== undefined ? { view: idLimit(detail.view) } : {}),
      ...(detail.cache !== undefined ? { cache: detail.cache } : {}),
      ...(detail.count !== undefined ? { count: Math.min(1_000_000, Math.max(0, Math.trunc(detail.count))) } : {}),
      ...(detail.surface !== undefined ? { surface: detail.surface.slice(0, 16) } : {}),
      ...(detail.visibility !== undefined ? { visibility: detail.visibility } : {}),
    };
    if (changesOnly) {
      const key = JSON.stringify([event, fields.session, fields.id]);
      const value = JSON.stringify(fields), previous = this.lastStates.get(key);
      this.lastStates.delete(key);
      this.lastStates.set(key, value);
      if (this.lastStates.size > DIAGNOSTIC_MAX_EVENTS) this.lastStates.delete(this.lastStates.keys().next().value!);
      if (previous === value) return;
    }
    const value: Entry = { seq: ++this.sequence, ms: Math.round(performance.now() - this.started), ...fields };
    const bytes = byteLength(JSON.stringify(value));
    this.entries.push({ value, bytes });
    this.bytes += bytes;
    while (this.entries.length > DIAGNOSTIC_MAX_EVENTS || this.bytes > DIAGNOSTIC_EVENT_BYTES) {
      this.bytes -= this.entries.shift()!.bytes;
      this.dropped++;
    }
  }

  /** Called only for a manual export; its one file is overwritten, never appended. */
  snapshot(session: string, exportedAt: number): string {
    const result = JSON.stringify({ v: 1, session: idLimit(session), exportedAt,
      elapsedMs: Math.round(performance.now() - this.started), dropped: this.dropped,
      events: this.entries.map(entry => entry.value) });
    // The event payload cap leaves ample room for the fixed snapshot metadata.
    if (byteLength(result) > DIAGNOSTIC_FILE_BYTES) throw new Error('Diagnostic snapshot exceeds its size limit.');
    return result;
  }
}
