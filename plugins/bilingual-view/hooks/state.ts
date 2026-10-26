import type { TextRow } from './text.ts';
import type { PluginOptions } from 'claude-code';
import type { RuntimeIO } from './ports.ts';
import { MemoryCache, DISPLAY_CACHE_MAX_ENTRIES, DISPLAY_CACHE_MAX_BYTES } from './memory.ts';

export type Block = { source: string; display: string; status: 'ready' | 'pending' | 'error'; error?: string };
export type RecordEntry = {
  v: 1; kind: 'user' | 'assistant' | 'question' | 'answer'; at: number; blocks: Block[];
  /** Tool-answer fields only; selects answers inside one tool call, not message identity. */
  fields?: string[];
  /** User display only. Missing on legacy v1 user records means original input. */
  chineseSource?: 'original' | 'translation';
};
type PendingInput = { original: string; translated: string; session: string };
type Turn = { rows: TextRow[]; stepSeen?: boolean; stopReason?: string | null };
export type MessageIdentity = { kind: RecordEntry['kind']; id: string };
export type SessionMessageRef = MessageIdentity & { session: string };
export type DisplayMessageRef = SessionMessageRef & { sources: string[] };
export type FinalAnswerRef = DisplayMessageRef & { kind: 'assistant' };
export type DisplayTask = {
  ref: SessionMessageRef; record: RecordEntry; status: 'queued' | 'running';
  io: RuntimeIO; options: PluginOptions;
};
export type View = {
  session: string; path?: string; historyStamp?: string; loadingHistory: boolean;
  dialog?: string;
  inputTranslations: Set<{ visible: boolean }>;
  finals: Map<string, FinalAnswerRef>;
  visible: Map<string, { kind: 'user' | 'assistant' | 'question'; id: string; text: string }>;
};
export function newView(session: string, path?: string): View {
  return { session, path, loadingHistory: false, inputTranslations: new Set(), finals: new Map(), visible: new Map() };
}

export type State = {
  records: MemoryCache<RecordEntry | null>;
  cacheWrites: Promise<unknown>;
  pending: PendingInput[];
  turns: Map<string, Turn>;
  activeTurn: string | null;
  session: string;
  originals: Set<string>;
  output: {
    jobs: Map<string, DisplayTask>; queue: DisplayTask[]; running: boolean; scheduled: boolean;
    admission: Promise<unknown>;
  };
  view: View;
  pollStarted: boolean;
  polling: boolean;
};

export function newState(): State {
  return {
    records: new MemoryCache(DISPLAY_CACHE_MAX_ENTRIES, DISPLAY_CACHE_MAX_BYTES),
    cacheWrites: Promise.resolve(),
    originals: new Set(),
    pending: [], turns: new Map(), activeTurn: null, session: '',
    output: { jobs: new Map(), queue: [], running: false, scheduled: false, admission: Promise.resolve() },
    view: newView(''), pollStarted: false, polling: false,
  };
}
