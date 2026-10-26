import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EngineInterface } from 'claude-code';
import { hostIO } from '../hooks/register.ts';
import { newState } from '../hooks/state.ts';
import type { RecordEntry } from '../hooks/state.ts';
import { readRecord, saveRecord } from '../hooks/storage.ts';

const userRecord: RecordEntry = {
  v: 1, kind: 'user', at: 1, chineseSource: 'original',
  blocks: [{ source: 'Summarize the changes.', display: '总结一下修改。', status: 'ready' }],
};
const assistantRecord: RecordEntry = {
  v: 1, kind: 'assistant', at: 2,
  blocks: [{ source: 'The change is ready.', display: '修改已完成。', status: 'ready' }],
};

function host(root: string, files: Map<string, string>, env: Record<string, string>) {
  const notices: string[] = [];
  const engine = {
    plugin: { name: 'bilingual-view', root },
    env: { get: async (name: string) => env[name] },
    fs: {
      exists: async (path: string) => files.has(path),
      read: async (path: string) => {
        assert.ok(files.has(path), `Missing mock file: ${path}`);
        return files.get(path)!;
      },
      write: async (path: string, text: string) => { files.set(path, text); },
    },
    ui: { toast: async (text: string) => { notices.push(text); } },
  } as unknown as EngineInterface;
  return { io: hostIO(engine), notices };
}

test('Chinese originals and translations survive marketplace updates and a different installation directory', async () => {
  const files = new Map<string, string>();
  const env = { HOME: '/home/offline' };
  const marketplaceRoot = '/home/offline/.claude/plugins/cache/bilingual-view/bilingual-view';
  const first = host(marketplaceRoot + '/commit-a', files, env);
  const state = newState();
  await saveRecord(first.io, state, 'session-a', 'user-1', userRecord);
  await saveRecord(first.io, state, 'session-a', 'assistant-1', assistantRecord);

  for (const root of [marketplaceRoot + '/commit-b', '/home/offline/.claude/skills/bilingual-view']) {
    const reloaded = host(root, files, env);
    const freshState = newState();
    assert.deepEqual(await readRecord(reloaded.io, freshState, 'session-a', 'user-1'), userRecord);
    assert.deepEqual(await readRecord(reloaded.io, freshState, 'session-a', 'assistant-1'), assistantRecord);
    await saveRecord(reloaded.io, freshState, 'session-a', 'assistant-2', assistantRecord);
    assert.deepEqual(await readRecord(first.io, newState(), 'session-a', 'assistant-2'), assistantRecord);
    assert.deepEqual(reloaded.notices, []);
  }
  assert.deepEqual([...files.keys()], ['/home/offline/.claude/bilingual-view/cache/session-a.json']);
  assert.deepEqual(first.notices, []);
});

test('the fixed cache ignores alternate Claude directories and keeps users and sessions separate', async () => {
  const files = new Map<string, string>();
  const first = host('/plugins/bilingual-view', files, {
    HOME: '/home/first', CLAUDE_CONFIG_DIR: '/alternate/claude', CLAUDE_PLUGIN_DATA: '/alternate/data',
  });
  const second = host('/plugins/bilingual-view', files, { HOME: '/home/second' });
  await saveRecord(first.io, newState(), 'session-a', 'user-1', userRecord);
  assert.equal(await readRecord(first.io, newState(), 'session-b', 'user-1'), null);
  assert.equal(await readRecord(second.io, newState(), 'session-a', 'user-1'), null);
  assert.deepEqual([...files.keys()], ['/home/first/.claude/bilingual-view/cache/session-a.json']);
});

test('USERPROFILE supplies the home directory when HOME is unavailable', async () => {
  const files = new Map<string, string>();
  const h = host('C:/plugins/bilingual-view', files, { USERPROFILE: 'C:/Users/offline' });
  await saveRecord(h.io, newState(), 'session-a', 'user-1', userRecord);
  assert.deepEqual([...files.keys()], ['C:/Users/offline/.claude/bilingual-view/cache/session-a.json']);
  assert.deepEqual(await readRecord(h.io, newState(), 'session-a', 'user-1'), userRecord);
});

test('a missing home directory reports the save failure and keeps the record in memory', async () => {
  const files = new Map<string, string>();
  const h = host('/plugins/bilingual-view', files, {});
  const state = newState();
  await saveRecord(h.io, state, 'session-a', 'user-1', userRecord);
  assert.equal(files.size, 0);
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0]!, /cache could not be saved/);
  assert.deepEqual(await readRecord(h.io, state, 'session-a', 'user-1'), userRecord);
});
