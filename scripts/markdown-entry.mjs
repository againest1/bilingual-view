import { parse, postprocess, preprocess } from 'micromark';
import { gfm } from 'micromark-extension-gfm';

const gfmSyntax = gfm();
const protectedTypes = new Set(['codeFenced', 'codeIndented', 'codeText', 'link', 'image', 'definition', 'autolink',
  'gfmFootnoteCall', 'gfmFootnoteDefinitionLabel', 'bilingualLiteral']);
const emphasisTypes = new Set(['strong', 'emphasis', 'strikethrough']);

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
  const out = { literals: [], marks: [], tables: [] };
  const extensions = [gfmSyntax, literals(literalAt)];
  if (formatting) extensions.push({ disable: { null: ['protocolAutolink'] } });
  const events = postprocess(parse({ extensions }).document().write(preprocess()(source, undefined, true)));
  let protectedEnd = -1;
  for (const [kind, token] of events) {
    if (kind !== 'enter') continue;
    const start = token.start.offset, end = token.end.offset;
    if (start < protectedEnd) continue;
    if (protectedTypes.has(token.type)) {
      out.literals.push({ start, end });
      protectedEnd = end;
    } else if (emphasisTypes.has(token.type)) {
      const width = token.type === 'strong' ? 2 : token.type === 'emphasis' ? 1 : source[start + 1] === '~' ? 2 : 1;
      out.marks.push({ start, end: start + width, open: start, closing: false },
        { start: end - width, end, open: start, closing: true });
    } else if (token.type === 'table') out.tables.push({ start, end });
  }
  out.marks.sort((a, b) => a.start - b.start);
  return out;
}
