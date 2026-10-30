/** Pure text helpers. No Claude or network access. */
export type ProtectedText = { text: string; prefix: string; values: string[] };

function unquoteLine(line: string, indents: number[]): string | undefined {
  for (const indent of indents) {
    const quote = line.match(/^([ \t]*)>[ \t]?/);
    if (!quote || columns(quote[1]!) < indent) return undefined;
    line = line.slice(quote[0].length);
  }
  return line;
}

function columns(text: string): number {
  let width = 0;
  for (const char of text) width += char === '\t' ? 4 - width % 4 : 1;
  return width;
}

/** Find a code fence's own closer, including quoted/list containers and longer closers. */
function fenceEnd(source: string, start: number, fence: string, prefix: string): number {
  const lists = /(?:[-+*]|\d+[.)])[ \t]+/g;
  const listIndent = (part: string) => /(?:[-+*]|\d+[.)])[ \t]+/.test(part)
    ? columns(part.replace(lists, marker => ' '.repeat(columns(marker)))) : 0;
  const quoteIndents: number[] = [];
  for (let quote; (quote = prefix.indexOf('>')) >= 0;) {
    quoteIndents.push(listIndent(prefix.slice(0, quote)));
    prefix = prefix.slice(quote + 1).replace(/^[ \t]/, '');
  }
  const indent = listIndent(prefix);
  for (let at = start; at < source.length;) {
    const newline = source.indexOf('\n', at);
    const end = newline < 0 ? source.length : newline;
    const raw = source.slice(at, end).replace(/\r$/, '');
    const line = unquoteLine(raw, quoteIndents);
    if (line === undefined || (indent && line.trim() && columns(line.match(/^[ \t]*/)![0]) < indent)) {
      return at - (source[at - 2] === '\r' ? 2 : 1);
    }
    const closing = line.match(/^([ \t]*)(`+|~+)[ \t]*$/);
    if (closing && columns(closing[1]!) - indent <= 3
      && closing[2]![0] === fence[0] && closing[2]!.length >= fence.length) return at + raw.length;
    at = newline < 0 ? source.length : newline + 1;
  }
  return source.length;
}

/** Keep an indented block whole, without treating paragraph/list indentation as code. */
function indentedCodeEnd(source: string, start: number, indent: string, blockEnds: Set<number>): number | undefined {
  const closedBlock = /^[ \t]*(?:#{1,6}(?:[ \t]|$)|(?:=+|-+|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,}|`{3,}|~{3,})[ \t]*$)/;
  let required = 4, minimum = columns(indent), first = true;
  for (let at = start; at > 0;) {
    const end = at - 1;
    at = end > 0 ? source.lastIndexOf('\n', end - 1) + 1 : 0;
    const line = source.slice(at, end).replace(/\r$/, '');
    const blank = /^[ \t]*$/.test(line);
    // Code can follow a blank line or a closed block, but cannot interrupt prose.
    if (first && !blank && !closedBlock.test(line) && !blockEnds.has(at + line.length)) return;
    first = false;
    if (blank) continue;
    const width = columns(line.match(/^[ \t]*/)![0]);
    const list = line.match(/^([ \t]*)([-+*]|\d+[.)])([ \t]+)/);
    if (list && width < minimum) {
      const markerWidth = columns(list[1]! + list[2]!);
      const contentIndent = columns(list[0]);
      const padding = contentIndent - markerWidth;
      const listIndent = markerWidth + (padding > 4 ? 1 : padding);
      if (listIndent <= minimum) { required += listIndent; break; }
    }
    // A list paragraph may continue without indentation. Only an actual block
    // boundary, rather than that lazy continuation, can end its list context.
    if (!list && width < minimum && at > 0) {
      const previousEnd = at - 1;
      const previousStart = previousEnd > 0 ? source.lastIndexOf('\n', previousEnd - 1) + 1 : 0;
      const previous = source.slice(previousStart, previousEnd).replace(/\r$/, '');
      if (previous.trim() && !closedBlock.test(previous) && !blockEnds.has(previousStart + previous.length)) continue;
    }
    minimum = Math.min(minimum, width);
    if (!minimum) break;
  }
  let end = start;
  for (let at = start; at < source.length;) {
    const newline = source.indexOf('\n', at);
    const line = source.slice(at, newline < 0 ? source.length : newline).replace(/\r$/, '');
    if (!/^[ \t]*$/.test(line)) {
      if (columns(line.match(/^[ \t]*/)![0]) < required) break;
      end = at + line.length;
    }
    at = newline < 0 ? source.length : newline + 1;
  }
  // Interior blank lines belong to the literal; trailing ones remain separators.
  return end > start ? end : undefined;
}

function inlineCodeEnd(source: string, start: number, ticks: string): number | undefined {
  const prefix = source.slice(source.lastIndexOf('\n', start - 1) + 1, start);
  const container = prefix.match(/^(?:[ \t]*>[ \t]?|[ \t]*(?:[-+*]|\d+[.)])[ \t]+)*/)![0];
  const quotes = (container.match(/>/g) ?? []).length;
  const indent = columns(container.replace(/^.*>[ \t]?/, ''));
  const orderedList = /\d+[.)][ \t]+/.test(container);
  const heading = /^ {0,3}#{1,6}(?:[ \t]|$)/.test(prefix.slice(container.length));
  const runs = /`+|\r?\n/g;
  runs.lastIndex = start + ticks.length;
  for (let found; (found = runs.exec(source));) {
    if (found[0][0] === '`') {
      if (found[0].length === ticks.length) return runs.lastIndex;
      continue;
    }
    // Soft line breaks belong to a code span; paragraph and block boundaries do not.
    if (heading) return;
    const newline = source.indexOf('\n', runs.lastIndex);
    let line = source.slice(runs.lastIndex, newline < 0 ? source.length : newline).replace(/\r$/, '');
    // Quote markers and list indentation can continue the opening paragraph.
    for (let i = 0; i < quotes; i++) line = line.replace(/^[ \t]*>[ \t]?/, '');
    let offset = 0, width = 0;
    while (width < indent && /[ \t]/.test(line[offset] ?? '')) {
      width += line[offset++] === '\t' ? 4 - width % 4 : 1;
    }
    if (width >= indent) line = line.slice(offset);
    const orderedItem = line.match(/^ {0,3}(\d{1,9})[.)](?:[ \t]+|$)/);
    if (/^[ \t]*$/.test(line)
      || orderedItem && (orderedList || Number(orderedItem[1]) === 1)
      || /^ {0,3}(?:#{1,6}(?:[ \t]|$)|>|[-+*](?:[ \t]+|$)|<pasted_content id="|(?:`{3,}(?!`)[^`]*|~{3,}.*)$|(?:=+|-+|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*$)/.test(line)) return;
  }
}

function escapedAt(source: string, at: number): boolean {
  let count = 0;
  while (source[--at] === '\\') count++;
  return count % 2 !== 0;
}

/** Common math delimiters only; leave unmatched/escaped delimiters and prices as prose. */
function mathEnd(source: string, at: number, open: string): number | undefined {
  if (escapedAt(source, at)) return;
  if (open === '$' && /\s/.test(source[at + 1] ?? '')) return;
  const close = open === '\\(' ? '\\)' : open === '\\[' ? '\\]' : open;
  let end = source.indexOf(close, at + open.length);
  while (end >= 0 && escapedAt(source, end)) end = source.indexOf(close, end + close.length);
  if (end < 0) return;
  if (open === '$' && (/\s/.test(source[end - 1] ?? '') || /\d|\$/.test(source[end + 1] ?? '')
    || source.slice(at, end).includes('\n'))) return;
  return end + close.length;
}

/** Bare references stop at table separators; paths/mentions also stop at unmatched brackets. */
function referenceEnd(source: string, start: number, end: number, balanceBrackets: boolean): number {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const stack: string[] = [];
  for (let i = start; i < end; i++) {
    const char = source[i]!;
    if (char === '|' && !escapedAt(source, i)) return i;
    if (!balanceBrackets) continue;
    if (pairs[char]) stack.push(pairs[char]!);
    else if (')]}'.includes(char) && stack.pop() !== char) return i;
  }
  return end;
}

/** A same-line bold closer belongs to the prose, not the preceding reference. */
function boldReferenceEnd(source: string, start: number, end: number, before: string): number {
  const suffix = source.slice(start, end).match(/(?<!\*)\*\*[.:!?]*$/);
  if (!suffix || escapedAt(source, start + suffix.index!)) return end;
  const prefix = before.slice(before.lastIndexOf('\n') + 1);
  const closing = prefix.length + suffix.index!;
  const line = prefix + source.slice(start, end) + (source[end] ?? ' ');
  const punctuation = /[\p{P}$+<=>^`|~]/u;
  let depth = 0;
  for (const mark of line.matchAll(/(?<!\*)\*\*(?!\*)/g)) {
    if (mark.index > closing) break;
    if (escapedAt(line, mark.index)) continue;
    const previous = line[mark.index - 1] ?? ' ', next = line[mark.index + 2] ?? ' ';
    const opens = !/\s/.test(next) && (!punctuation.test(next) || /\s/.test(previous) || punctuation.test(previous));
    const closes = !/\s/.test(previous) && (!punctuation.test(previous) || /\s/.test(next) || punctuation.test(next));
    if (depth && closes) {
      if (mark.index === closing) return start + suffix.index!;
      depth--;
    } else if (opens) depth++;
  }
  return end;
}

export function protectText(source: string): ProtectedText {
  let prefix = 'BV_LITERAL_';
  while (source.includes(prefix)) prefix = '_' + prefix;
  const values: string[] = [];
  const blockEnds = new Set<number>();
  // Match spans on the original source: a paste or code block stays one literal,
  // including any other syntax inside it. Link and paste patterns are unchanged.
  const pattern = new RegExp([
    /<pasted_content id="(?<pasteId>[^"\r\n]+)">\r?\n[\s\S]*?\r?\n<\/pasted_content id="\k<pasteId>">(?:\r?\n)?/.source,
    // Consume quote padding once and all list padding. Letting adjacent
    // containers borrow that whitespace causes exponential retries without a fence.
    /^(?<fencePrefix>(?:[ \t]*>(?:[ \t]|(?![ \t]))|[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?![ \t]))* {0,3})(?:(?<backticks>`{3,})(?!`)[^`\r\n]*|(?<tildes>~{3,})(?!~)[^\r\n]*)(?:\r?\n|$)/.source,
    /^(?<indented>(?: {4}| {0,3}\t)[ \t]*)(?=[^ \t\r\n])/.source,
    /(?<ticks>`+)/.source,
    /(?<math>\\[([]|(?<!\$)\${1,2}(?!\$))/.source,
    /(?<url>https?:\/\/[^\s<>"\uff09)]+)|!?\[[^\]\n]*\]\([^\n)]*\)/.source,
    /(?<![A-Za-z0-9_.+-])(?<mention>@(?:"[^"\r\n]+"|'[^'\r\n]+'|[^\s,\uff0c;\uff1b\u3002\uff01\uff1f\u3001\uff1a<>"'\u201c\u201d\u300c\u300d\u300e\u300f`]+))/.source,
    /(?<![A-Za-z0-9_./\\-])(?<path>(?:\.{0,2}\/|~\/|[A-Za-z]:[\\/]|[A-Za-z0-9_.-]+\/)[^\s,\uff0c;\uff1b\u3002\uff01\uff1f\u3001\uff1a<>"'\u201c\u201d\u300c\u300d\u300e\u300f`]+)/.source,
    /(?<![A-Za-z0-9_./\\-])(?:[A-Za-z_][A-Za-z0-9_.-]*\.[A-Za-z0-9_-]+|\.[A-Za-z][A-Za-z0-9_-]*)(?![A-Za-z0-9_-])/.source,
    /\u201c[^\u201d\n]*\u201d|\u300c[^\u300d\n]*\u300d|\u300e[^\u300f\n]*\u300f|"[^"\n]*"|(?<![\p{L}\p{N}])'(?:\\.|[^'\\\n])*'(?![\p{L}\p{N}])/u.source,
  ].join('|'), 'gmu');
  const pieces: string[] = [];
  let cursor = 0;
  for (let match; (match = pattern.exec(source));) {
    const group = match.groups!;
    if (group.ticks && escapedAt(source, match.index)) { pattern.lastIndex = match.index + 1; continue; }
    let end = pattern.lastIndex;
    const indent = group.indented || group.fencePrefix?.match(/^[ \t]*/)?.[0];
    const indentedEnd = indent && columns(indent) >= 4 ? indentedCodeEnd(source, match.index, indent, blockEnds) : undefined;
    if (indentedEnd !== undefined) end = indentedEnd;
    else if (group.backticks || group.tildes) end = fenceEnd(source, end, group.backticks || group.tildes!, group.fencePrefix!);
    else if (group.indented) end = match.index;
    else if (group.ticks) end = inlineCodeEnd(source, match.index, group.ticks) ?? match.index;
    else if (group.math) end = mathEnd(source, match.index, group.math) ?? match.index;
    else if (group.url || group.path || group.mention && !/^@["']/.test(group.mention)) {
      end = referenceEnd(source, match.index, end, !group.url);
      if (!group.url && source.slice(match.index, end).includes('**')) {
        // Previously protected code/quotes must not supply a false opener.
        end = boldReferenceEnd(source, match.index, end, pieces.join('') + source.slice(cursor, match.index));
      }
    }
    if (end === match.index) continue;
    const value = source.slice(match.index, end);
    // A whole quoted question/reply is prose, rather than a literal embedded
    // in an instruction. Still look inside for explicit files, code or formulas.
    if (source.trim() === value && /^["'\u201c\u300c\u300e]/u.test(value)) { pattern.lastIndex = match.index + 1; continue; }
    if (group.indented || group.backticks || group.tildes || group.pasteId) blockEnds.add(end);
    const index = values.push(value) - 1;
    pieces.push(source.slice(cursor, match.index), `${prefix}${index}_END`);
    cursor = end;
    pattern.lastIndex = end;
  }
  pieces.push(source.slice(cursor));
  return { text: pieces.join(''), prefix, values };
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

function prose(text: string): string {
  return protectText(text).text.replace(/_*BV_LITERAL_\d+_END/g, '');
}

export function needsTranslation(text: string, direction: 'en' | 'zh'): boolean {
  // Removing literals cannot introduce Chinese into an input that has none.
  if (direction === 'en' && !/\p{Script=Han}/u.test(text)) return false;
  const plain = prose(text);
  return direction === 'en' ? /\p{Script=Han}/u.test(plain) : /[A-Za-z]{2,}/.test(plain);
}

/** Message display only: Chinese prose is already readable, including mixed messages. */
export function needsDisplayTranslation(text: string): boolean {
  const plain = prose(text);
  return !/\p{Script=Han}/u.test(plain) && /[A-Za-z]{2,}/.test(plain);
}

/** Lossless boundaries keep long requests within the host's 30s HTTP budget. */
export function splitText(text: string, limit = 1700): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = limit;
    const head = rest.slice(0, limit);
    // Keep complete lines together before falling back to an in-line boundary.
    const newline = head.lastIndexOf('\n');
    const boundary = newline > limit / 2 ? newline
      : Math.max(head.lastIndexOf('\u3002'), head.lastIndexOf('. '), head.lastIndexOf(' '));
    if (boundary > limit / 2) cut = boundary + 1;
    // Never cut one of our protected literals or a UTF-16 surrogate pair.
    const tokenStart = rest.lastIndexOf('BV_LITERAL_', cut);
    if (tokenStart >= 0) {
      const tokenEnd = rest.indexOf('_END', tokenStart) + 4;
      if (tokenEnd > cut) cut = tokenStart || tokenEnd;
    }
    if (/[\uD800-\uDBFF]/.test(rest.charAt(cut - 1))) cut--;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) pieces.push(rest);
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
