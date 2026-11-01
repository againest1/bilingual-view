import { markdownSpans } from './markdown.ts';
import type { Literal, MarkdownSpans, Span } from './markdown.ts';

/** Pure text helpers. No Claude or network access. */
export type ProtectedText = {
  text: string; prefix: string; values: string[];
  blocks: Span[]; inlines: Span[];
};

function escapedAt(source: string, at: number): boolean {
  let count = 0;
  while (source[--at] === '\\') count++;
  return count % 2 !== 0;
}

/** The parser calls this only in prose, so code and links keep their precedence. */
function literalAt(source: string, at: number): Literal | undefined {
  const tail = source.slice(at), char = source[at];
  if (char === '<') {
    const paste = tail.match(/^<pasted_content id="([^"\r\n]+)">\r?\n[\s\S]*?\r?\n<\/pasted_content id="\1">/);
    if (paste) return { start: at, end: at + paste[0].length, kind: 'paste' };
  }
  const open = tail.match(/^(?:\\[([]|\${1,2}(?!\$))/)?.[0];
  if (open) {
    if (escapedAt(source, at) || char === '$' && source[at - 1] === '$') return;
    if (open === '$' && /\s/.test(source[at + 1] ?? '')) return;
    const close = open === '\\(' ? '\\)' : open === '\\[' ? '\\]' : open;
    let end = source.indexOf(close, at + open.length);
    while (end >= 0 && escapedAt(source, end)) end = source.indexOf(close, end + close.length);
    if (end < 0 || open === '$' && (/\s/.test(source[end - 1] ?? '') || /\d|\$/.test(source[end + 1] ?? '')
      || source.slice(at, end).includes('\n'))) return;
    return { start: at, end: end + close.length, kind: 'math' };
  }
  if (char === '"' && escapedAt(source, at) || char === "'" && /[\p{L}\p{N}]/u.test(source[at - 1] ?? '')) return;
  const quoted = tail.match(/^(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|“[^”\n]*”|「[^」\n]*」|『[^』\n]*』)/)?.[0];
  if (!quoted || source.trim() === quoted || char === "'" && /[\p{L}\p{N}]/u.test(source[at + quoted.length] ?? '')) return;
  return { start: at, end: at + quoted.length, kind: 'quote' };
}

/** Bare references stop at table separators and unmatched closing brackets. */
function referenceEnd(source: string, start: number, end: number, balance: boolean): number {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const stack: string[] = [];
  for (let i = start; i < end; i++) {
    const char = source[i]!;
    if (char === '|' && !escapedAt(source, i)) return i;
    if (!balance) continue;
    if (pairs[char]) stack.push(pairs[char]!);
    else if (')]}'.includes(char) && stack.pop() !== char) return i;
  }
  return end;
}

function firstAt(spans: Span[], at: number): number {
  let low = 0, high = spans.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (spans[mid]!.start < at) low = mid + 1;
    else high = mid;
  }
  return low;
}

function contains(spans: Span[], at: number): boolean {
  const span = spans[firstAt(spans, at + 1) - 1];
  return span !== undefined && at < span.end;
}

/** Apply translation policy to the parser's original-source ranges. */
function protectedSpans(source: string, markdown: MarkdownSpans): { spans: Span[]; fallback: Literal[] } {
  const pattern = new RegExp([
    /(?<opaque>[<"'“「『$\\])/.source,
    /(?<url>https?:\/\/[^\s，；。！？、：<>"）)]+)/.source,
    /(?<![A-Za-z0-9_.+-])(?<mention>@(?:"[^"\r\n]+"|'[^'\r\n]+'|[^\s,，;；。！？、：<>"'“”「」『』`]+))/.source,
    /(?<![\p{L}\p{M}\p{N}_./\\-])(?<path>(?:\.{0,2}\/|~\/|[A-Za-z]:[\\/]|[\p{L}\p{M}\p{N}_.-]+\/)[^\s,，;；。！？、：<>"'“”「」『』`]+)/u.source,
    /(?<![\p{L}\p{M}\p{N}_./\\-])(?<filename>[\p{L}_][\p{L}\p{M}\p{N}_.-]*\.[A-Za-z0-9_-]+|\.[A-Za-z][A-Za-z0-9_-]*)(?![A-Za-z0-9_-])/u.source,
  ].join('|'), 'gu');
  const spans: Span[] = [], fallback: Literal[] = [];
  let formattingMarks: MarkdownSpans['marks'] | undefined;
  let cursor = 0, next = 0, match = pattern.exec(source);
  while (match || next < markdown.literals.length) {
    const literal = markdown.literals[next];
    if (literal && literal.start < cursor) { next++; continue; }
    if (literal && (!match || literal.start <= match.index)) {
      spans.push(literal); cursor = literal.end; next++;
      pattern.lastIndex = cursor; match = pattern.exec(source);
      continue;
    }
    if (!match) break;
    const group = match.groups!;
    let start = match.index, end = pattern.lastIndex;
    if (group.opaque) {
      const candidate = literalAt(source, start);
      // An unmatched math delimiter in a table cell cannot pair with another cell's price.
      if (!candidate || candidate.kind === 'math' && contains(markdown.tables, start)
        && referenceEnd(source, start, candidate.end, false) < candidate.end) {
        match = pattern.exec(source); continue;
      }
      end = candidate.end;
      if (candidate.kind !== 'quote' && /\r|\n/.test(source.slice(start, end))) fallback.push(candidate);
    } else if (group.filename && /^(?:e\.g|i\.e)$/i.test(group.filename) && source[end] === '.'
      && !/[\p{L}\p{M}\p{N}_./\\-]/u.test(source[end + 1] ?? '')) {
      match = pattern.exec(source); continue;
    } else if (group.url || group.path || group.mention && !/^@["']/.test(group.mention)) {
      end = referenceEnd(source, start, end, !group.url);
      const suffix = source.slice(start, end).match(/[*_~]+[.:!?]*$/);
      let marks = markdown.marks;
      // A bare URL ends at Chinese punctuation for translation, even if GFM's
      // autolink consumes it. Ask the same parser for the concealed emphasis.
      if (suffix && group.url && /[，；。！？、：]/.test(source[end] ?? '')) {
        formattingMarks ??= markdownSpans(source, at => literalAt(source, at), true).marks;
        marks = formattingMarks;
      }
      if (suffix) for (let index = firstAt(marks, start); index < marks.length && marks[index]!.start < end; index++) {
        const mark = marks[index]!;
        if (contains(spans, mark.open)) continue;
        if (!mark.closing && mark.start === start) start = mark.end;
        else if (mark.closing && mark.open < start && mark.start >= match.index + suffix.index!) { end = mark.start; break; }
      }
    }
    if (end > start) { spans.push({ start, end }); cursor = end; pattern.lastIndex = end; }
    match = pattern.exec(source);
  }
  return { spans, fallback };
}

export function protectText(source: string): ProtectedText {
  let prefix = 'BV_LITERAL_';
  while (source.includes(prefix)) prefix = '_' + prefix;
  const at = (offset: number) => literalAt(source, offset);
  let markdown = markdownSpans(source, at);
  let selected = protectedSpans(source, markdown);
  if (selected.fallback.length) {
    // Mid-paragraph display formulas/pastes can cross a Markdown block boundary.
    // Hide only their interiors, preserving offsets and delimiter punctuation.
    let masked = '', cursor = 0;
    for (const span of selected.fallback) {
      masked += source.slice(cursor, span.start + 1) + 'x'.repeat(span.end - span.start - 2) + source[span.end - 1];
      cursor = span.end;
    }
    masked += source.slice(cursor);
    markdown = markdownSpans(masked, at);
    selected = protectedSpans(source, markdown);
  }
  const pieces: string[] = [], values: string[] = [];
  const replacements: Span[] = [];
  let cursor = 0, length = 0;
  for (const span of selected.spans) {
    const before = source.slice(cursor, span.start), token = `${prefix}${values.length}_END`;
    pieces.push(before, token);
    const start = length + before.length;
    replacements.push({ start, end: start + token.length });
    length = start + token.length;
    values.push(source.slice(span.start, span.end)); cursor = span.end;
  }
  pieces.push(source.slice(cursor));
  // Reuse the original parse, translating its offsets through the literal
  // substitutions instead of parsing placeholder text as a new document.
  const position = (offset: number, closing: boolean): number => {
    const index = firstAt(selected.spans, offset + 1) - 1;
    if (index < 0) return offset;
    const original = selected.spans[index]!, replacement = replacements[index]!;
    if (offset === original.start) return replacement.start;
    if (offset < original.end) return closing ? replacement.end : replacement.start;
    return replacement.end + offset - original.end;
  };
  const mapped = ({ start, end }: Span): Span => ({ start: position(start, false), end: position(end, true) });
  return { text: pieces.join(''), prefix, values,
    blocks: markdown.blocks.map(mapped),
    inlines: [...replacements, ...markdown.marks.filter(mark => mark.closing)
      .map(mark => mapped({ start: mark.open, end: mark.end }))],
  };
}


export class LiteralIntegrityError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super('Translation could not preserve code, paths or other protected text: ' + detail + '. Retry translation or choose another translation model.');
    this.name = 'LiteralIntegrityError';
    this.detail = detail;
  }
}

/** Track Markdown boundaries without interpreting the literal's hidden contents. */
function literalLocations(text: string, pattern: RegExp): Map<string, string> {
  const locations = new Map<string, string>();
  let at = 0, line = 1, cell = 1;
  for (const match of text.matchAll(pattern)) {
    for (; at < match.index; at++) {
      if (text[at] === '\n') { line++; cell = 1; }
      else if (text[at] === '|' && !escapedAt(text, at)) cell++;
    }
    locations.set(match[0], `line ${line}, cell ${cell}`);
    at += match[0].length;
  }
  return locations;
}

export function restoreText(translated: string, protectedText: ProtectedText): string {
  const { prefix, values } = protectedText;
  const tokenPattern = new RegExp(prefix + '(\\d+)_END', 'g');
  const expected = new Set([...protectedText.text.matchAll(tokenPattern)].map(m => m[0]));
  const actual = [...translated.matchAll(tokenPattern)].map(m => m[0]);
  const counts = new Map<string, number>();
  for (const token of actual) counts.set(token, (counts.get(token) ?? 0) + 1);
  // Token identity, not global word order, protects the literal. "Set X in Y"
  // becomes "in Y, set X" in Chinese without changing either code fragment.
  const missing = [...expected].filter(token => !counts.has(token));
  const duplicated = [...counts].filter(([, count]) => count > 1).map(([token]) => token);
  const unknown = [...counts.keys()].filter(token => !expected.has(token));
  const describe = (tokens: string[]) => tokens.slice(0, 6).join(', ')
    + (tokens.length > 6 ? ` (+${tokens.length - 6} more)` : '');
  const problems = [
    ...(missing.length ? ['missing ' + describe(missing)] : []),
    ...(duplicated.length ? ['duplicated ' + describe(duplicated)] : []),
    ...(unknown.length ? ['unknown ' + describe(unknown)] : []),
  ];
  if (problems.length) throw new LiteralIntegrityError(problems.join('; '));
  const before = literalLocations(protectedText.text, tokenPattern);
  const after = literalLocations(translated, tokenPattern);
  const moved = [...expected].filter(token => before.get(token) !== after.get(token));
  if (moved.length) {
    throw new LiteralIntegrityError('moved between lines or table cells: '
      + describe(moved.map(token => `${token} (${before.get(token)} -> ${after.get(token)})`)));
  }
  return translated.replace(tokenPattern, (_, n: string) => values[Number(n)] ?? '');
}

/** Display copies only: repair colon-ended bold headings joined to prose. */
export function translatedChineseDisplay(source: string): string {
  // Only a colon-ended bold heading touching prose can need a separator.
  if (!/[:\uff1a]\*\*[\p{L}\p{N}]/u.test(source)) return source;
  const protectedText = protectText(source);
  const { text, prefix, values } = protectedText;
  const token = new RegExp('^' + prefix + '(\\d+)_END');
  const display = text.replace(/(?<!\*)\*\*(?=\S)([^\r\n*]+[:\uff1a])\*\*(?=[\p{L}\p{N}])/gu, (match, _title, at: number) => {
    const line = text.slice(text.lastIndexOf('\n', at - 1) + 1, at).replace(/^(?: {0,3}> ?)+/, '');
    if (/^(?: {4}|\t)/.test(line) || escapedAt(text, at) || escapedAt(text, at + match.length - 3)) return match;
    // A placeholder starts with a letter, but its literal may start with a
    // backtick or math delimiter, which does not need this prose separator.
    const next = text.slice(at + match.length).match(token);
    if (next && !/^[\p{L}\p{N}]/u.test(values[Number(next[1])]!)) return match;
    return match + ' ';
  });
  return display === text ? source : restoreText(display, protectedText);
}

function prose(protectedText: ProtectedText): string {
  return protectedText.text.replace(/_*BV_LITERAL_\d+_END/g, '');
}

/** Eligibility and literal protection share one result for a submission. */
export function prepareTranslation(text: string, direction: 'en' | 'zh'): ProtectedText | undefined {
  // Removing literals cannot introduce Chinese into an input that has none.
  if (direction === 'en' && !/\p{Script=Han}/u.test(text)) return;
  const protectedText = protectText(text), plain = prose(protectedText);
  if (direction === 'en' ? /\p{Script=Han}/u.test(plain) : /[A-Za-z]{2,}/.test(plain)) return protectedText;
}

export function needsTranslation(text: string, direction: 'en' | 'zh'): boolean {
  return prepareTranslation(text, direction) !== undefined;
}

/** Message display only: Chinese prose is already readable, including mixed messages. */
export function needsDisplayTranslation(text: string): boolean {
  const plain = prose(protectText(text));
  return !/\p{Script=Han}/u.test(plain) && /[A-Za-z]{2,}/.test(plain);
}

/** Keep fitting Markdown ranges intact; subdivide oversized blocks within the HTTP budget. */
export function splitText({ text, blocks, inlines }: ProtectedText, limit = 1700): string[] {
  if (text.length <= limit) return text ? [text] : [];
  // Parser ranges nest. Keep the outermost ranges that fit, exposing smaller
  // paragraphs, table heads/rows and inline spans only inside oversized blocks.
  const intact: Span[] = [];
  for (const span of [...blocks, ...inlines].filter(span => span.end - span.start <= limit)
    .sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (span.start >= (intact.at(-1)?.end ?? 0)) intact.push(span);
  }
  const beforeRange = (cut: number): number => {
    const span = intact[firstAt(intact, cut) - 1];
    return span && cut < span.end ? span.start : cut;
  };
  const boundaries = [...new Set(blocks.flatMap(span => [span.start, span.end]))].sort((a, b) => a - b);
  const pieces: string[] = [];
  let start = 0;
  while (text.length - start > limit) {
    const ceiling = beforeRange(start + limit), minimum = start + limit / 2;
    let cut = 0, low = 0, high = boundaries.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (boundaries[mid]! <= ceiling) low = mid + 1;
      else high = mid;
    }
    for (let i = low - 1; i >= 0 && boundaries[i]! > minimum; i--) {
      if (beforeRange(boundaries[i]!) === boundaries[i]) { cut = boundaries[i]!; break; }
    }
    // Oversized paragraphs/rows fall back to lines, then prose boundaries.
    for (const line of [true, false]) {
      if (cut) break;
      for (let i = ceiling; i > minimum; i--) {
        const boundary = line ? text[i - 1] === '\n'
          : text[i - 1] === ' ' || text[i - 1] === '\u3002' || text[i - 1] === '.' && text[i] === ' ';
        if (boundary && beforeRange(i) === i) { cut = i; break; }
      }
    }
    cut ||= ceiling;
    while (cut < ceiling && /\s/.test(text[cut]!) && beforeRange(cut + 1) === cut + 1) cut++;
    // Hard subdivision still preserves Unicode and CRLF line endings.
    if (/[\uD800-\uDBFF]/.test(text.charAt(cut - 1)) || text[cut - 1] === '\r' && text[cut] === '\n') cut--;
    pieces.push(text.slice(start, cut));
    start = cut;
  }
  if (start < text.length) pieces.push(text.slice(start));
  return pieces;
}

export type TextRow = { id: string; texts: string[]; hasTools: boolean };
export type FinalBlock = { id: string; source: string };

/** Match a final answer only against the latest response rows, never by global text. */
export function finalBlocks(rows: TextRow[], answer: string): FinalBlock[] {
  const normalize = (s: string) => s.replace(/\r\n/g, '\n').trim();
  const target = normalize(answer);
  if (!target) return [];
  const blocks: FinalBlock[] = [];
  for (const row of rows) {
    if (row.hasTools) blocks.length = 0;
    else for (const source of row.texts) if (source.trim()) blocks.push({ id: row.id, source });
  }
  // Some builds report only the last visible text block; others join the final reply.
  for (let start = blocks.length - 1; start >= 0; start--) {
    const tail = blocks.slice(start);
    for (const separator of ['', '\n', '\n\n']) {
      if (normalize(tail.map(b => b.source).join(separator)) === target) return tail;
    }
  }
  return [];
}

export function textBlocks(content: readonly { type: string; [key: string]: unknown }[]): string[] {
  return content.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text as string);
}
