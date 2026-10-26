import type { PluginOptions } from 'claude-code';
import type { TranslationIO } from './ports.ts';
import { LiteralIntegrityError, needsTranslation, protectText, restoreText, splitText } from './text.ts';
import { parseTranslation, providerConfig, translationRequest } from './provider.ts';
import type { TranslationCorrection } from './provider.ts';

export function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Translation canceled; your message was not submitted.');
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
      catch { throw new Error('Could not connect to the translation service, or the request timed out. Check Provider settings and retry.'); }
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
    throw new Error('The translator still returned Chinese; your message was not submitted. Retry or choose another translation model.');
  }
  return restoreText(translated, protectedText);
}
