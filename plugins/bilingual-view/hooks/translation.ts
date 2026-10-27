import type { PluginOptions } from 'claude-code';
import type { TranslationIO } from './ports.ts';
import { LiteralIntegrityError, needsTranslation, protectText, restoreText, splitText } from './text.ts';
import { parseTranslation, providerConfig, translationRequest } from './provider.ts';
import type { ProviderConfig, TranslationCorrection } from './provider.ts';

export function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Translation canceled. Retry when you are ready.');
}

export function inputFailure(error: unknown, typedAnswer = false): string {
  const reason = error instanceof Error && error.message.trim() ? error.message
    : 'Input translation did not finish. Retry or check the Provider settings with /bilingual-view check.';
  return (typedAnswer ? 'Your typed answer was not submitted. ' : 'Your message was not submitted. ') + reason;
}

function isHostHttpTimeout(error: unknown): boolean {
  // Verified against @anthropic-ai/claude-code-darwin-arm64 2.1.311:
  // the host emits this exact http.fetch message only when its deadline fires.
  // Match the host result, not elapsed time, AbortError, or generic timeout text.
  const message = error instanceof Error ? error.message : '';
  return /^[^\r\n]+: \$\.http\.fetch\(https?:\/\/\S+\) aborted: no complete answer within 30000ms$/.test(message);
}

/** One complete request, shared by normal translation and the unsplit speed test. */
export async function requestTranslation(io: TranslationIO, config: ProviderConfig, source: string,
  direction: 'en' | 'zh', signal?: AbortSignal, correction?: TranslationCorrection): Promise<string> {
  aborted(signal);
  let response;
  try { response = await io.fetch(config.endpoint, translationRequest(config, source, direction, correction)); }
  catch (error) {
    aborted(signal);
    if (isHostHttpTimeout(error)) {
      throw new Error('The translation request timed out (30-second limit). Retry or choose a faster translation model.');
    }
    // Other host exceptions have no verified classification here.
    throw new Error('The translation request failed without an HTTP response. Check the connection and Provider settings, then retry.');
  }
  aborted(signal);
  return parseTranslation(response).trim();
}

/** Translate up to two chunks at a time per call, preserving source order. */
export async function translate(io: TranslationIO, options: PluginOptions, source: string, direction: 'en' | 'zh', signal?: AbortSignal): Promise<string> {
  if (!needsTranslation(source, direction)) return source;
  aborted(signal);
  const base = String(options.base_url || await io.env.baseUrl() || '');
  const model = String(options.model || await io.env.model() || '');
  const key = String(options.api_key || await io.env.apiKey() || '');
  const config = providerConfig(base, model, key);
  const protectedText = protectText(source);
  const chunks = splitText(protectedText.text);
  const pieces: string[] = [];
  const translateChunk = async (chunk: string): Promise<string> => {
    aborted(signal);
    const leading = chunk.match(/^\s*/)?.[0] ?? '';
    const trailing = chunk.match(/\s*$/)?.[0] ?? '';
    const body = chunk.trim();
    if (!body) return chunk;
    const request = (correction?: TranslationCorrection) => requestTranslation(io, config, body, direction, signal, correction);
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
    return leading + translated + trailing;
  };
  let nextChunk = 0, stopped = false;
  const worker = async (): Promise<void> => {
    while (!stopped && nextChunk < chunks.length) {
      const index = nextChunk++;
      try { pieces[index] = await translateChunk(chunks[index]!); }
      catch (error) { stopped = true; throw error; }
    }
  };
  // Drain both workers before returning, even on failure, so the display queue
  // cannot start the next message while this one's requests are still in flight.
  const results = await Promise.allSettled([worker(), worker()]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  const translated = pieces.join('');
  if (direction === 'en' && /\p{Script=Han}/u.test(translated)) {
    throw new Error('The translator left Chinese in text that should be English. Retry or choose another translation model.');
  }
  return restoreText(translated, protectedText);
}
