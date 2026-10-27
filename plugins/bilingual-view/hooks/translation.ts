import type { PluginOptions } from 'claude-code';
import type { TranslationIO } from './ports.ts';
import { LiteralIntegrityError, needsTranslation, protectText, restoreText, splitText } from './text.ts';
import { parseTranslation, providerConfig, translationRequest } from './provider.ts';
import type { TranslationCorrection } from './provider.ts';

export function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Translation canceled. Retry when you are ready.');
}

export function inputFailure(error: unknown, typedAnswer = false): string {
  const reason = error instanceof Error && error.message.trim() ? error.message
    : 'Input translation did not finish. Retry or check the Provider settings with /bilingual-view check.';
  return (typedAnswer ? 'Your typed answer was not submitted. ' : 'Your message was not submitted. ') + reason;
}

/** Same sequential translation flow; HTTP and environment access are injected. */
export async function translate(io: TranslationIO, options: PluginOptions, source: string, direction: 'en' | 'zh', signal?: AbortSignal): Promise<string> {
  if (!needsTranslation(source, direction)) return source;
  aborted(signal);
  const base = String(options.base_url || await io.env.baseUrl() || '');
  const model = String(options.model || await io.env.model() || '');
  const key = String(options.api_key || await io.env.apiKey() || '');
  const config = providerConfig(base, model, key);
  const protectedText = protectText(source);
  const pieces: string[] = [];
  for (const chunk of splitText(protectedText.text)) {
    aborted(signal);
    const leading = chunk.match(/^\s*/)?.[0] ?? '';
    const trailing = chunk.match(/\s*$/)?.[0] ?? '';
    const body = chunk.trim();
    if (!body) { pieces.push(chunk); continue; }
    const request = async (correction?: TranslationCorrection): Promise<string> => {
      aborted(signal);
      let response;
      try { response = await io.fetch(config.endpoint, translationRequest(config, body, direction, correction)); }
      catch {
        aborted(signal);
        // This is the host HTTP API, not the OpenAI SDK. Its thrown values have
        // no verified error contract, so do not infer a transport cause from them.
        throw new Error('The translation request failed without an HTTP response. Check the connection and Provider settings, then retry.');
      }
      aborted(signal);
      return parseTranslation(response).trim();
    };
    let translated = await request();
    const chunkText = { ...protectedText, text: body };
    try { restoreText(translated, chunkText); }
    catch (error) {
      if (!(error instanceof LiteralIntegrityError)) throw error;
      // Repair only the failed chunk, with concrete feedback, once. Neither
      // unvalidated text nor guessed replacements can reach the display cache.
      translated = await request({ text: translated, detail: error.detail });
      restoreText(translated, chunkText);
    }
    pieces.push(leading + translated + trailing);
  }
  const translated = pieces.join('');
  if (direction === 'en' && /\p{Script=Han}/u.test(translated)) {
    throw new Error('The translator left Chinese in text that should be English. Retry or choose another translation model.');
  }
  return restoreText(translated, protectedText);
}
