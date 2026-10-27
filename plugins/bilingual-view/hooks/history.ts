import type { RuntimeIO } from './ports.ts';
import type { FinalAnswerRef, State, View } from './state.ts';
import { outputWorkKey, readRecord } from './storage.ts';
import type { RecordReader } from './storage.ts';

/** Identify final answers from request structure and completed-turn markers. */
export function indexFinalAnswers(jsonl: string): Map<string, FinalAnswerRef> {
  const rows: any[] = [];
  const lines = jsonl.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.trim()) continue;
    try { const row = JSON.parse(lines[i]!); if (row && typeof row === 'object') rows.push(row); }
    catch { if (i === lines.length - 1) break; return new Map(); }
  }
  const byId = new Map<string, any>(), groups = new Map<string, any[]>();
  const interrupted = new Set<string>();
  const requestKey = (row: any) => row.requestRef + '\u0000' + row.message.id;
  for (const row of rows) {
    if (row.interruptedMessageId) interrupted.add(row.interruptedMessageId);
    if (typeof row.uuid === 'string') byId.set(row.uuid, row);
  }
  for (const row of byId.values()) {
    if (row.type !== 'assistant' || row.isSidechain !== false || !row.requestRef || !row.message?.id) continue;
    const key = requestKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  const refs = new Map<string, FinalAnswerRef>();
  for (const footer of rows) {
    if (footer.type !== 'system' || footer.subtype !== 'turn_duration' || footer.isSidechain !== false) continue;
    let current = footer.parentUuid, last: any = null;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const row = byId.get(current);
      if (!row || row.isSidechain !== false) break;
      if (row.type === 'assistant') { last = row; break; }
      if (!['attachment', 'progress'].includes(row.type)) break;
      current = row.parentUuid;
    }
    if (!last?.requestRef || !last.message?.id) continue;
    const group = groups.get(requestKey(last));
    if (!group || interrupted.has(last.message.id)) continue;
    group.sort((a, b) => a.apiBlockIndex - b.apiBlockIndex);
    if (group.some((row, i) => row.apiBlockIndex !== i
      || row.message.stop_reason !== 'end_turn' || row.isMeta || row.isCompactSummary || row.isVisibleInTranscriptOnly || row.isApiErrorMessage
      || !Array.isArray(row.message.content) || row.message.content.some((b: any) => ['tool_use', 'tool_result', 'server_tool_use'].includes(b.type)))) continue;
    for (const row of group) {
      const sources: string[] = row.message.content.filter((b: any) => b.type === 'text' && typeof b.text === 'string').map((b: any) => b.text);
      if (sources.length) refs.set(row.uuid, { kind: 'assistant', id: row.uuid, sources, session: row.sessionId || '' });
    }
  }
  return refs;
}

/** Only the exact currently opened transcript path supplied by Claude is read. */
export async function refreshHistory(io: RuntimeIO, state: State, view: View): Promise<void> {
  if (!view.path || view.loadingHistory || state.view !== view) return;
  view.loadingHistory = true;
  try {
    const stat = await io.history.stat(view.path);
    const stamp = stat.size + ':' + stat.mtimeMs;
    if (stamp === view.historyStamp) return;
    if (stat.size > 4 * 1024 * 1024) {
      state.diagnostics.record('history', view.session, '', 'too_large', {}, true);
      return;
    }
    const jsonl = await io.history.read(view.path);
    if (state.view !== view) return;
    const refs = indexFinalAnswers(jsonl);
    let added = false;
    for (const [id, ref] of refs) if (!view.finals.has(id)) {
      view.finals.set(id, { ...ref, session: view.session });
      added = true;
    }
    view.historyStamp = stamp;
    state.diagnostics.record('history', view.session, '', 'indexed', { count: refs.size }, true);
    if (added) io.invalidate();
  } catch {
    state.diagnostics.record('history', view.session, '', 'read_failed', {}, true);
    // A missing, oversized or unreadable history is not permission to guess.
  } finally { view.loadingHistory = false; }
}

/** Existing final-only display records also provide evidence after a restart. */
export async function referenceFor(io: RuntimeIO, state: State, view: View, id: string,
  fresh = false, read: RecordReader = key => readRecord(io, state, view.session, key, fresh)): Promise<FinalAnswerRef | undefined> {
  const known = view.finals.get(id);
  if (known) return known;
  for (const key of [id, outputWorkKey(id)]) {
    const record = await read(key);
    if (state.view !== view) return;
    if (record?.kind === 'assistant') {
      const ref: FinalAnswerRef = { kind: 'assistant', id, sources: record.blocks.map(b => b.source), session: view.session };
      view.finals.set(id, ref);
      return ref;
    }
  }
}
