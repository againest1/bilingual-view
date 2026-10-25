import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { RuntimeIO } from '../hooks/ports.ts';
import { newState, newView } from '../hooks/state.ts';
import type { FinalAnswerRef } from '../hooks/state.ts';
import { cacheFilePath, outputWorkKey } from '../hooks/storage.ts';
import { displayRecord, ensureTranslation } from '../hooks/tasks.ts';

const source = readFileSync(new URL('./fixtures/shell-mode-answer.txt', import.meta.url), 'utf8');
const options = { base_url: 'https://translator.invalid/v1', model: 'offline-test' };
const ref: FinalAnswerRef = { kind: 'assistant', id: 'answer', session: 'offline-session', sources: [source] };
const savedKey = 'bilingual-view.v1.' + ref.id;
const workKey = 'bilingual-view.v1.' + outputWorkKey(ref.id);

function harness(repairSucceeds: boolean) {
  const state = newState();
  state.session = ref.session;
  state.view = newView(ref.session);
  state.view.finals.set(ref.id, ref);
  const files = new Map([[cacheFilePath(ref.session), JSON.stringify({ [workKey]: {
    v: 1, kind: 'assistant', at: 1, blocks: [{ source, display: '', status: 'error',
      error: 'The translator modified code or quoted placeholders. Retry or choose another translation model.' }],
  } })]]);
  const scheduled: Array<() => void | Promise<void>> = [];
  const requests: any[] = [];
  const io: RuntimeIO = {
    env: { baseUrl: async () => undefined, model: async () => undefined, apiKey: async () => undefined },
    cacheFiles: {
      exists: async path => files.has(path),
      read: async path => files.get(path)!,
      write: async (path, value) => { files.set(path, value); },
    },
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body!);
      requests.push(body);
      let text = body.messages[1].content;
      if (repairSucceeds && requests.length === 2) {
        text = text.replace('set BV_LITERAL_9_END in BV_LITERAL_10_END',
          '在 BV_LITERAL_10_END 中设置 BV_LITERAL_9_END');
      } else text = text.replace('BV_LITERAL_9_END', '');
      return { ok: true, status: 200,
        text: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: text } }] }) };
    },
    now: async () => 2, invalidate: () => {}, toast: () => {},
    after: (_ms, run) => { scheduled.push(run); },
    history: { read: async () => '', stat: async () => ({ size: 0, mtimeMs: 0 }) },
  };
  return { io, state, scheduled, requests, saved: () => JSON.parse(files.get(cacheFilePath(ref.session))!) };
}

test('Retry translation recovers a legacy failed record and saves only validated text', async () => {
  const h = harness(true);
  assert.equal((await ensureTranslation(h.io, h.state, options, ref)).status, 'failed');
  assert.equal(h.requests.length, 0);
  assert.equal((await ensureTranslation(h.io, h.state, options, ref, true)).status, 'queued');
  assert.equal(h.scheduled.length, 1);
  await h.scheduled.shift()!();
  assert.equal(h.requests.length, 2);
  const saved = h.saved();
  assert.ok(!Object.hasOwn(saved, workKey));
  assert.equal(saved[savedKey].blocks[0].source, source);
  assert.equal(saved[savedKey].blocks[0].status, 'ready');
  assert.match(saved[savedKey].blocks[0].display, /在 `settings\.json` 中设置 `"respondToBashCommands": false`/);
  assert.deepEqual(await displayRecord(h.io, h.state, ref), saved[savedKey]);
  assert.equal((await ensureTranslation(h.io, h.state, options, ref)).status, 'ready');
  assert.equal(h.scheduled.length, 0);
});

test('failed correction keeps the original readable and persists the specific error without looping', async () => {
  const h = harness(false);
  await ensureTranslation(h.io, h.state, options, ref, true);
  await h.scheduled.shift()!();
  const saved = h.saved();
  assert.ok(!Object.hasOwn(saved, savedKey));
  assert.equal(saved[workKey].blocks[0].source, source);
  assert.equal(saved[workKey].blocks[0].display, '');
  assert.equal(saved[workKey].blocks[0].status, 'error');
  assert.match(saved[workKey].blocks[0].error, /missing BV_LITERAL_9_END/);
  assert.equal(h.requests.length, 2);
  assert.equal(h.state.output.jobs.size, 0);
  assert.equal((await ensureTranslation(h.io, h.state, options, ref)).status, 'failed');
  assert.equal(h.scheduled.length, 0);
});
