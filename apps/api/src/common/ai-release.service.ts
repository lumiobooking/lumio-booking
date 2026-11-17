import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EMPTY_RELEASE, RELEASE_KEY, canarySlugs, cleanRelease, featureOn, releaseView, type ReleaseFeature, type ReleaseStage, type ReleaseState } from './ai-release';

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

  async view() {
    await this.refresh();
    const ids = [...new Set([...this.tests, ...this.state.canary])];
    const names = ids.length
      ? await this.prisma.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, slug: true } }).catch(() => [])
      : [];
    return { features: releaseView(this.state), testAccounts: names, updatedAt: this.state.updatedAt, updatedBy: this.state.updatedBy };
  }

  /** Move features between stages and/or set the extra test accounts. */
  async change(by: string, patch: { stages?: Partial<Record<ReleaseFeature, ReleaseStage>>; canary?: string[] }) {
    await this.refresh();
    const asked = cleanRelease({ stages: patch.stages ?? {}, canary: patch.canary ?? this.state.canary });
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
