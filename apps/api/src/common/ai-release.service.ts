import { ConflictException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EMPTY_RELEASE, RELEASE_FEATURES, RELEASE_KEY, canarySlugs, cleanRelease, featureOn, releaseView, stageOf, type ReleaseFeature, type ReleaseStage, type ReleaseState } from './ai-release';
import { GOLDEN_KEY, goldenFrom, promotionGate, type GoldenRecord } from './ai-golden';

const FRESH_MS = 30_000;

/**
 * The stored side of the release channel (./ai-release). One small row of
 * platform state — no salon's data — read at most twice a minute and held in
 * memory, because `isOn` is asked on every customer message and must never
 * wait on the database or fail a reply: when the state cannot be read, a
 * feature is simply at the stage it ships in.
 */
@Injectable()
export class AiReleaseService implements OnModuleInit {
  private readonly logger = new Logger('AiRelease');
  private state: ReleaseState = EMPTY_RELEASE;
  private tests = new Set<string>();
  private readAt = 0;
  private reading: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() { void this.refresh(); }

  /** Live for this salon right now? Never throws, never waits. */
  isOn(feature: ReleaseFeature, tenantId: string | null | undefined): boolean {
    if (Date.now() - this.readAt > FRESH_MS) void this.refresh();
    return featureOn(this.state, feature, tenantId, this.tests);
  }

  /** One of the platform's own test accounts (or an extra one support listed)? For tools that must never touch a paying salon. */
  isTestAccount(tenantId: string | null | undefined): boolean {
    if (!tenantId) return false;
    if (Date.now() - this.readAt > FRESH_MS) void this.refresh();
    const id = tenantId.toLowerCase();
    return this.tests.has(id) || this.state.canary.includes(id);
  }

  /** The test accounts' ids — for tools that look for a conversation among them and nowhere else. */
  testAccountIds(): string[] {
    if (Date.now() - this.readAt > FRESH_MS) void this.refresh();
    return [...new Set([...this.tests, ...this.state.canary])];
  }

  private refresh(): Promise<void> {
    if (this.reading) return this.reading;
    this.reading = (async () => {
      try {
        const [row, salons] = await Promise.all([
          this.prisma.platformConfig.findUnique({ where: { key: RELEASE_KEY } }),
          canarySlugs().length
            ? this.prisma.tenant.findMany({ where: { slug: { in: canarySlugs() }, deletedAt: null }, select: { id: true } })
            : Promise.resolve([] as { id: string }[]),
        ]);
        this.state = cleanRelease(row?.value);
        this.tests = new Set(salons.map((s) => s.id.toLowerCase()));
      } catch (e) {
        this.logger.warn(`release state not read: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
      } finally {
        // Stamped even on a failure, so a database having a bad minute is not asked on every message.
        this.readAt = Date.now();
        this.reading = null;
      }
    })();
    return this.reading;
  }

  /** The build that is running (Render's commit), as the golden run records it. */
  private commit(): string { return (process.env.RENDER_GIT_COMMIT || 'dev').slice(0, 7); }

  private async golden(): Promise<GoldenRecord | null> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: GOLDEN_KEY } }).catch(() => null);
    return goldenFrom(row?.value);
  }

  async view() {
    await this.refresh();
    const ids = [...new Set([...this.tests, ...this.state.canary])];
    const names = ids.length
      ? await this.prisma.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, slug: true } }).catch(() => [])
      : [];
    // For each behaviour not yet on for every salon: may it be promoted now, and if not, why (./ai-golden).
    const record = await this.golden();
    const gate: Partial<Record<ReleaseFeature, string | null>> = {};
    for (const f of Object.keys(RELEASE_FEATURES) as ReleaseFeature[]) {
      if (stageOf(this.state, f) === 'on') continue;
      const g = promotionGate({ record, commit: this.commit(), feature: f, nowMs: Date.now() });
      gate[f] = g.ok ? null : g.vi;
    }
    return { features: releaseView(this.state), testAccounts: names, updatedAt: this.state.updatedAt, updatedBy: this.state.updatedBy, gate };
  }

  /** Move features between stages and/or set the extra test accounts. */
  async change(by: string, patch: { stages?: Partial<Record<ReleaseFeature, ReleaseStage>>; canary?: string[] }) {
    await this.refresh();
    const asked = cleanRelease({ stages: patch.stages ?? {}, canary: patch.canary ?? this.state.canary });
    // THE GATE (./ai-golden): a behaviour reaches every salon only on a passed
    // golden run of the build that is running, with that behaviour live on the
    // test accounts while it ran. Taking a behaviour away is never held up.
    const rising = (Object.keys(asked.stages) as ReleaseFeature[]).filter((f) => asked.stages[f] === 'on' && stageOf(this.state, f) !== 'on');
    if (rising.length) {
      const record = await this.golden();
      for (const f of rising) {
        const g = promotionGate({ record, commit: this.commit(), feature: f, nowMs: Date.now() });
        if (!g.ok) {
          this.logger.warn(`promotion of ${f} refused by ${by}: ${g.why}`);
          throw new ConflictException({ code: 'GOLDEN_GATE', feature: f, why: g.why, message: g.vi });
        }
      }
    }
    const next: ReleaseState = {
      stages: { ...this.state.stages, ...asked.stages },
      canary: patch.canary ? asked.canary : this.state.canary,
      updatedAt: new Date().toISOString(),
      updatedBy: by.slice(0, 80),
    };
    const value = JSON.stringify(next);
    await this.prisma.platformConfig.upsert({ where: { key: RELEASE_KEY }, create: { key: RELEASE_KEY, value }, update: { value } });
    this.state = next;
    this.readAt = Date.now();
    this.logger.log(`release changed by ${by}: ${JSON.stringify(next.stages)} canary=${next.canary.length}`);
    return this.view();
  }
}
