import type { PluginOptions } from 'claude-code';
import type { RuntimeIO } from './ports.ts';
import type { DisplayMessageRef, DisplayTask, MessageIdentity, SessionMessageRef, RecordEntry, State } from './state.ts';
import { translate } from './translation.ts';
import { clearOutputWork, memoryKey, outputWorkKey, readRecord, saveRecord } from './storage.ts';
import { referenceFor, refreshHistory } from './history.ts';
import { needsDisplayTranslation, needsTranslation } from './text.ts';
import { diagnosticStatus } from './diagnostics.ts';

/** Shared user/assistant display queue, including the one currently running. */
export const MAX_OUTPUT_TASKS = 32;
export type EnsureResult = { status: 'ready' | 'skipped' | 'queued' | 'running' | 'failed' | 'deferred' | 'obsolete'; record?: RecordEntry };

// The UUID selects the stored entry; only its role remains to be checked.
function matchesRole(record: RecordEntry | null | undefined, kind: MessageIdentity['kind']): record is RecordEntry {
  return record?.kind === kind;
}
export function ready(record: RecordEntry | null | undefined): boolean {
  return !!record?.blocks.length && record.blocks.every(block => block.status === 'ready');
}
function sameMessage(a: MessageIdentity, b: MessageIdentity): boolean {
  return a.kind === b.kind && a.id === b.id;
}

export async function displayRecord(io: RuntimeIO, state: State, ref: SessionMessageRef, fresh = false): Promise<RecordEntry | null> {
  const result = await readRecord(io, state, ref.session, ref.id, fresh);
  if (matchesRole(result, ref.kind) && ready(result)) return result;
  const local = state.output.jobs.get(memoryKey(ref.session, ref.id));
  if (local && sameMessage(local.ref, ref)) return local.record;
  const work = await readRecord(io, state, ref.session, outputWorkKey(ref.id), fresh);
  if (matchesRole(work, ref.kind)) return work;
  return matchesRole(result, ref.kind) ? result : null; // v0.1.x pending/error records
}

/** All producers use this entry. Admission is serialized; HTTP is not awaited here. */
export function ensureTranslation(io: RuntimeIO, state: State, options: PluginOptions, ref: DisplayMessageRef,
  retry = false, canAdmit: () => boolean = () => true): Promise<EnsureResult> {
  const admit = state.output.admission.then(async (): Promise<EnsureResult> => {
    const result = await readRecord(io, state, ref.session, ref.id, true);
    if (matchesRole(result, ref.kind) && ready(result)) return { status: 'ready', record: result };
    const key = memoryKey(ref.session, ref.id);
    const local = state.output.jobs.get(key);
    if (local) return sameMessage(local.ref, ref) ? { status: local.status, record: local.record } : { status: 'obsolete' };
    const work = await readRecord(io, state, ref.session, outputWorkKey(ref.id), true);
    const previous = matchesRole(work, ref.kind) ? work : matchesRole(result, ref.kind) ? result : null;
    if (previous && ready(previous)) return { status: 'ready', record: previous };
    const sources = previous ? previous.blocks.map(block => block.source) : ref.sources;
    // Reuse saved results and accepted tasks first. A local skip creates no
    // job, timer or disk record. Dialog fields keep their own translation rule.
    const needsChinese = ref.kind === 'question'
      ? needsTranslation(sources.join('\n\n'), 'zh') : needsDisplayTranslation(sources.join('\n\n'));
    if (!needsChinese) return { status: 'skipped', ...(previous ? { record: previous } : {}) };
    if (!retry && previous?.blocks.some(b => b.status === 'error')) return { status: 'failed', record: previous };
    if (!canAdmit()) return { status: 'obsolete' };
    if (state.output.jobs.size >= MAX_OUTPUT_TASKS) return { status: 'deferred' };
    const record: RecordEntry = {
      v: 1, kind: ref.kind, at: await io.now(),
      ...(ref.kind === 'user' ? { chineseSource: previous ? previous.chineseSource : 'translation' as const } : {}),
      blocks: sources.map((source, i) => previous?.blocks[i]?.status === 'ready'
        ? { ...previous.blocks[i]! } : { source, display: '', status: 'pending' }),
    };
    if (!canAdmit()) return { status: 'obsolete' };
    const task: DisplayTask = { ref: { id: ref.id, kind: ref.kind, session: ref.session }, record, status: 'queued', io, options };
    state.output.jobs.set(key, task);
    state.output.queue.push(task);
    await saveRecord(io, state, ref.session, outputWorkKey(ref.id), record);
    if (ref.kind === 'assistant') state.diagnostics.record('translation', ref.session, ref.id, 'queued', { count: sources.length });
    schedule(state);
    return { status: 'queued', record };
  });
  state.output.admission = admit.catch(() => undefined);
  return admit;
}

function schedule(state: State): void {
  if (state.output.running || state.output.scheduled || !state.output.queue.length) return;
  state.output.scheduled = true;
  state.output.queue[0]!.io.after(0, () => runNext(state));
}

function redraw(state: State, task: DisplayTask): void {
  if (task.ref.kind === 'assistant') state.diagnostics.record('redraw', task.ref.session, task.ref.id,
    state.view.session !== task.ref.session ? 'different_session'
      : state.view.finals.has(task.ref.id) ? 'requested' : 'no_final_reference',
    { view: state.view.session, cache: diagnosticStatus(task.record) }, true);
  if (state.view.session !== task.ref.session) return;
  if (task.ref.kind !== 'assistant') {
    const current = state.view.visible.get(task.ref.id);
    if (current?.kind === task.ref.kind) task.io.invalidate();
  } else {
    const current = state.view.finals.get(task.ref.id);
    if (current && sameMessage(current, task.ref)) task.io.invalidate();
  }
}

async function runNext(state: State): Promise<void> {
  state.output.scheduled = false;
  if (state.output.running) return;
  const task = state.output.queue.shift();
  if (!task) return;
  state.output.running = true;
  task.status = 'running';
  if (task.ref.kind === 'assistant') state.diagnostics.record('translation', task.ref.session, task.ref.id, 'running');
  redraw(state, task);
  try {
    await execute(state, task);
  } catch {
    for (const block of task.record.blocks) if (block.status === 'pending') {
      block.status = 'error';
      block.error = task.ref.kind === 'assistant' ? 'Output translation did not finish. Please retry.' : 'Display translation did not finish. Please retry.';
    }
    await saveRecord(task.io, state, task.ref.session, outputWorkKey(task.ref.id), task.record).catch(() => undefined);
  } finally {
    if (task.ref.kind === 'assistant') state.diagnostics.record('translation', task.ref.session, task.ref.id,
      diagnosticStatus(task.record), { count: task.record.blocks.length });
    state.output.jobs.delete(memoryKey(task.ref.session, task.ref.id));
    state.output.running = false;
    redraw(state, task);
    schedule(state);
  }
}

async function execute(state: State, task: DisplayTask): Promise<void> {
  const { io, ref, options } = task;
  for (const block of task.record.blocks) {
    // Recheck immediately before work. Another CLI may have finished while
    // this message waited. This is result reuse, not a cross-process lock.
    const shared = await readRecord(io, state, ref.session, ref.id, true);
    if (matchesRole(shared, ref.kind) && ready(shared)) { task.record = shared; return; }
    if (block.status === 'ready') continue;
    try {
      block.display = await translate(io, options, block.source, 'zh');
      block.status = 'ready';
      delete block.error;
    } catch (error) {
      block.status = 'error';
      block.error = error instanceof Error ? error.message : 'Translation failed. Please retry.';
    }
    task.record.at = await io.now();
    await saveRecord(io, state, ref.session, outputWorkKey(ref.id), task.record);
    redraw(state, task);
  }
  const shared = await readRecord(io, state, ref.session, ref.id, true);
  if (matchesRole(shared, ref.kind) && ready(shared)) { task.record = shared; return; }
  if (ready(task.record)) {
    await saveRecord(io, state, ref.session, ref.id, task.record);
    await clearOutputWork(io, state, ref.session, ref.id);
  }
}

/** One coalesced check for visible rows lacking a valid result. */
export async function pollVisible(io: RuntimeIO, state: State, options: PluginOptions): Promise<void> {
  if (state.polling) return;
  state.polling = true;
  const view = state.view;
  try {
    if (!view.visible.size) return;
    if ([...view.visible.values()].some(item => item.kind === 'assistant')) await refreshHistory(io, state, view);
    for (const [id, item] of [...view.visible]) {
      if (state.view !== view) return;
      const ref: DisplayMessageRef | undefined = item.kind === 'assistant'
        ? await referenceFor(io, state, view, id, true)
        : { kind: item.kind, id, sources: [item.text], session: view.session };
      const stillVisible = () => state.view === view && view.visible.get(id)?.kind === item.kind;
      if (!ref || !stillVisible()) continue;
      // ensureTranslation already checks the shared completed result before
      // admitting work. Reuse that result instead of reading it twice.
      const result = await ensureTranslation(io, state, options, ref, false, stillVisible);
      if (state.view !== view) return;
      if (!stillVisible()) continue;
      if (result.status === 'ready' || result.status === 'skipped') {
        if (item.kind === 'assistant') state.diagnostics.record('visible', view.session, id, result.status, {}, true);
        view.visible.delete(id);
        io.invalidate();
      } else if (result.status !== 'deferred' && result.status !== 'obsolete') io.invalidate();
    }
  } finally { state.polling = false; }
}
