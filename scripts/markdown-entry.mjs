import { parse, postprocess, preprocess } from 'micromark';
import { gfm } from 'micromark-extension-gfm';

const gfmSyntax = gfm();
const protectedTypes = new Set(['codeFenced', 'codeIndented', 'codeText', 'link', 'image', 'definition', 'autolink',
  'gfmFootnoteCall', 'gfmFootnoteDefinitionLabel', 'bilingualLiteral']);
const emphasisTypes = new Set(['strong', 'emphasis', 'strikethrough']);
const blockTypes = new Set(['paragraph', 'atxHeading', 'setextHeading', 'thematicBreak', 'htmlFlow',
  'blockQuote', 'listOrdered', 'listUnordered', 'gfmFootnoteDefinition', 'table', 'tableHead', 'tableRow',
  'tableDelimiterRow', 'codeFenced', 'codeIndented']);

/** Recognize translation literals only where the Markdown parser allows prose. */
function literals(literalAt) {
  const construct = {
    name: 'bilingualLiteral', concrete: true,
    tokenize(effects, ok, nok) {
      const context = this;
      let literal;
      return start;
      function start(code) {
        literal = literalAt(context.now().offset);
        if (!literal) return nok(code);
        if (context.interrupt) return ok(code);
        effects.enter('bilingualLiteral');
        return inside(code);
      }
      function inside(code) {
        if (context.now().offset >= literal.end) {
          effects.exit('bilingualLiteral');
          return ok(code);
        }
        if (code === null) return nok(code);
        // Emit each physical line ending so micromark can join flow chunks.
        if (code === -3 || code === -4 || code === -5) {
          effects.enter('lineEnding'); effects.consume(code); effects.exit('lineEnding');
        } else effects.consume(code);
        return inside;
      }
    },
  };
  return {
    text: Object.fromEntries(['"', "'", '“', '「', '『', '$', '\\', '<'].map(char => [char.charCodeAt(0), construct])),
    flow: Object.fromEntries(['$', '\\', '<'].map(char => [char.charCodeAt(0), construct])),
  };
}

/** Positions only: never render or serialize the user's original Markdown. */
export function markdownSpans(source, literalAt, formatting = false) {
  const out = { literals: [], marks: [], tables: [], blocks: [] };
  const extensions = [gfmSyntax, literals(literalAt)];
  if (formatting) extensions.push({ disable: { null: ['protocolAutolink'] } });
  const events = postprocess(parse({ extensions }).document().write(preprocess()(source, undefined, true)));
  const stack = [];
  let protectedEnd = -1;
  for (const [kind, token] of events) {
    if (kind === 'exit') {
      const parent = stack.at(-1);
      if (parent?.token === token) {
        if (parent.item !== undefined) out.blocks[parent.item].end = token.end.offset;
        stack.pop();
      }
      continue;
    }
    const start = token.start.offset, end = token.end.offset;
    if (start < protectedEnd) continue;
    const parent = stack.at(-1);
    if (token.type === 'listItemPrefix' && parent) {
      // Micromark emits item prefixes and list containers, not item spans.
      // A sibling prefix or the container's exit closes the complete item.
      const itemStart = source.lastIndexOf('\n', start - 1) + 1;
      if (parent.item !== undefined) out.blocks[parent.item].end = itemStart;
      parent.item = out.blocks.length;
      out.blocks.push({ start: itemStart, end, kind: 'listItem', parent: parent.index });
    }
    if (blockTypes.has(token.type)) {
      // Include quote/list prefixes with their content. tableHead keeps the
      // header and delimiter together even when the table must be subdivided.
      const index = out.blocks.length;
      out.blocks.push({ start: source.lastIndexOf('\n', start - 1) + 1, end,
        kind: token.type, parent: parent?.item ?? parent?.index ?? null });
      stack.push({ token, index });
    }
    if (protectedTypes.has(token.type)) {
      out.literals.push({ start, end });
      protectedEnd = end;
    } else if (emphasisTypes.has(token.type)) {
      // A paragraph consisting entirely of strong text is a common prose heading.
      if (token.type === 'strong' && parent?.token.type === 'paragraph'
        && parent.token.start.offset === start && parent.token.end.offset === end) {
        out.blocks[parent.index].kind = 'heading';
      }
      const width = token.type === 'strong' ? 2 : token.type === 'emphasis' ? 1 : source[start + 1] === '~' ? 2 : 1;
      out.marks.push({ start, end: start + width, open: start, closing: false },
        { start: end - width, end, open: start, closing: true });
    } else if (token.type === 'table') out.tables.push({ start, end });
  }
  out.marks.sort((a, b) => a.start - b.start);
  return out;
}
