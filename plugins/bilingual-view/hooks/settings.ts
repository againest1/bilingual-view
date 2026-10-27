import type { PluginOptions } from 'claude-code';
import type { TranslationIO } from './ports.ts';
import { providerConfig, reasoningEffort } from './provider.ts';

export const SETTINGS_PANE = 'bilingual-view-settings';
export const enabled = (options: PluginOptions): boolean => options.enabled !== false;

/** A read of the host options and existing environment fallback, never a settings store. */
export async function effectiveSettings(io: TranslationIO, options: PluginOptions) {
  return {
    baseUrl: String(options.base_url || await io.env.baseUrl() || ''),
    model: String(options.model || await io.env.model() || ''),
    effort: reasoningEffort(options.effort),
    apiKey: String(options.api_key || await io.env.apiKey() || ''),
    enabled: enabled(options),
  };
}

/** Called only by the settings panel's Fetch models button. The caller holds the list in memory. */
export async function fetchModels(io: TranslationIO, options: PluginOptions): Promise<string[]> {
  const settings = await effectiveSettings(io, options);
  const config = providerConfig(settings.baseUrl, settings.model || '_', settings.apiKey);
  const response = await io.fetch(config.endpoint.replace(/\/chat\/completions$/, '/models'), {
    method: 'GET', headers: config.apiKey ? { Authorization: 'Bearer ' + config.apiKey } : {},
  });
  if (!response.ok) throw new Error(`Could not fetch models (HTTP ${response.status}). You can still enter a model ID manually.`);
  let data: any;
  try { data = JSON.parse(response.text); } catch { throw new Error('The model list format is incompatible. You can still enter a model ID manually.'); }
  const ids: string[] = Array.isArray(data?.data)
    ? data.data.flatMap((item: any) => typeof item?.id === 'string' && item.id.trim() ? [item.id] : []) : [];
  if (!ids.length) throw new Error('The Provider returned no models. Enter a model ID manually.');
  return [...new Set(ids)].sort();
}
