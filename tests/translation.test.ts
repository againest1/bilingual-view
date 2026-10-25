import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { protectText, restoreText, splitText } from '../hooks/text.ts';
import { translate } from '../hooks/translation.ts';
import type { TranslationIO } from '../hooks/ports.ts';

// The source is from the reported shell-mode answer. The failed provider
// responses were not saved; all responses below are explicit offline simulations.
const shellAnswer = readFileSync(new URL('./fixtures/shell-mode-answer.txt', import.meta.url), 'utf8');
const options = { base_url: 'https://translator.invalid/v1', model: 'offline-test' };
const completion = (text: string) => ({ ok: true, status: 200,
  text: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: text } }] }) });

function fakeTranslator(respond: (body: any, call: number) => ReturnType<typeof completion>): {
  io: TranslationIO; requests: any[];
} {
  const requests: any[] = [];
  return { requests, io: {
    env: { baseUrl: async () => undefined, model: async () => undefined, apiKey: async () => undefined },
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body!);
      requests.push(body);
      return respond(body, requests.length);
    },
  } };
}

const originalText = (body: any): string => body.messages[1].content;
function chineseSettingsClause(text: string): string {
  return text.replace('set BV_LITERAL_9_END in BV_LITERAL_10_END',
    '在 BV_LITERAL_10_END 中设置 BV_LITERAL_9_END');
}

test('the real shell-mode answer fits one request and round-trips all 29 literals', () => {
  const protectedText = protectText(shellAnswer);
  assert.equal(protectedText.values.length, 29);
  assert.equal(splitText(protectedText.text).length, 1);
  assert.equal(restoreText(protectedText.text, protectedText), shellAnswer);
});

test('shell-mode case: natural Chinese settings order preserves both code literals', async () => {
  const { io, requests } = fakeTranslator(body => completion(chineseSettingsClause(originalText(body))));
  const result = await translate(io, options, shellAnswer, 'zh');
  assert.match(result, /在 `settings\.json` 中设置 `"respondToBashCommands": false`/);
  assert.ok(result.includes('```\n! git status\n! npm test\n! ls -la\n```'));
  assert.ok(result.includes('https://code.claude.com/docs/en/interactive-mode.'));
  assert.equal(requests.length, 1);
});

test('Chinese input permits the corresponding English word order without changing literals', async () => {
  const { io } = fakeTranslator(() => completion('Set BV_LITERAL_1_END in BV_LITERAL_0_END.'));
  const result = await translate(io, options, '在 `配置.json` 中设置 `enabled`。', 'en');
  assert.equal(result, 'Set `enabled` in `配置.json`.');
});

test('escaped pipes are prose rather than table-cell boundaries', () => {
  const protectedText = protectText('Use `first` \\| `second`.');
  assert.equal(restoreText('使用 BV_LITERAL_1_END \\| BV_LITERAL_0_END。', protectedText),
    '使用 `second` \\| `first`。');
});

test('literal reordering also works when the source already contains token-looking text', () => {
  const protectedText = protectText('Set `enabled` in `BV_LITERAL_0_END`.');
  assert.equal(restoreText('在 _BV_LITERAL_1_END 中设置 _BV_LITERAL_0_END。', protectedText),
    '在 `BV_LITERAL_0_END` 中设置 `enabled`。');
});

test('identical literal values are still separate occurrences that cannot be deduplicated', () => {
  const protectedText = protectText('Run `same`, then run `same` again.');
  assert.throws(() => restoreText('运行 BV_LITERAL_0_END 两次。', protectedText), /missing BV_LITERAL_1_END/);
});

for (const [name, source, response] of [
  ['paragraphs', 'Use `first`.\n\nThen use `second`.', '使用 BV_LITERAL_1_END。\n\n然后使用 BV_LITERAL_0_END。'],
  ['list items', '- Run `first`.\n- Run `second`.', '- 运行 BV_LITERAL_1_END。\n- 运行 BV_LITERAL_0_END。'],
  ['table cells', '| Set `first` | Read `second` |', '| 设置 BV_LITERAL_1_END | 读取 BV_LITERAL_0_END |'],
  ['code blocks', 'Before `first`.\n\n```sh\necho second\n```', '之前 BV_LITERAL_1_END。\n\nBV_LITERAL_0_END'],
]) {
  test(`literal reordering cannot move content between ${name}`, () => {
    assert.throws(() => restoreText(response!, protectText(source!)), /between lines or table cells/);
  });
}

for (const [name, response, diagnostic] of [
  ['missing', '使用 BV_LITERAL_0_END。', /missing BV_LITERAL_1_END/],
  ['duplicated', 'BV_LITERAL_0_END BV_LITERAL_1_END BV_LITERAL_1_END', /duplicated BV_LITERAL_1_END/],
  ['unknown', 'BV_LITERAL_0_END BV_LITERAL_1_END BV_LITERAL_29_END', /unknown BV_LITERAL_29_END/],
  ['malformed', 'BV_LITERAL_0_END BV_LITERAL_01_END', /missing BV_LITERAL_1_END.*unknown BV_LITERAL_01_END/],
]) {
  test(`${name} placeholders fail with a specific diagnostic`, () => {
    assert.throws(() => restoreText(response as string, protectText('Use `first` and `second`.')), diagnostic as RegExp);
  });
}

test('one failed chunk gets a correction request containing the actual validation feedback', async () => {
  const { io, requests } = fakeTranslator((body, call) => completion(call === 1
    ? originalText(body).replace('BV_LITERAL_9_END', '') : chineseSettingsClause(originalText(body))));
  const result = await translate(io, options, shellAnswer, 'zh');
  assert.match(result, /在 `settings\.json` 中设置 `"respondToBashCommands": false`/);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].messages[1].content, requests[0].messages[1].content);
  assert.equal(requests[1].messages[2].role, 'assistant');
  assert.equal(requests[1].messages[2].content, originalText(requests[0]).replace('BV_LITERAL_9_END', ''));
  assert.match(requests[1].messages[3].content, /missing BV_LITERAL_9_END/);
});

test('persistent corruption stops after one correction and reports the remaining problem', async () => {
  const { io, requests } = fakeTranslator(body => completion(originalText(body).replace('BV_LITERAL_9_END', '')));
  await assert.rejects(translate(io, options, shellAnswer, 'zh'), /missing BV_LITERAL_9_END/);
  assert.equal(requests.length, 2);
});

test('a later chunk failure does not request already validated chunks again', async () => {
  const source = 'Read this introductory explanation. '.repeat(100) + '\n\nSet `enabled` in `settings.json`.';
  let failed = false;
  const { io, requests } = fakeTranslator(body => {
    const text = originalText(body);
    if (text.includes('BV_LITERAL_0_END') && !failed) {
      failed = true;
      return completion(text.replace('BV_LITERAL_0_END', ''));
    }
    return completion(text);
  });
  assert.equal(await translate(io, options, source, 'zh'), source);
  const chunks = splitText(protectText(source).text);
  assert.equal(requests.length, chunks.length + 1);
  assert.equal(requests.filter(body => originalText(body) === chunks[0]!.trim()).length, 1);
});

test('cancellation after an invalid response prevents the correction request', async () => {
  const controller = new AbortController();
  const { io, requests } = fakeTranslator(() => {
    controller.abort();
    return completion('没有占位符');
  });
  await assert.rejects(translate(io, options, shellAnswer, 'zh', controller.signal), /canceled/);
  assert.equal(requests.length, 1);
});

for (const [name, response, diagnostic] of [
  ['HTTP failure', { ok: false, status: 401, text: '' }, /HTTP 401/],
  ['invalid JSON', { ok: true, status: 200, text: 'invalid' }, /valid JSON/],
  ['truncation', { ok: true, status: 200, text: JSON.stringify({ choices: [{ finish_reason: 'length' }] }) }, /incomplete/],
]) {
  test(`${name} does not trigger a placeholder correction`, async () => {
    const { io, requests } = fakeTranslator(() => response as ReturnType<typeof completion>);
    await assert.rejects(translate(io, options, shellAnswer, 'zh'), diagnostic as RegExp);
    assert.equal(requests.length, 1);
  });
}

test('whitespace, protected source tokens and already-Chinese messages remain intact', async () => {
  const { io, requests } = fakeTranslator(body => completion(originalText(body)));
  const source = '  Read `BV_LITERAL_0_END` and `other`.  \n';
  assert.equal(await translate(io, options, source, 'zh'), source);
  assert.equal(await translate(io, options, '已经是中文。', 'zh'), '已经是中文。');
  assert.equal(requests.length, 1);
});
