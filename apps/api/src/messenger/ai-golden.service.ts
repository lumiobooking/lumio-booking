import { Controller, Get, HttpCode, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { SUPPORT_ROLE } from '../support/support.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { AiBrainService } from '../ai-brain/ai-brain.service';
import { AiReleaseService } from '../common/ai-release.service';
import { RELEASE_FEATURES, type ReleaseFeature } from '../common/ai-release';
import { GOLDEN_KEY, goldenFail, accountResult, bestBefore, goldenFrom, goldenVerdict, type GoldenAccount, type GoldenItem, type GoldenRecord } from '../common/ai-golden';
import { GOLDEN_SCENARIOS } from '../ai-brain/simulations';
import { MessengerService } from './messenger.service';
import { hardFaults } from './ai-golden-checks';
import type { DryRunResult } from './dry-run';

/** A run that has said "running" for longer than this died with its server; another may start. */
const RUN_STALE_MS = 15 * 60_000;
/** At most this many test accounts are run (the platform's own two, by default). */
const MAX_ACCOUNTS = 3;

/**
 * Runs the golden run (common/ai-golden): on each of the platform's test
 * accounts, the scripted customers through the LIVE assistant (./dry-run),
 * graded, checked for hard faults and timed. Once by itself a few minutes
 * after a new build starts serving, and whenever a Super Admin asks.
 *
 * Only ever on the test accounts (common/ai-release) — never a paying
 * salon's data, and never a real customer's conversation.
 */
@Injectable()
export class AiGoldenService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('AiGolden');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messenger: MessengerService,
    private readonly brain: AiBrainService,
    private readonly release: AiReleaseService,
    @Optional() private readonly push?: PushService,
  ) {}

  onModuleInit() {
    // "Thử AI" and the salon's own sample customers ask the LIVE assistant where `liveTry` is on (ai-brain useLiveAnswer).
    this.brain.useLiveAnswer?.(async (tenantId, messages) => (this.release.isOn('liveTry', tenantId) ? this.messenger.dryRun(tenantId, messages) : null));
    if (process.env.NODE_ENV !== 'production' || String(process.env.AI_GOLDEN ?? '').toLowerCase() === 'off') return;
    // After the deploy has settled and after the canary (4 min) — never in the first customers' way.
    this.timer = setTimeout(() => void this.run({ auto: true }).catch((e) => this.logger.warn(`golden run failed: ${String((e as Error)?.message ?? e).slice(0, 160)}`)), 7 * 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() { if (this.timer) clearTimeout(this.timer); }

  commit(): string { return (process.env.RENDER_GIT_COMMIT || 'dev').slice(0, 7); }

  async last(): Promise<GoldenRecord | null> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: GOLDEN_KEY } }).catch(() => null);
    return goldenFrom(row?.value);
  }

  private async keep(rec: GoldenRecord): Promise<void> {
    const value = JSON.stringify(rec);
    await this.prisma.platformConfig.upsert({ where: { key: GOLDEN_KEY }, create: { key: GOLDEN_KEY, value }, update: { value } });
  }

  /** Is a run in flight — here, or (by the stored record) on another instance of this build? */
  async busy(): Promise<boolean> {
    if (this.running) return true;
    const last = await this.last();
    return Boolean(last && last.state === 'running' && Date.now() - Date.parse(last.at) < RUN_STALE_MS);
  }

  /**
   * One golden run. `auto` (after a deploy) runs once per build; a person's
   * request always runs. Returns null when it did not start.
   */
  async run(o: { auto?: boolean; by?: string | null } = {}): Promise<GoldenRecord | null> {
    const commit = this.commit();
    if (await this.busy()) return null;
    // The last finished run: what "not worse than before" is measured against.
    const before = await this.last();
    if (o.auto && (commit === 'dev' || (before && before.commit === commit && before.state === 'done'))) return null;
    this.running = true;
    // Which behaviours the test accounts have switched on right now: what this run is evidence for.
    const view = await this.release.view().catch(() => null);
    const live = (Object.keys(RELEASE_FEATURES) as ReleaseFeature[]).filter((f) => { const s = view?.features.find((x) => x.feature === f)?.stage; return s === 'canary' || s === 'on'; });
    const started: GoldenRecord = { commit, at: new Date().toISOString(), state: 'running', live, accounts: [], ok: false, why: [], by: o.by ?? null };
    try {
      await this.keep(started);
      const ids = this.release.testAccountIds().slice(0, MAX_ACCOUNTS);
      const salons = ids.length
        ? await this.prisma.tenant.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, name: true } }).catch(() => [] as { id: string; name: string }[])
        : [];
      const accounts: GoldenAccount[] = [];
      for (const salon of salons) accounts.push(await this.runAccount(salon, before));
      const v = goldenVerdict(accounts);
      const rec: GoldenRecord = { ...started, at: new Date().toISOString(), state: 'done', accounts, ok: v.ok, why: v.why };
      await this.keep(rec);
      this.logger.log(`golden ${commit}: ${accounts.map((a) => `${a.name} ${a.passed}/${a.total}${a.medianMs !== null ? ` ${(a.medianMs / 1000).toFixed(1)}s` : ''}`).join(' · ') || 'no test account'} — ${v.ok ? 'PASSED' : `NOT PASSED (${v.why.join(' ')})`}`);
      if (!v.ok && this.push) {
        await this.push.sendToTeam({
          title: `Bộ kiểm tra AI bản ${commit}: chưa đạt`,
          body: `${v.why.slice(0, 2).join(' ')} Chưa thể bật tính năng mới cho mọi tiệm.`.slice(0, 240),
          url: '/super-admin/ai-fleet', tag: 'lumio-ai-golden',
        }).catch(() => undefined);
      }
      return rec;
    } catch (e) {
      const rec: GoldenRecord = { ...started, at: new Date().toISOString(), state: 'error', error: String((e as Error)?.message ?? e).replace(/\s+/g, ' ').slice(0, 200) };
      await this.keep(rec).catch(() => undefined);
      return rec;
    } finally {
      this.running = false;
    }
  }

  /** The scripted customers against ONE test account's live assistant. Every read inside is for this salon only. */
  private async runAccount(salon: { id: string; name: string }, before: GoldenRecord | null): Promise<GoldenAccount> {
    // The platform itself, acting inside its OWN test account (as the canary does).
    const actor = { userId: null, role: UserRole.SALON_ADMIN, tenantId: salon.id } as unknown as AuthenticatedUser;
    /** The last dry run of each scripted conversation, found again by what the customer typed. */
    const lastOf = new Map<string, DryRunResult>();
    const all: DryRunResult[] = [];
    const key = (customer: string[]) => customer.join('\u0001');
    const answer = async (messages: { role: 'user' | 'assistant'; content: string }[]) => {
      const r = await this.messenger.dryRun(salon.id, messages);
      all.push(r);
      lastOf.set(key(messages.filter((m) => m.role === 'user').map((m) => m.content)), r);
      // What the grader reads: the reply as the customer would have seen it, or plainly that there was none.
      const shown = r.state === 'reply' ? [r.reply, r.choices.length ? `[buttons: ${r.choices.join(' | ')}]` : ''].filter(Boolean).join('\n')
        : r.state === 'silent' ? '(the assistant sent nothing)'
          : r.state === 'held' ? '(the reply was held back for a person)'
            : `(lỗi: ${r.error ?? 'the assistant failed'})`;
      return { reply: shown, tools: r.tools, found: r.found };
    };
    try {
      const sim = await this.brain.runSimulations(actor, 'vi', { answer, store: false, extra: GOLDEN_SCENARIOS });
      const items: GoldenItem[] = sim.items.map((it) => {
        const dry = lastOf.get(key(it.customer));
        return { id: it.id, lang: it.lang, pass: it.pass, why: String(it.why ?? '').slice(0, 200), ms: dry?.ms ?? 0, hard: dry ? hardFaults({ state: dry.state, reply: dry.reply }) : ['error'] };
      });
      // What was actually said, for every script that did not pass (./ai-golden GoldenFail).
      const fails = sim.items.map((it, i) => ({ it, item: items[i], dry: lastOf.get(key(it.customer)) }))
        .filter((x) => !x.item.pass || x.item.hard.length)
        .map((x) => goldenFail({
          id: x.it.id, lang: x.it.lang, why: x.item.why, hard: x.item.hard, ms: x.item.ms, state: x.dry?.state ?? 'error', customer: x.it.customer,
          reply: x.dry ? (x.dry.state === 'reply' ? [x.dry.reply, x.dry.choices.length ? `[nút: ${x.dry.choices.join(' | ')}]` : ''].filter(Boolean).join(' ') : (x.dry.error ?? '')) : '',
          rewrites: x.dry?.steps?.r ?? 0, tools: x.dry?.tools ?? [],
        }));
      return accountResult({ name: salon.name, mode: sim.mode, items, steps: all.filter((r) => r.state !== 'error').map((r) => r.steps), best: bestBefore(before, salon.name, items.length), fails });
    } catch (e) {
      this.logger.warn(`golden run on ${salon.name} failed: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
      return accountResult({ name: salon.name, mode: 'booking', items: [], steps: [] });
    }
  }
}

/**
 * The golden run, for the platform team. Support may read the result; only a
 * Super Admin may start one (it spends model calls). It names the test
 * accounts and carries counts and script ids — never a message.
 */
@Controller('support/ai-golden')
@Roles(SUPPORT_ROLE, UserRole.SUPER_ADMIN)
export class AiGoldenController {
  constructor(private readonly golden: AiGoldenService, private readonly prisma: PrismaService) {}

  @Get()
  async last() {
    return { commit: this.golden.commit(), record: await this.golden.last() };
  }

  /** Starts a run and answers at once; the result is read with the GET above (about three minutes later). */
  @Post('run')
  @HttpCode(200)
  @Roles(UserRole.SUPER_ADMIN)
  async run(@CurrentUser() user: AuthenticatedUser) {
    if (await this.golden.busy()) return { started: false, reason: 'running' };
    void this.golden.run({ by: user.email || user.userId || null }).catch(() => undefined);
    await this.prisma.auditLog.create({ data: { tenantId: null, userId: user.userId ?? null, action: 'platform.ai_golden_run', resourceType: 'platform_config', resourceId: GOLDEN_KEY, metadata: { commit: this.golden.commit() } } }).catch(() => undefined);
    return { started: true };
  }
}
