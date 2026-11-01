export type Span = { start: number; end: number };
export type MarkdownBlock = Span & { kind: string; parent: number | null };
export type Literal = Span & { kind: 'quote' | 'math' | 'paste' };
export type MarkdownSpans = {
  literals: Span[];
  marks: Array<Span & { open: number; closing: boolean }>;
  tables: Span[];
  blocks: MarkdownBlock[];
};
export { markdownSpans } from './vendor/markdown.js';
