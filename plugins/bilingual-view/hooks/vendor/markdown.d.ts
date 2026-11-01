import type { Literal, MarkdownSpans } from '../markdown.ts';
export function markdownSpans(source: string, literalAt: (at: number) => Literal | undefined, formatting?: boolean): MarkdownSpans;
