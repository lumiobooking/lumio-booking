import { Injectable, Logger, Optional } from '@nestjs/common';
import { AiUsageService } from '../common/ai-usage.service';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { agentModel, forModel } from '../common/ai-model';
import {
  cleanPhash, forViewer, matchFingerprints, parseSeen, seenFindings,
  type FpRow, type GuardWarning, type MediaGuard, type SalonFacts,
} from './media-guard';

export interface GuardCtx {
  userId?: string | null;
  /** Lumio staff (support session / super admin): may see the other salon's name. */
  staff?: boolean;
  /** Perceptual hash computed in the browser. */
  phash?: string | null;
  /** Read the picture with the AI (images only). */
  read?: boolean;
}

type FpDelegate = {
  findMany(a: unknown): Promise<FpRow[]>;
  create(a: unknown): Promise<unknown>;
};

/** Anthropic reads these image types; HEIC and the rest are skipped. */
const AI_IMAGE = /^image\/(jpeg|png|webp|gif)$/;
const AI_MAX = 4_800_000;

/**
 * The server side of ./media-guard. Never throws and never blocks an upload:
 * a guard that breaks uploading would be switched off within the hour.
 */
@Injectable()
export class MediaGuardService {
  private readonly log = new Logger(MediaGuardService.name);
  constructor(private readonly prisma: PrismaService, @Optional() private readonly usage?: AiUsageService) {}

  private get fp(): FpDelegate {
    return (this.prisma as unknown as { mediaFingerprint: FpDelegate }).mediaFingerprint;
  }

  static sha256(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex');
  }

  /**
   * Check a file just stored for `tenantId` and remember it.
   * `buf` is given for the AI read; `sha256` alone is enough for the fingerprint.
   */
  async inspect(
    tenantId: string,
    file: { sha256: string; kind: 'image' | 'video'; mime: string; url?: string | null; buf?: Buffer | null },
    ctx: GuardCtx = {},
  ): Promise<MediaGuard> {
    const phash = cleanPhash(ctx.phash);
    const warnings: GuardWarning[] = [];
    let fingerprint = false;
    let picture = false;

    const [salons, matches] = await Promise.all([
      this.salons().catch(() => [] as SalonFacts[]),
      this.matches(tenantId, file.sha256, phash).then((m) => { fingerprint = true; return m; }).catch((e) => {
        this.log.warn(`fingerprint lookup failed: ${e instanceof Error ? e.message : e}`);
        return [];
      }),
    ]);
    const nameOf = (id?: string | null) => salons.find((s) => s.id === id)?.name;
    for (const m of matches.slice(0, 3)) {
      warnings.push({ kind: m.how, salon: nameOf(m.tenantId), at: m.at.toISOString() });
    }

    if (ctx.read !== false && file.kind === 'image' && file.buf && AI_IMAGE.test(file.mime) && file.buf.length <= AI_MAX) {
      const own = salons.find((s) => s.id === tenantId);
      if (own) {
        const seen = await this.read(file.buf, file.mime, tenantId).catch(() => null);
        if (seen) {
          picture = true;
          for (const f of seenFindings(seen, own, salons.filter((s) => s.id !== tenantId))) {
            warnings.push({ kind: f.kind, found: f.found, salon: nameOf(f.tenantId) });
          }
        }
      }
    }

    // Remember it whatever was found — the NEXT upload is compared against this one.
    await this.fp.create({
      data: { tenantId, userId: ctx.userId ?? null, sha256: file.sha256, phash, kind: file.kind, url: file.url ? String(file.url).slice(0, 500) : null },
    }).catch((e) => this.log.warn(`fingerprint save failed: ${e instanceof Error ? e.message : e}`));

    if (warnings.length) {
      await this.prisma.auditLog.create({
        data: { tenantId, userId: ctx.userId ?? null, action: 'media.wrong_salon_warning', resourceType: 'media', metadata: { kinds: warnings.map((w) => w.kind), url: file.url ?? null } as never },
      }).catch(() => undefined);
    }
    return forViewer({ sha256: file.sha256, warnings, checked: { fingerprint, picture } }, Boolean(ctx.staff));
  }

  /** The person looked and said "this IS the right salon". Audited. */
  async acknowledge(tenantId: string, userId: string | null, sha256: string): Promise<{ ok: true }> {
    await this.prisma.auditLog.create({
      data: { tenantId, userId, action: 'media.wrong_salon_ack', resourceType: 'media', metadata: { sha256: String(sha256 ?? '').slice(0, 64) } as never },
    }).catch(() => undefined);
    return { ok: true };
  }

  private async matches(tenantId: string, sha256: string, phash: string | null) {
    const [same, near] = await Promise.all([
      this.fp.findMany({ where: { sha256, NOT: { tenantId } }, select: { tenantId: true, sha256: true, phash: true, createdAt: true }, take: 20 }),
      phash
        ? this.fp.findMany({ where: { phash: { not: null }, NOT: { tenantId } }, select: { tenantId: true, sha256: true, phash: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 20_000 })
        : Promise.resolve([] as FpRow[]),
    ]);
    return matchFingerprints(tenantId, { sha256, phash }, [...same, ...near]);
  }

  private async salons(): Promise<SalonFacts[]> {
    const [ts, extras] = await Promise.all([
      this.prisma.tenant.findMany({ select: { id: true, name: true, slug: true, contactPhone: true } as never }) as unknown as Promise<{ id: string; name: string; slug: string; contactPhone: string | null }[]>,
      this.prisma.setting.findMany({ where: { key: 'company_extra' }, select: { tenantId: true, value: true } }).catch(() => []) as Promise<{ tenantId: string | null; value: unknown }[]>,
    ]);
    const site = new Map(extras.map((e) => [e.tenantId, String((e.value as { website?: string } | null)?.website ?? '') || null]));
    return ts.map((t) => ({ id: t.id, name: t.name, slug: t.slug, phone: t.contactPhone, website: site.get(t.id) ?? null }));
  }

  /** The visible text on a picture — names on signs, phone numbers, links. */
  private async read(buf: Buffer, mime: string, tenantId: string) {
    const key = process.env.ANTHROPIC_API_KEY || '';
    if (!key) return null;
    const model = agentModel();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(forModel({
        model,
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') } },
            { type: 'text', text: 'List only text that is clearly VISIBLE in this picture (signboards, logos, watermarks, posters, cards, screens). Do not guess. Reply with ONLY JSON: {"names":[business or brand names],"phones":[phone numbers],"links":[websites, @handles, booking links]}. Use [] when there is none.' },
          ],
        }],
      })),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { content?: { type?: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    this.usage?.record({ feature: 'media-guard', tenantId, model: (j as { model?: string }).model || model, input: Number(j.usage?.input_tokens ?? 0) || 0, output: Number(j.usage?.output_tokens ?? 0) || 0 });
    return parseSeen((j.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join(''));
  }
}
