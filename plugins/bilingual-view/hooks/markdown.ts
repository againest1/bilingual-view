export type Span = { start: number; end: number };
export type Literal = Span & { kind: 'quote' | 'math' | 'paste' };
export type MarkdownSpans = {
  literals: Span[];
  marks: Array<Span & { open: number; closing: boolean }>;
  tables: Span[];
};
export { markdownSpans } from './vendor/markdown.js';
