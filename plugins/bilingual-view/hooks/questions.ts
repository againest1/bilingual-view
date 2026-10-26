import type { PluginOptions } from 'claude-code';
import type { TranslationIO } from './ports.ts';
import type { RecordEntry } from './state.ts';
import { needsTranslation } from './text.ts';
import { translate } from './translation.ts';

export type Question = {
  question: string; header?: string; description?: string; placeholder?: string;
  kind?: string; multiSelect?: boolean;
  options?: { label: string; description?: string; [key: string]: unknown }[];
  [key: string]: unknown;
};
export type QuestionResult = {
  questions?: Question[]; answers?: Record<string, string>; response?: string;
  annotations?: Record<string, unknown>; [key: string]: unknown;
};
export const questionId = (id: string): string => 'question:' + id;
export const answerId = (id: string): string => 'answer:' + id;

function fields(questions: Question[]): string[] {
  return questions.flatMap(q => [q.question, q.header ?? '', q.description ?? '', q.placeholder ?? '',
    ...(q.options ?? []).flatMap(o => [o.label, o.description ?? ''])]);
}

/** One short request per dialog, with field markers protected by the existing translator. */
export function questionSource(questions: Question[]): string {
  const texts = fields(questions);
  let prefix = 'BV_QUESTION_';
  while (texts.some(text => text.includes(prefix))) prefix = '_' + prefix;
  return texts.map((text, i) => '`' + prefix + i + '_END`\n' + text).join('\n\n');
}

function translatedFields(record?: RecordEntry | null): string[] {
  const block = record?.kind === 'question' ? record.blocks[0] : undefined;
  if (!block || block.status !== 'ready') return [];
  // Positions describe fields of this tool call, never message identity or assistant blocks.
  const prefix = block.source.match(/^`(_*BV_QUESTION_)0_END`/)?.[1];
  return prefix ? block.display.split(new RegExp('`' + prefix + '\\d+_END`\\s*\\n?')).slice(1).map(text => text.trim()) : [];
}

export function drawQuestions(questions: Question[], record?: RecordEntry | null): Question[] {
  const texts = translatedFields(record);
  if (!texts.length) return questions;
  let index = 0;
  const take = (source: string) => texts[index++] || source;
  return questions.map(q => {
    const question = take(q.question), header = take(q.header ?? '');
    const description = take(q.description ?? ''), placeholder = take(q.placeholder ?? '');
    const options = q.options?.map(o => {
      const label = take(o.label), detail = take(o.description ?? '');
      // Labels are the actual selected answers. Their Chinese lives in the description.
      return { ...o, description: [label !== o.label ? label : '', detail].filter(Boolean).join(' \u00b7 ') };
    });
    return { ...q, question,
      ...(q.header !== undefined ? { header: header.length <= 12 ? header : q.header } : {}),
      ...(q.description !== undefined ? { description } : {}),
      ...(q.placeholder !== undefined ? { placeholder } : {}),
      ...(options ? { options } : {}),
    };
  });
}

function typedStart(question: Question | undefined, value: string): number {
  const labels = (question?.options?.map(o => o.label) ?? []).sort((a, b) => b.length - a.length);
  if (labels.includes(value)) return value.length;
  if (!question?.multiSelect) return 0;
  // The host joins selected labels first, then the typed Other answer. Keep
  // that prefix byte-for-byte; a label may itself contain the comma separator.
  let start = 0;
  while (start < value.length) {
    const rest = value.slice(start);
    const label = labels.find(item => rest === item || rest.startsWith(item + ', '));
    if (label === undefined) break;
    start += label.length + (rest === label ? 0 : 2);
  }
  return start;
}

/** Input translation is independent of the background display queue. */
export async function translateAnswers(io: TranslationIO, options: PluginOptions, questions: Question[],
  result: QuestionResult, previous: RecordEntry | null, signal?: AbortSignal): Promise<{ result: QuestionResult; record?: RecordEntry }> {
  const out = { ...result, ...(result.answers ? { answers: { ...result.answers } } : {}) };
  const blocks: RecordEntry['blocks'] = [], keys: string[] = [];
  const change = async (key: string, value: string, start = 0): Promise<string> => {
    const index = previous?.kind === 'answer' ? previous.fields?.indexOf(key) ?? -1 : -1;
    if (index >= 0 && previous?.blocks[index]?.status === 'ready') {
      keys.push(key); blocks.push(previous.blocks[index]!); return previous.blocks[index]!.source;
    }
    const typed = value.slice(start);
    if (!needsTranslation(typed, 'en')) return value;
    const sent = value.slice(0, start) + await translate(io, options, typed, 'en', signal);
    keys.push(key); blocks.push({ source: sent, display: value, status: 'ready' });
    return sent;
  };
  for (const [key, value] of Object.entries(result.answers ?? {})) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const start = typedStart(questions.find(q => q.question === key), value);
    if (start === value.length) continue;
    out.answers![key] = await change('answer:' + key, value, start);
  }
  if (typeof result.response === 'string' && result.response.trim()) out.response = await change('response', result.response);
  return { result: out, ...(blocks.length ? { record: { v: 1, kind: 'answer', at: 0, blocks, fields: keys } as RecordEntry } : {}) };
}

export function drawQuestionResult(result: QuestionResult, questions: Question[], translated?: RecordEntry | null,
  answer?: RecordEntry | null): QuestionResult {
  const drawn = drawQuestions(questions, translated);
  const questionName = (key: string) => drawn[questions.findIndex(q => q.question === key)]?.question ?? key;
  const original = (key: string, value: string) => {
    const index = answer?.kind === 'answer' ? answer.fields?.indexOf(key) ?? -1 : -1;
    return index >= 0 ? answer!.blocks[index]?.display ?? value : value;
  };
  return { ...result,
    ...(Array.isArray(result.questions) ? { questions: drawn } : {}),
    ...(result.answers ? { answers: Object.fromEntries(Object.entries(result.answers).map(([key, value]) =>
      [questionName(key), original('answer:' + key, value)])) } : {}),
    ...(typeof result.response === 'string' ? { response: original('response', result.response) } : {}),
    ...(result.annotations ? { annotations: Object.fromEntries(Object.entries(result.annotations).map(([key, value]) =>
      [questionName(key), value])) } : {}),
  };
}
