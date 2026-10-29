import type { ButtonProps, EngineInterface, Register, PluginOptions, RenderElement, RenderInput } from 'claude-code';
import type { RuntimeIO } from './ports.ts';
import type { DisplayMessageRef, FinalAnswerRef, State, RecordEntry } from './state.ts';
import { newState, newView } from './state.ts';
import { finalBlocks, needsTranslation, needsDisplayTranslation, textBlocks, translatedChineseDisplay } from './text.ts';
import { aborted, inputFailure, requestTranslation, translate } from './translation.ts';
import { TRANSLATION_SPEED_SAMPLE } from './speed-sample.ts';
import { memoryKey, outputWorkKey, readRecord, saveRecord } from './storage.ts';
import { ensureTranslation, displayRecord, pollVisible, ready } from './tasks.ts';
import { referenceFor, refreshHistory } from './history.ts';
import { effectiveSettings, enabled, fetchModels, SETTINGS_PANE } from './settings.ts';
import { providerConfig, reasoningEffort, REASONING_EFFORTS } from './provider.ts';
import { questionId, answerId, questionSource, drawQuestions, drawQuestionResult, translateAnswers } from './questions.ts';
import type { Question, QuestionResult } from './questions.ts';
import { diagnosticStatus, DIAGNOSTIC_FILE } from './diagnostics.ts';

// Keep every Claude API call visible in this entry module. The domain modules
// receive callbacks, never `$` or a host namespace, and need no extra process.
async function cachePath($: EngineInterface, path: string): Promise<string> {
  const userHome = await $.env.get('HOME') || await $.env.get('USERPROFILE');
  if (!userHome) throw new Error('Cannot locate the home directory for the translation cache.');
  return userHome.replace(/[\\/]+$/, '') + '/.claude/bilingual-view/' + path;
}

async function exportDiagnostics($: EngineInterface, state: State): Promise<void> {
  try {
    const path = await cachePath($, DIAGNOSTIC_FILE);
    const snapshot = state.diagnostics.snapshot(state.view.session, await $.clock.now());
    await $.fs.write(path, snapshot);
    await $.ui.toast('Diagnostic snapshot saved to ' + path + '. It replaces the previous snapshot.');
  } catch {
    await $.ui.toast('The diagnostic snapshot could not be saved. Recent events remain in memory; you can retry.');
  }
}

export function hostIO($: EngineInterface): RuntimeIO {
  return {
    cacheFiles: {
      read: async path => $.fs.read(await cachePath($, path)),
      write: async (path, text) => $.fs.write(await cachePath($, path), text),
      exists: async path => $.fs.exists(await cachePath($, path)),
    },
    env: {
      baseUrl: () => $.env.get('BILINGUAL_VIEW_BASE_URL'),
      model: () => $.env.get('BILINGUAL_VIEW_MODEL'),
      apiKey: () => $.env.get('BILINGUAL_VIEW_API_KEY'),
    },
    fetch: (url, init) => $.http.fetch(url, init),
    now: () => $.clock.now(),
    invalidate: () => $.ui.invalidate('ui.render'),
    toast: text => $.ui.toast(text),
    after: (ms, run) => { $.clock.after(ms, run); },
    history: { read: path => $.fs.read(path), stat: path => $.fs.stat(path) },
  };
}

async function humanOrigin($: EngineInterface, kind: string): Promise<boolean> {
  // Desktop hosts can submit through the SDK transport. Accept those only
  // while a desktop surface is attached, not in headless CLI/SDK automation.
  if (kind === 'composer' || kind === 'bridge') return true;
  if (kind === 'sdk') return (await $.session.surfaces()).includes('desktop');
  return false;
}

function switchView(state: State, session: string, path?: string): void {
  state.session = session;
  state.view = newView(session, path);
  state.pending = [];
  state.turns.clear();
  state.activeTurn = null;
  state.records.clear();
  state.originals.clear();
  // Accepted display work belongs to the instance, not the current view.
}

type ModelListing = { models: string[]; loading: boolean; error: string };
type ProviderTest = { running: boolean; result: string };
type ProviderTests = { version: number; connection: ProviderTest; speed: ProviderTest };

function clearTestResults(tests: ProviderTests): void {
  tests.version++;
  tests.connection.result = '';
  tests.speed.result = '';
}

function setupHint(baseUrl: string, model: string): string {
  const missing = [!baseUrl.trim() && 'Provider URL', !model.trim() && 'Model ID'].filter(Boolean);
  return missing.length ? `Setup required: enter ${missing.join(' and ')}.` : '';
}

function translationTiming(record: RecordEntry | null | undefined): string {
  if (!record || !ready(record)) return '';
  let ms = 0;
  for (const block of record.blocks) {
    // An older cache may have no timing. Never present an incomplete total.
    if (typeof block.translationMs !== 'number' || !Number.isFinite(block.translationMs) || block.translationMs < 0) return '';
    ms += block.translationMs;
  }
  return `Translated in ${(ms / 1000).toFixed(2)}s`;
}

function messageDrawing($: EngineInterface, e: RenderInput<'UserMessage' | 'AssistantMessage'>,
  drawing: RenderElement, toggle: ButtonProps | undefined, status: string, record: RecordEntry | null | undefined,
  retry?: ButtonProps): RenderElement {
  const { Box, Button, Text } = $.ui.resolve(e);
  const timing = translationTiming(record);
  // Keep both message controls below the native body in every display mode.
  const control = toggle ? Box({ key: 'tail-' + toggle.key, marginLeft: 2, flexShrink: 0,
    alignSelf: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 2, children: [
      Button({ ...toggle, plain: true, hover: { bold: true },
        // The host's message blue follows light, dark, and automatic themes
        // on the drawing surface, including theme changes without a hook rerun.
        children: Text({ color: 'briefLabelYou', underline: true, children: toggle.label }),
      }),
      ...(timing ? [Text({ dimColor: true, children: timing })] : []),
    ],
  }) : undefined;
  return Box({ flexDirection: 'column', children: [
    drawing, ...(control ? [control] : []),
    ...(status ? [Box({ flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginLeft: 2, children: [
      Text({ dimColor: true, children: status }), ...(retry ? [Button({ ...retry, plain: true })] : []),
    ] })] : []),
  ] });
}

async function saveSetting($: EngineInterface, options: Record<string, PluginOptions[string]>, tests: ProviderTests,
  field: string, value: string | boolean) {
  try {
    if (field === 'base_url' && value) providerConfig(String(value), '_', '');
    const result = await $.config.set({ key: $.plugin.name + '.' + field, value });
    if (result.deny) await $.ui.toast(result.deny);
    else {
      if (result.value !== undefined) {
        if (field !== 'enabled' && options[field] !== result.value) clearTestResults(tests);
        options[field] = result.value;
      }
      $.ui.invalidate('ui.render');
    }
  } catch { await $.ui.toast('Settings were not saved. Check this field with /plugin configure.'); }
}
async function openSettings($: EngineInterface) {
  await $.ui.open({ id: SETTINGS_PANE, title: 'Bilingual View settings', focus: true, closeOnEscape: true, rows: 27, columns: 64 });
}
async function loadModels($: EngineInterface, options: PluginOptions, listing: ModelListing) {
  if (listing.loading) return;
  listing.loading = true; listing.error = ''; $.ui.invalidate('ui.render');
  try { listing.models = await fetchModels(hostIO($), options); }
  catch (error) { listing.error = error instanceof Error ? error.message : 'Could not fetch models. You can still enter a model ID manually.'; }
  finally { listing.loading = false; $.ui.invalidate('ui.render'); }
}
async function saveApiKey($: EngineInterface, value: string): Promise<string | undefined> {
  const key = value.trim();
  if (!key) return;
  if (/[\r\n]/.test(key)) {
    await $.ui.toast('API keys must be a single line.');
    return;
  }
  try {
    const rows = await $.config.list();
    const owner = rows.find(row => row.key === $.plugin.name + '.base_url')?.provider.plugin;
    if (!owner) throw new Error('Plugin configuration is unavailable.');
    const userHome = await $.env.get('HOME') || await $.env.get('USERPROFILE');
    let executable = 'claude';
    if (userHome) {
      for (const name of ['claude', 'claude.exe']) {
        const path = userHome.replace(/[\\/]+$/, '') + '/.local/bin/' + name;
        if (await $.fs.exists(path)) { executable = path; break; }
      }
    }
    // Sensitive fields have no config.set row. The CLI uses the same host
    // credential storage; stdin keeps the key out of command arguments.
    const result = await $.process.run([executable, 'plugin', 'configure', owner,
      '--values-stdin', '--json'], {
      // A temporary --plugin-dir installation is otherwise absent in the child.
      env: owner.endsWith('@inline') ? { CLAUDE_CODE_PLUGIN_DIRS: $.plugin.root } : undefined,
      stdin: JSON.stringify({ api_key: key }), timeoutMs: 10000,
    });
    if (result.exitCode !== 0) throw new Error('Configuration was not saved.');
    const saved = JSON.parse(result.stdout);
    if (!saved.saved?.includes('api_key') || saved.unconfigured?.includes('api_key')) {
      throw new Error('The saved API key could not be confirmed.');
    }
    return key;
  } catch {
    // CLI diagnostics can contain submitted values. Keep errors UI-only and
    // never echo the key or subprocess output.
    await $.ui.toast('API key was not saved. Check that Claude CLI is available, or configure it through /plugin.');
  }
}
async function checkProvider($: EngineInterface, options: PluginOptions, tests: ProviderTests) {
  const { connection: test, version } = tests;
  if (test.running) {
    await $.ui.toast('A connection test is already running.');
    return;
  }
  test.running = true;
  test.result = '';
  $.ui.invalidate('ui.render');
  let result = '';
  try {
    await translate(hostIO($), { ...options }, 'This is a connection test.', 'zh');
    result = 'Translation Provider connection successful.';
  } catch (error) { result = 'Connection test failed. ' + (error instanceof Error ? error.message : 'Please retry.'); }
  finally {
    test.running = false;
    // A user can change the model while a test runs. Keep feedback tied to
    // the settings that were tested, without restarting or issuing requests.
    if (version === tests.version) test.result = result;
    $.ui.invalidate('ui.render');
  }
  if (version === tests.version) await $.ui.toast(result);
}
async function checkTranslationSpeed($: EngineInterface, options: PluginOptions, tests: ProviderTests) {
  const { speed: test, version } = tests;
  if (test.running) {
    await $.ui.toast('A translation speed test is already running.');
    return;
  }
  test.running = true;
  test.result = '';
  $.ui.invalidate('ui.render');
  let result = '';
  try {
    const io = hostIO($);
    const settings = await effectiveSettings(io, { ...options });
    const config = providerConfig(settings.baseUrl, settings.model, settings.apiKey, settings.effort);
    await $.ui.toast('Testing translation speed: translating the full English sample into Chinese...');
    const started = await $.clock.now();
    // The supplied sample is already prepared for the translation prompt.
    // Send it verbatim in one request, without splitting, caching or repair retries.
    const translated = await requestTranslation(io, config, TRANSLATION_SPEED_SAMPLE, 'zh');
    const seconds = ((await $.clock.now() - started) / 1000).toFixed(2);
    if (!/\p{Script=Han}/u.test(translated)) {
      throw new Error('The model did not return a Chinese translation. Retry or choose another translation model.');
    }
    result = `Translation speed test successful. English to Chinese request took ${seconds}s.`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'The translation request did not complete. Please retry.';
    result = 'Translation speed test failed. ' + reason;
  } finally {
    test.running = false;
    if (version === tests.version) test.result = result;
    $.ui.invalidate('ui.render');
  }
  if (version === tests.version) await $.ui.toast(result);
}

async function questionRecord($: EngineInterface, state: State, options: PluginOptions, id: string, questions: Question[], discover: boolean): Promise<RecordEntry | null> {
  const view = state.view;
  if (!view.session) return null;
  const ref: DisplayMessageRef = { kind: 'question', session: view.session, id: questionId(id), sources: [questionSource(questions)] };
  const io = hostIO($);
  let record = await displayRecord(io, state, ref);
  if (state.view !== view) return null;
  if (ready(record) || !discover && view.dialog !== ref.id) view.visible.delete(ref.id);
  else if (discover && view.visible.get(ref.id)?.kind !== 'question') {
    view.visible.set(ref.id, { kind: 'question', id: ref.id, text: ref.sources[0]! });
    const result = await ensureTranslation(io, state, options, ref, false, () => state.view === view && enabled(options));
    record = result.record ?? record;
    if (result.status === 'skipped') {
      view.visible.delete(ref.id);
      if (!ready(record)) return null;
    }
  }
  return record;
}

function questionDrawing($: EngineInterface, e: RenderInput<'AskUserQuestion' | 'ToolUse' | 'ToolResult'>,
  drawing: RenderElement, record: RecordEntry | null, state: State, options: PluginOptions, view: State['view']): RenderElement {
  if (!record || ready(record)) return drawing;
  const { Box, Text, Button } = $.ui.resolve(e);
  const failed = record.blocks.some(block => block.status === 'error');
  const controls = [
    Text({ dimColor: true, children: failed ? 'Question translation failed. You can still use the original text.' : 'Translating questions...' }),
    ...(failed ? [Button({ key: 'bv-question-retry-' + e.component + ':' + e.requestId, label: 'Retry translation', onPress: async () => {
      await ensureTranslation(hostIO($), state, options, { kind: 'question', session: view.session,
        id: questionId(e.requestId), sources: record.blocks.map(block => block.source) }, true,
      () => state.view === view && enabled(options));
      if (state.view === view) $.ui.invalidate('ui.render');
    } })] : []),
  ];
  return Box({ flexDirection: 'column', children: e.component === 'AskUserQuestion'
    ? [...controls, drawing] : [drawing, ...controls] });
}


export const register: Register = (on, configuredOptions) => {
  // Persistence belongs to the host. Update this shared runtime snapshot only
  // after a successful save, so the UI and requests use the same values without a reload.
  const options = { ...configuredOptions };
  const state = newState();
  // Ephemeral UI data only. All settings are written through the host's userConfig.
  const listing: ModelListing = { models: [], loading: false, error: '' };
  const tests: ProviderTests = { version: 0,
    connection: { running: false, result: '' }, speed: { running: false, result: '' } };

  on('session.start', async ($, e, next) => {
    const session = await $.session.id();
    state.diagnostics.record('session.start', session, '', 'observed', { view: state.view.session });
    if (state.session !== session) switchView(state, session);
    await $.command.register({ name: 'bilingual-view', description: 'Translation settings, connection and speed tests, and diagnostic snapshot', argumentHint: '[status|settings|on|off|check|speed|diagnostics]', immediate: true });
    if (!state.pollStarted) {
      state.pollStarted = true;
      $.clock.every(1000, () => enabled(options) ? pollVisible(hostIO($), state, options) : undefined);
    }
    $.ui.invalidate('ui.render');
    return next(e);
  });

  on('session.end', async ($, e, next) => {
    state.diagnostics.record('session.end', e.sessionId, '', 'observed', { view: state.view.session });
    switchView(state, '');
    return next(e);
  });

  on('classic.SessionStart', async ($, e, next) => {
    state.diagnostics.record('session.history', e.session_id, '',
      e.source === 'compact' ? 'compact' : e.source === 'resume' ? 'resume' : 'start',
      { view: state.view.session, count: state.view.finals.size });
    if (e.source === 'compact' && state.session === e.session_id) {
      state.view.path = e.transcript_path;
      state.view.historyStamp = undefined;
    } else switchView(state, e.session_id, e.transcript_path);
    const view = state.view;
    $.clock.after(0, () => refreshHistory(hostIO($), state, view));
    $.ui.invalidate('ui.render');
    return next(e);
  });

  on('prompt.submit', async ($, e, next) => {
    if (!enabled(options) || e.command) return next(e);
    if (!await humanOrigin($, e.origin.kind) || /^\s*[!/]/.test(e.text) || !needsTranslation(e.text, 'en')) return next(e);
    const view = state.view;
    const input = { visible: false };
    view.inputTranslations.add(input);
    const clearStatus = () => {
      if (view.inputTranslations.delete(input) && input.visible && state.view === view) $.ui.invalidate('ui.render');
    };
    let translated: string, translationMs: number;
    try {
      next.signal?.addEventListener('abort', clearStatus, { once: true });
      // Input has no message UUID until submission; show progress above the
      // composer, and avoid flashing a status for fast translations.
      $.clock.after(300, () => {
        if (state.view !== view || !view.inputTranslations.has(input)) return;
        input.visible = true;
        $.ui.invalidate('ui.render');
      });
      const started = await $.clock.now();
      translated = await translate(hostIO($), options, e.text, 'en', next.signal);
      translationMs = Math.max(0, await $.clock.now() - started);
    }
    catch (error) { return { drop: inputFailure(error) }; }
    finally {
      next.signal?.removeEventListener('abort', clearStatus);
      clearStatus();
    }
    aborted(next.signal);
    const pending = { original: e.text, translated, session: state.session, translationMs };
    state.pending.push(pending);
    const result = await next({ ...e, text: translated });
    if (result.drop) state.pending = state.pending.filter(item => item !== pending);
    return result;
  }).catch(async ($, e, next) => {
    // Do not silently submit Chinese when the translation hook fails.
    if (next.called || !enabled(options)) return next(e);
    return { drop: inputFailure(undefined) };
  });

  on('turn.start', async ($, e, next) => {
    if (e.agentId) return next(e);
    state.activeTurn = e.turnId;
    state.turns.set(e.turnId, { rows: [] });
    return next(e);
  });

  on('turn.step', async function* ($, e, next) {
    const turn = !e.agentId ? state.turns.get(e.turnId) : undefined;
    if (turn) { turn.rows = []; turn.stepSeen = true; turn.stopReason = null; }
    const result = yield* next(e);
    if (turn) turn.stopReason = result.stopReason;
    return result;
  });

  on('session.append', async ($, e, next) => {
    if (e.agentId) return next(e);
    if (e.door === 'prompt' && e.message.type === 'user' && await humanOrigin($, e.origin.kind) && !e.message.isMeta) {
      // Pair the in-flight submission with the UUID Claude assigns here.
      // Subsequent display/cache/task lookups use that UUID and role only.
      const texts = textBlocks(e.message.content);
      const index = state.pending.findIndex(item => item.session === state.session
        && [texts.join(''), texts.join('\n'), texts.join('\n\n')].includes(item.translated));
      if (index >= 0) {
        const item = state.pending.splice(index, 1)[0]!;
        await saveRecord(hostIO($), state, item.session, e.uuid, {
          v: 1, kind: 'user', chineseSource: 'original', at: await $.clock.now(),
          blocks: [{ source: item.translated, display: item.original, status: 'ready', translationMs: item.translationMs }],
        });
      }
    }
    if (e.door === 'response' && e.message.type === 'assistant' && state.activeTurn) {
      const turn = state.turns.get(state.activeTurn);
      if (turn) {
        const row = { id: e.uuid, texts: textBlocks(e.message.content), hasTools: e.message.content.some(b => b.type === 'tool_use') };
        const index = turn.rows.findIndex(item => item.id === row.id);
        if (index >= 0) turn.rows[index] = row;
        else turn.rows.push(row);
      }
    }
    // Observe only. In particular, never write the Chinese answer into content.
    return next(e);
  });

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e);
    const turn = state.turns.get(e.turnId);
    const view = state.view;
    state.turns.delete(e.turnId);
    if (state.activeTurn === e.turnId) state.activeTurn = null;
    const result = await next(e);
    if (!enabled(options) || e.isAborted || e.reason === 'error' || !turn || !e.answer.trim()) {
      state.diagnostics.record('final', view.session, e.turnId,
        !enabled(options) ? 'disabled' : e.isAborted ? 'aborted' : e.reason === 'error' ? 'turn_error' : !turn ? 'no_turn' : 'empty');
      return result;
    }
    const surfaces = await $.session.surfaces();
    if (!surfaces.includes('terminal') && !surfaces.includes('desktop')) return result;
    // turn.complete.answer may contain only the last block. A successful final
    // request identifies all its text rows, including multi-block answers.
    const blocks = turn.stepSeen
      ? turn.stopReason === 'end_turn' && !turn.rows.some(row => row.hasTools)
        ? turn.rows.flatMap(row => row.texts.filter(text => text.trim()).map(source => ({ id: row.id, source }))) : []
      : finalBlocks(turn.rows, e.answer);
    if (!blocks.length) {
      state.diagnostics.record('final', view.session, e.turnId, 'unidentified', { count: turn.rows.length });
      if (needsDisplayTranslation(e.answer)) await $.ui.toast('The final message could not be identified. The original text is unchanged.');
      return result;
    }
    const grouped = new Map<string, FinalAnswerRef>();
    for (const block of blocks) {
      if (!grouped.has(block.id)) grouped.set(block.id, { kind: 'assistant', id: block.id, sources: [], session: view.session });
      grouped.get(block.id)!.sources.push(block.source);
    }
    for (const [id, ref] of grouped) {
      state.diagnostics.record('final', view.session, id, 'identified', { count: ref.sources.length });
      if (state.view === view) view.finals.set(id, ref);
      await ensureTranslation(hostIO($), state, options, ref);
    }
    if (state.view === view) $.ui.invalidate('ui.render');
    return result;
  });

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (!enabled(options) || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e);
    const view = state.view;
    if (!view.session) return next(e);
    const { text, origin, onScreen } = e.props;
    if (!onScreen) view.visible.delete(e.requestId);
    if (e.props.task || e.props.from) {
      view.visible.delete(e.requestId);
      return next(e);
    }
    const io = hostIO($);
    const ref: DisplayMessageRef = { kind: 'user', id: e.requestId, sources: [text], session: view.session };
    let record = await displayRecord(io, state, ref);
    if (state.view !== view) return next(e);
    const source = record?.blocks[0]?.source ?? text;
    if (/^\s*[!/]/.test(source)) {
      view.visible.delete(ref.id);
      return next(e);
    }
    // Legacy records themselves prove a user's input. An unstamped row with
    // no record cannot be distinguished from an automatic notification.
    if (!await humanOrigin($, origin.kind) && !(['unclassified', 'sdk'].includes(origin.kind) && record)) {
      view.visible.delete(e.requestId);
      return next(e);
    }
    if (state.view !== view) return next(e);
    let needsChinese = !ready(record) && needsDisplayTranslation(source);
    if (ready(record) || !needsChinese) view.visible.delete(ref.id);
    else if (onScreen) {
      const visible = view.visible.get(ref.id);
      if (visible?.kind !== 'user') {
        view.visible.set(ref.id, { kind: 'user', id: ref.id, text: source });
        // Only entering the visible range discovers work here. A toggle just
        // redraws; the shared poller handles deferred admission and recovery.
        const ensured = await ensureTranslation(io, state, options, ref, false,
          () => state.view === view && view.visible.get(ref.id)?.kind === 'user');
        record = ensured.record ?? record;
        if (ensured.status === 'skipped') { needsChinese = false; view.visible.delete(ref.id); }
      }
    }
    if (state.view !== view) return next(e);
    const block = record?.blocks[0];
    if (!block && (!needsChinese || !onScreen)) return next(e);
    const key = 'user:' + ref.id;
    const showSent = state.originals.has(key);
    let display = !showSent && block?.status === 'ready' ? block.display : block?.source ?? text;
    if (!showSent && block?.status === 'ready' && record?.chineseSource === 'translation' && block.display !== block.source) {
      display = translatedChineseDisplay(block.display);
    }
    const drawing = await next({ ...e, props: { ...e.props, text: display } });
    // Display equality only hides redundant controls; UUID reuse is unchanged.
    if (ready(record) ? block?.display === block?.source : !needsChinese) return drawing;
    const status = block?.status === 'ready'
      ? ''
      : block?.status === 'error' ? (block.error || 'Translation failed. Please retry.')
      : state.output.jobs.get(memoryKey(ref.session, ref.id))?.status === 'running' ? 'Translating...' : 'Waiting for translation...';
    return messageDrawing($, e, drawing,
      block?.status === 'ready' && block.display !== block.source ? { key: 'sent-' + key, label: showSent ? 'Show Chinese' : 'View sent text',
        onPress: () => {
          if (state.view !== view) return;
          // A mounted button already has these contents. Reuse them when
          // switching even if retention/LRU removed the backing entries.
          // This is only the existing bounded memory cache, never a write
          // to disk or a new translation job.
          if (record) {
            const cacheKey = memoryKey(ref.session, ready(record) ? ref.id : outputWorkKey(ref.id));
            if (!state.records.get(cacheKey)) state.records.set(cacheKey, record);
          }
          if (state.originals.has(key)) state.originals.delete(key); else state.originals.add(key);
          $.ui.invalidate('ui.render');
        },
      } : undefined, status, record,
      block?.status === 'error' ? { key: 'retry-' + key, label: 'Retry translation',
        onPress: async () => {
          await ensureTranslation(io, state, options, ref, true, () => state.view === view);
          if (state.view === view) $.ui.invalidate('ui.render');
        },
      } : undefined);
  });

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const view = state.view;
    const visibility = e.props.onScreen === null ? 'hidden' : e.props.onScreen ? 'visible' : 'unknown';
    state.diagnostics.record('render.enter', view.session, e.requestId, enabled(options) ? 'enabled' : 'disabled',
      { surface: e.surface, visibility }, true);
    let outcome = 'failed', record: RecordEntry | null = null;
    try {
      if (!enabled(options) || (e.surface !== 'terminal' && e.surface !== 'desktop')) {
        outcome = !enabled(options) ? 'disabled' : 'unsupported_surface';
        return next(e);
      }
      if (!view.session) { outcome = 'no_session'; return next(e); }
      const wasVisible = view.visible.get(e.requestId)?.kind === 'assistant';
      if (e.props.onScreen === null) view.visible.delete(e.requestId);
      else if (e.props.onScreen) view.visible.set(e.requestId, { kind: 'assistant', id: e.requestId, text: e.props.text });
      const ref = await referenceFor(hostIO($), state, view, e.requestId);
      if (!ref || state.view !== view) { outcome = state.view !== view ? 'view_changed' : 'no_final_reference'; return next(e); }
      record = await displayRecord(hostIO($), state, ref);
      if (state.view !== view) { outcome = 'view_changed'; return next(e); }
      let needsChinese = !ready(record)
        && needsDisplayTranslation((record?.blocks.map(block => block.source) ?? ref.sources).join('\n\n'));
      if (ready(record) || !needsChinese) view.visible.delete(e.requestId);
      // As with user rows, only discover work on entry. The shared poller
      // handles recovery; ordinary redraws need no fresh cache read.
      else if (e.props.onScreen && !wasVisible) {
        const ensured = await ensureTranslation(hostIO($), state, options, ref, false,
          () => state.view === view && view.visible.get(ref.id)?.kind === 'assistant');
        record = ensured.record ?? record;
        if (ensured.status === 'skipped') { needsChinese = false; view.visible.delete(ref.id); }
      }
      if (state.view !== view) { outcome = 'view_changed'; return next(e); }
      if (!record) { outcome = 'no_record'; return next(e); }
      const key = 'assistant:' + ref.id;
      const showOriginal = state.originals.has(key);
      const queued = state.output.jobs.get(memoryKey(ref.session, ref.id))?.status === 'queued';
      // Read the entire saved message in order. Render text does not select or
      // validate its contents, and all saved parts share this UUID's choice.
      const original = record.blocks.map(block => block.source).join('\n\n');
      const chinese = record.blocks.map(block => block.status === 'ready' ? block.display : block.source).join('\n\n');
      // Adapt only translated display copies. Pending/unchanged blocks and the
      // saved-text equality used to hide redundant controls stay untouched.
      const display = showOriginal ? original : record.blocks.map(block => block.status === 'ready'
        ? block.display === block.source ? block.display : translatedChineseDisplay(block.display)
        : block.source).join('\n\n');
      const needsWork = !ready(record) && needsChinese;
      const error = record.blocks.find(block => block.status === 'error')?.error;
      const status = !needsWork ? '' : record.blocks.some(block => block.status === 'error') ? error || 'Translation failed. Please retry.'
        : queued ? 'Waiting for translation...' : 'Translating final answer...';
      const mode = showOriginal ? 'original' : original !== chinese ? 'translated' : 'pending';
      state.diagnostics.record('render.prepare', view.session, e.requestId, mode,
        { cache: diagnosticStatus(record), surface: e.surface }, true);
      const drawing = await next({ ...e, props: { ...e.props, text: display } });
      if (!needsWork && original === chinese) { outcome = 'unchanged'; return drawing; }
      const result = messageDrawing($, e, drawing,
        original !== chinese ? { key: 'original-' + key, label: showOriginal ? 'Show Chinese' : 'View original',
          onPress: () => {
            if (state.view !== view) return;
            const cacheKey = memoryKey(ref.session, ready(record) ? ref.id : outputWorkKey(ref.id));
            if (!state.records.get(cacheKey)) state.records.set(cacheKey, record);
            if (state.originals.has(key)) state.originals.delete(key); else state.originals.add(key);
            $.ui.invalidate('ui.render');
          },
        } : undefined, status, record,
        needsWork && record.blocks.some(block => block.status === 'error') ? { key: 'retry-' + key, label: 'Retry translation',
          onPress: async () => {
            await ensureTranslation(hostIO($), state, options, ref, true, () => state.view === view);
            if (state.view === view) $.ui.invalidate('ui.render');
          },
        } : undefined);
      // This confirms only the hook's return, not that the surface painted it.
      outcome = 'returned_' + mode + '_controls';
      return result;
    } finally {
      state.diagnostics.record('render.result', view.session, e.requestId, outcome,
        { view: state.view.session, cache: diagnosticStatus(record), surface: e.surface, visibility }, true);
    }
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawing = await next(e);
    if (e.props.hasSurvey || (e.surface !== 'terminal' && e.surface !== 'desktop')) return drawing;
    const model = String(options.model || await $.env.get('BILINGUAL_VIEW_MODEL') || '').trim();
    const baseUrl = String(options.base_url || await $.env.get('BILINGUAL_VIEW_BASE_URL') || '');
    const hint = enabled(options) ? setupHint(baseUrl, model) : 'Translation off: input is sent unchanged.';
    const effort = reasoningEffort(options.effort);
    const { Box, Text, Button } = $.ui.resolve(e);
    return Box({ flexDirection: 'column', children: [Box({ flexDirection: 'row', flexWrap: 'wrap', gap: 1, children: [
      Text({ dimColor: true, children: `Bilingual View · ${model || 'Not set'}(${effort === 'default' ? 'Provider default' : effort})` }),
      Button({ key: 'bv-toggle', label: enabled(options) ? '\u25cf On' : '\u25cb Off', plain: true,
        onPress: () => saveSetting($, options, tests, 'enabled', !enabled(options)) }),
      Button({ key: 'bv-settings', label: 'Settings', plain: true, onPress: () => openSettings($) }),
      ...([...state.view.inputTranslations].some(input => input.visible)
        ? [Text({ dimColor: true, children: 'Translating to English...' })] : []),
    ] }), ...(hint ? [Text({ children: hint })] : []), drawing] });
  });

  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e);
    const config = await effectiveSettings(hostIO($), options);
    const { Box, Text, Button, Input, Select } = $.ui.resolve(e);
    const choices = [...new Set([config.model, ...listing.models].filter(Boolean))];
    const hint = setupHint(config.baseUrl, config.model);
    return Box({ flexDirection: 'column', gap: 1, children: [
      Box({ flexDirection: 'column', children: [
        Button({ key: 'bv-setting-toggle', label: config.enabled ? 'Translation: On' : 'Translation: Off',
          onPress: () => saveSetting($, options, tests, 'enabled', !config.enabled) }),
        ...(!config.enabled ? [Text({ children: 'Input is sent unchanged; messages show their original text.' })] : []),
        ...(hint ? [Text({ children: hint })] : []),
        Text({ dimColor: true, children: 'Press Enter to save fields; selections save immediately.' }),
      ] }),
      Box({ flexDirection: 'column', children: [
        Text({ bold: true, children: '1 · Translation service' }),
        Input({ key: 'bv-base-url', label: 'Provider URL', value: config.baseUrl, submitLabel: 'Save',
          placeholder: 'https://provider.example/v1',
          onSubmit: value => saveSetting($, options, tests, 'base_url', value.trim()) }),
        Input({ key: 'bv-api-key', label: 'API key', value: '', submitLabel: 'Save',
          placeholder: config.apiKey ? 'Set (enter a new key to replace)' : 'Not set (enter a key)',
          onSubmit: async value => {
            const key = await saveApiKey($, value);
            if (key === undefined) return;
            if (options.api_key !== key) clearTestResults(tests);
            options.api_key = key;
            $.ui.invalidate('ui.render');
            await $.ui.toast('API key saved.');
          } }),
        Text({ dimColor: true, children: 'API key is optional for services without authentication.' }),
      ] }),
      Box({ flexDirection: 'column', children: [
        Text({ bold: true, children: '2 · Translation model' }),
        Input({ key: 'bv-model', label: 'Model ID', value: config.model, submitLabel: 'Save',
          onSubmit: value => saveSetting($, options, tests, 'model', value.trim()) }),
        Button({ key: 'bv-models', label: listing.loading ? 'Fetching models...' : 'Fetch models', onPress: () => loadModels($, options, listing) }),
        ...(listing.models.length && choices.length ? [Select({ key: 'bv-model-select', label: 'Select model', value: config.model,
          options: choices.map(value => ({ value, label: value })), onSelect: value => saveSetting($, options, tests, 'model', value) })] : []),
        Text({ dimColor: true, children: listing.error || (listing.models.length ? `${listing.models.length} models. Select one or enter a Model ID.` : 'Enter a Model ID, or fetch models from your Provider.') }),
        Select({ key: 'bv-effort', label: 'Effort', value: config.effort,
          options: REASONING_EFFORTS.map(value => ({ value, label: value === 'default' ? 'Provider default' : value })),
          onSelect: value => saveSetting($, options, tests, 'effort', value) }),
      ] }),
      Box({ flexDirection: 'column', children: [
        Text({ bold: true, children: '3 · Test and verify' }),
        Box({ flexDirection: 'row', flexWrap: 'wrap', gap: 1, children: [
          Button({ key: 'bv-check', label: tests.connection.running ? 'Testing connection...' : 'Test connection',
            onPress: () => checkProvider($, options, tests) }),
          Button({ key: 'bv-speed', label: tests.speed.running ? 'Testing translation speed...' : 'Test translation speed',
            onPress: () => checkTranslationSpeed($, options, tests) }),
        ] }),
        ...(tests.connection.result ? [Text({ children: tests.connection.result })] : []),
        ...(tests.speed.result ? [Text({ children: tests.speed.result })] : []),
        Text({ dimColor: true, children: 'For long text, prefer a model / effort that finishes within 15s.' }),
      ] }),
      Button({ key: 'bv-close', label: 'Close settings', onPress: () => $.ui.close({ id: SETTINGS_PANE }) }),
    ] });
  });

  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    if (!enabled(options) || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e);
    const view = state.view;
    const questions = e.props.questions as Question[];
    view.dialog = questionId(e.requestId);
    const record = await questionRecord($, state, options, e.requestId, questions, true);
    if (state.view !== view) return next(e);
    const drawing = await next({ ...e, props: { ...e.props, questions: drawQuestions(questions, record) } });
    return questionDrawing($, e, drawing, record, state, options, view);
  });

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const view = state.view;
    const result = await next(e);
    view.visible.delete(questionId(e.tool_use_id));
    if (view.dialog === questionId(e.tool_use_id)) view.dialog = undefined;
    if (!enabled(options) || result.deny || result.isError || !result.result || !view.session) return result;
    const io = hostIO($);
    try {
      const old = await readRecord(io, state, view.session, answerId(e.tool_use_id));
      const changed = await translateAnswers(io, options, e.questions as Question[], result.result as QuestionResult, old, next.signal);
      if (!changed.record) return result;
      changed.record.at = await $.clock.now();
      await saveRecord(io, state, view.session, answerId(e.tool_use_id), changed.record);
      // Omit the host's old ref/text so it maps and stores the translated result.
      return { result: changed.result, ...(result.context ? { context: result.context } : {}) };
    } catch (error) {
      await $.ui.toast(inputFailure(error, true));
      return { deny: 'Translation of the typed answer failed; it was not submitted. Ask the user again.' };
    }
  });

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!enabled(options) || e.props.tool !== 'AskUserQuestion' || e.props.isErrored
      || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e);
    const view = state.view, input = e.props.input as { questions?: Question[] } | undefined;
    if (!Array.isArray(input?.questions)) return next(e);
    const record = await questionRecord($, state, options, e.requestId, input.questions, !!e.props.onScreen);
    const answer = view.session ? await readRecord(hostIO($), state, view.session, answerId(e.requestId)) : null;
    if (state.view !== view) return next(e);
    const drawing = await next({ ...e, props: { ...e.props, input: { ...input, questions: drawQuestions(input.questions, record) },
      ...(e.props.output && typeof e.props.output === 'object' ? { output: drawQuestionResult(e.props.output as QuestionResult, input.questions, record, answer) } : {}),
    } });
    return questionDrawing($, e, drawing, record, state, options, view);
  });

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!enabled(options) || e.props.tool !== 'AskUserQuestion' || e.props.isErrored
      || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e);
    const view = state.view, result = e.props.output as QuestionResult;
    if (!result || !Array.isArray(result.questions)) return next(e);
    const record = await questionRecord($, state, options, e.requestId, result.questions, !!e.props.onScreen);
    const answer = view.session ? await readRecord(hostIO($), state, view.session, answerId(e.requestId)) : null;
    if (state.view !== view) return next(e);
    const drawing = await next({ ...e, props: { ...e.props, output: drawQuestionResult(result, result.questions, record, answer) } });
    return questionDrawing($, e, drawing, record, state, options, view);
  });

  on('command.run', { command: 'bilingual-view' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase();
    if (arg === 'settings') await openSettings($);
    else if (arg === 'on' || arg === 'off') await saveSetting($, options, tests, 'enabled', arg === 'on');
    else if (arg === 'check') await checkProvider($, options, tests);
    else if (arg === 'speed') await checkTranslationSpeed($, options, tests);
    else if (arg === 'diagnostics') await exportDiagnostics($, state);
    else {
      const config = await effectiveSettings(hostIO($), options);
      await $.ui.toast(`Translation ${config.enabled ? 'On' : 'Off'}; Provider: ${config.baseUrl || 'Not set'}; Model: ${config.model || 'Not set'}; Effort: ${config.effort === 'default' ? 'Provider default' : config.effort}; API key: ${config.apiKey ? 'Set' : 'Not set'}. Settings: /bilingual-view settings`);
    }
    // Returning command text would add it to model context. Use UI-only toasts.
    return {};
  });
};
