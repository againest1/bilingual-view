import type { ProcessRunInit, Timer } from 'claude-code';

type Install = { scope: string; projectPath?: string; installPath: string; version: string };
type Source = { source: string; ref?: string; url?: string; repo?: string };
type Marketplace = { source: Source; installLocation: string; autoUpdate?: boolean };
type Target = { id: string; market: string; directory: string; install: Install };
type ProcessResult = { exitCode: number; stdout: string };

export type UpdateIO = {
  root: string;
  configDir(): Promise<string | undefined>;
  cwd(): Promise<string>;
  read(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  declaredMarkets(): Promise<unknown>;
  offline(): Promise<boolean>;
  cli(): Promise<string>;
  run(argv: string[], init: ProcessRunInit): Promise<ProcessResult>;
  after(ms: number, run: () => Promise<void>): Timer;
  invalidate(): void;
  toast(text: string): void | Promise<void>;
};

const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');

// Claude Code's documented defaults when neither the settings nor the registry
// declares autoUpdate. claude.ai catalogs are also automatic.
const autoUpdateMarkets = new Set(['claude-plugins-official', 'claude-code-marketplace', 'claude-code-plugins',
  'anthropic-marketplace', 'anthropic-plugins', 'agent-skills', 'anthropic-agent-skills', 'life-sciences',
  'claude-for-legal', 'claude-for-financial-services', 'financial-services-plugins', 'claude-tag-plugins']);

async function installs(io: UpdateIO, directory: string): Promise<Record<string, Install[]>> {
  const registry = JSON.parse(await io.read(directory + '/installed_plugins.json'));
  return registry.plugins ?? {};
}

async function findTarget(io: UpdateIO): Promise<Target | undefined> {
  const config = await io.configDir();
  if (!config) return;
  const directory = normalize(config) + '/plugins';
  if (!await io.exists(directory + '/installed_plugins.json')) return;
  // On the first toolbar render config.list() can still have no plugin rows.
  // The loaded root identifies this copy even when a sideload shadows an install.
  const root = normalize(io.root);
  const cwd = normalize(await io.cwd());
  for (const [id, rows] of Object.entries(await installs(io, directory))) {
    if (!id.startsWith('bilingual-view@')) continue;
    const matches = rows.filter(row => normalize(row.installPath) === root
      && (!row.projectPath || cwd === normalize(row.projectPath) || cwd.startsWith(normalize(row.projectPath) + '/')));
    // Several scopes can share one cache directory. Match the CLI's scope priority.
    for (const scope of ['local', 'project', 'user', 'managed']) {
      const install = matches.filter(row => row.scope === scope)
        .sort((a, b) => (b.projectPath?.length ?? 0) - (a.projectPath?.length ?? 0))[0];
      if (install) return { id, market: id.slice(id.indexOf('@') + 1), directory, install };
    }
  }
}

// This marketplace distributes an unversioned directory from its Git checkout.
// Claude records the commit as the installed version. Ask for the same ref without
// fetching a clone, changing the catalog, or installing anything.
async function offeredCommit(io: UpdateIO, market: Marketplace): Promise<string | undefined> {
  const source = market.source;
  if (source.source !== 'github' && source.source !== 'git') return;
  const catalog = JSON.parse(await io.read(market.installLocation + '/.claude-plugin/marketplace.json'));
  const entry = catalog.plugins?.find((plugin: { name: string }) => plugin.name === 'bilingual-view');
  if (typeof entry?.source !== 'string' || !entry.source.startsWith('./') || entry.version) return;
  const ref = source.ref || 'HEAD';
  const refs = ref === 'HEAD' || ref.startsWith('refs/') ? [ref] : ['refs/heads/' + ref, 'refs/tags/' + ref];
  const tag = refs.find(value => value.startsWith('refs/tags/'));
  let remote = 'origin';
  if (!await io.exists(market.installLocation + '/.git')) {
    remote = source.repo ? 'https://github.com/' + source.repo + '.git' : source.url || '';
  }
  if (!remote) return;
  const result = await io.run(['git', 'ls-remote', '--exit-code', '--', remote, ...refs, ...(tag ? [tag + '^{}'] : [])],
    { cwd: market.installLocation, env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' }, timeoutMs: 15000 });
  if (result.exitCode !== 0) return;
  const found = new Map(result.stdout.trim().split(/\r?\n/).map(line => {
    const [sha, fullRef] = line.split(/\s+/);
    return [fullRef, sha] as const;
  }));
  const branch = refs.find(value => value !== tag);
  const commit = (branch && found.get(branch)) || (tag && (found.get(tag + '^{}') || found.get(tag)));
  return commit && /^[a-f0-9]{40,64}$/i.test(commit) ? commit : undefined;
}

export class PluginUpdates {
  private readonly io: UpdateIO;
  private discovery?: Promise<void>;
  private target?: Target;
  private timer?: Timer;
  private stopped = false;
  private checksEnabled = false;
  private generation = 0;
  private available = false;
  private updating = false;
  private failed = false;

  constructor(io: UpdateIO) { this.io = io; }

  get label(): string | undefined {
    if (!this.target) return;
    if (this.updating) return 'Updating…';
    if (this.failed) return 'Retry update';
    return this.available ? '↑ Update available' : 'Update now';
  }

  get highlighted(): boolean { return !this.updating && (this.available || this.failed); }

  start(): Promise<void> {
    return this.discovery ??= findTarget(this.io).then(target => {
      if (this.stopped || !target) return;
      this.target = target;
      this.schedule(0);
    }).catch(() => { /* A sideload or unavailable install registry has no update target. */ });
  }

  stop(): void {
    this.stopped = true;
    this.timer?.cancel();
    this.generation++;
  }

  private schedule(delay: number): void {
    this.timer = this.io.after(delay, async () => {
      await this.refresh(true);
      if (!this.stopped) this.schedule(300000 + Math.floor(Math.random() * 300001));
    });
  }

  private setAvailable(value: boolean): void {
    if (this.available !== value) {
      this.available = value;
      this.io.invalidate();
    }
  }

  private async checkSource(target: Target): Promise<Marketplace | undefined> {
    const known = JSON.parse(await this.io.read(target.directory + '/known_marketplaces.json'));
    const market: Marketplace | undefined = known[target.market];
    if (!market || await this.io.offline()) return;
    const declared = await this.io.declaredMarkets() as Record<string, { autoUpdate?: boolean }> | undefined;
    const automatic = declared?.[target.market]?.autoUpdate ?? market.autoUpdate
      ?? (market.source.source === 'claudeai' || autoUpdateMarkets.has(target.market));
    return automatic ? undefined : market;
  }

  async refresh(due: boolean): Promise<void> {
    const target = this.target;
    if (!target || this.stopped) return;
    const market = await this.checkSource(target).catch(() => undefined);
    if (this.stopped) return;
    if (!market) {
      this.checksEnabled = false;
      this.generation++;
      this.setAvailable(false);
      return;
    }
    const newlyEnabled = !this.checksEnabled;
    this.checksEnabled = true;
    if (this.updating || (!due && !newlyEnabled)) return;
    const generation = ++this.generation;
    try {
      const rows = (await installs(this.io, target.directory))[target.id];
      const current = rows?.find(row => row.scope === target.install.scope && row.projectPath === target.install.projectPath);
      if (!current || !/^[a-f0-9]{12,64}$/i.test(current.version)) {
        this.setAvailable(false);
        return;
      }
      const offered = await offeredCommit(this.io, market);
      if (generation === this.generation && offered) this.setAvailable(!offered.startsWith(current.version));
    } catch { /* A failed background check is retried at the next interval. */ }
  }

  async update(): Promise<void> {
    await this.start();
    const target = this.target;
    if (!target) {
      await this.io.toast('No Marketplace installation found for this copy of Bilingual View. Update it from its original source.');
      return;
    }
    if (this.updating || this.stopped) return;
    this.updating = true;
    this.failed = false;
    this.generation++;
    this.io.invalidate();
    let failure = 'Could not run Claude Code. Check that the Claude CLI is available.';
    try {
      const cli = await this.io.cli();
      const options = { cwd: target.install.projectPath, timeoutMs: 150000 };
      failure = 'Could not refresh the marketplace. Check its source and connection in /plugins.';
      // The plugin command resolves its version from the local marketplace checkout.
      const refresh = await this.io.run([cli, 'plugin', 'marketplace', 'update', target.market], options);
      if (refresh.exitCode !== 0) throw new Error(failure);
      failure = 'Could not update Bilingual View. Check the plugin under /plugins → Installed.';
      const update = await this.io.run([cli, 'plugin', 'update', target.id, '--scope', target.install.scope, '--json'], options);
      if (update.exitCode !== 0) throw new Error(failure);
      const result = JSON.parse(update.stdout.trim().split(/\r?\n/).pop() || '{}');
      if (result.updateOutcome !== 'updated' && result.updateOutcome !== 'up_to_date') throw new Error(failure);
      this.available = false;
      await this.io.toast(result.updateOutcome === 'updated' ? 'Updated · Run /reload-plugins to apply.' : 'Already up to date.');
    } catch {
      this.failed = true;
      await this.io.toast(failure);
    } finally {
      this.updating = false;
      this.io.invalidate();
    }
  }
}
