import { Injectable, Logger } from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { GoogleReviewsService, type GbpProfile } from '../google-reviews/google-reviews.service';
import { AuditService } from '../audit/audit.service';
import { toE164, dialCodeFor } from '../common/phone';
import { namesMatch } from '../google-reviews/location-match';
import { buildUpload, type FeedTenant } from './feed';
import { cleanForFeed, isAllCaps, lintTenant, titleCase, type TenantLint } from './feed-lint';

/**
 * GOOGLE "BOOK ONLINE" FOR EVERY SALON — the daily feed to Actions Center.
 *
 * Reads each eligible salon (active, Google-linked, button on), judges it with
 * the lint, builds the three feeds from the ones that pass, and uploads them to
 * Google's SFTP drop once a day. The agency sees, per salon, whether it is in
 * the feed and what to fix if not.
 *
 * Tenant isolation: every read is by tenant id from a list this service itself
 * builds from `tenant`; a salon's settings are read under its own id only; a
 * salon that is deleted, cancelled, suspended, unlinked or switched off is not
 * in the list, so it is in no feed. Nothing here writes to a salon's data
 * except the one explicit "fix the name" the agency asks for, which is audited.
 */

/** Per-salon switch and the cached Google listing. One setting row per tenant. */
export const GOOGLE_BOOK_KEY = 'google_book';
export const GBP_PROFILE_KEY = 'gbp_profile';
/** The last run, kept on the platform's own pseudo-tenant row is not possible (settings need a tenant) — kept in memory + logs. */

export interface GoogleBookSetting { enabled: boolean }
const DEFAULT: GoogleBookSetting = { enabled: true };

export interface RunReport { at: string; tenants: number; ready: number; held: number; files: string[]; uploaded: boolean; error?: string }

/** The salon's Google Maps listing — what Google's partner form asks for ("5 of your merchants' Business Profiles"). */
function mapsUrlOf(p: { mapsUri?: string | null; placeId?: string | null } | null | undefined): string | null {
  if (!p) return null;
  if (p.mapsUri) return p.mapsUri;
  if (p.placeId) return `https://www.google.com/maps/place/?q=place_id:${p.placeId}`;
  return null;
}

@Injectable()
export class GoogleBookService {
  private readonly logger = new Logger('GoogleBook');
  private lastRun: RunReport | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly google: GoogleReviewsService,
    private readonly audit: AuditService,
  ) {}

  private webUrl(): string { return (process.env.WEB_URL ?? process.env.NEXT_PUBLIC_WEB_URL ?? 'https://lumiobooking.com').replace(/\/$/, ''); }

  async getSetting(tenantId: string): Promise<GoogleBookSetting> {
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: GOOGLE_BOOK_KEY } } }).catch(() => null);
    return { ...DEFAULT, ...((row?.value ?? {}) as Partial<GoogleBookSetting>) };
  }

  async setEnabled(tenantId: string, enabled: boolean, userId: string): Promise<GoogleBookSetting> {
    const value = { enabled: Boolean(enabled) };
    await this.prisma.setting.upsert({ where: { tenantId_key: { tenantId, key: GOOGLE_BOOK_KEY } }, create: { tenantId, key: GOOGLE_BOOK_KEY, value }, update: { value } });
    await this.audit.log({ tenantId, userId, action: 'google_book.toggled', resourceType: 'setting', resourceId: GOOGLE_BOOK_KEY, metadata: value });
    return value;
  }

  /** The cached listing, refreshed from Google when older than a week (or forced). */
  async profile(tenantId: string, force = false): Promise<GbpProfile | null> {
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: GBP_PROFILE_KEY } } }).catch(() => null);
    const cached = (row?.value ?? null) as GbpProfile | null;
    const fresh = cached?.fetchedAt && Date.now() - Date.parse(cached.fetchedAt) < 7 * 86_400_000;
    if (cached && fresh && !force) return cached;
    const live = await this.google.fetchProfile(tenantId);
    if (!live) return cached;
    await this.prisma.setting.upsert({ where: { tenantId_key: { tenantId, key: GBP_PROFILE_KEY } }, create: { tenantId, key: GBP_PROFILE_KEY, value: live as never }, update: { value: live as never } }).catch(() => undefined);
    return live;
  }

  /** One salon as the feed sees it, plus what the lint says. Only this salon's rows are read. */
  async inspect(tenantId: string, opts: { refreshProfile?: boolean } = {}): Promise<{ tenant: FeedTenant; lint: TenantLint; profile: GbpProfile | null }> {
    const t = await this.prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { id: true, name: true, slug: true, status: true, contactPhone: true, timezone: true, market: true, businessType: true } as never }) as unknown as { id: string; name: string; slug: string; status: string; contactPhone: string | null; timezone: string; market?: string | null; businessType?: string | null } | null;
    if (!t) throw new Error('Salon not found');
    const [setting, extra, rules, deposit, gbr, profile, services] = await Promise.all([
      this.getSetting(tenantId),
      this.settings.getCompanyExtra(tenantId),
      this.settings.getBookingRules(tenantId),
      this.settings.getDepositSettings(tenantId),
      this.google.getSettings(tenantId),
      this.profile(tenantId, opts.refreshProfile),
      this.prisma.service.findMany({
        where: { tenantId },
        select: { id: true, name: true, description: true, priceCents: true, durationMinutes: true, isActive: true, category: { select: { name: true } }, ...({ walkInOnly: true, priceFrom: true } as object) } as never,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      }) as unknown as Promise<{ id: string; name: string; description: string | null; priceCents: number; durationMinutes: number; isActive: boolean; walkInOnly?: boolean; priceFrom?: boolean; category: { name: string } | null }[]>,
    ]);
    const dial = dialCodeFor(t.market ?? null, t.timezone ?? null);
    const phoneRaw = profile?.phone || t.contactPhone || '';
    const phone = phoneRaw ? (toE164(phoneRaw, dial) || phoneRaw) : null;
    const vi = (t.market ?? '').toUpperCase() === 'VN' || (t.timezone ?? '').startsWith('Asia/Ho_Chi_Minh');
    const feedTenant: FeedTenant = {
      id: t.id,
      slug: t.slug,
      name: t.name,
      listingName: profile?.title?.trim() || null,
      phone,
      website: profile?.website || extra.website || null,
      address: profile?.address ?? null,
      unstructuredAddress: extra.address || null,
      lat: profile?.lat ?? null,
      lng: profile?.lng ?? null,
      currency: rules.currency || 'USD',
      locale: vi ? 'vi' : 'en',
      cancelNoticeHours: rules.selfCancelEnabled ? rules.selfCancelNoticeHours : 0,
      depositRequired: Boolean(deposit.enabled && deposit.scope === 'all'),
      services: services.map((s) => ({
        id: s.id, name: s.name, description: s.description, priceCents: s.priceCents, durationMinutes: s.durationMinutes,
        category: s.category?.name ?? null, isActive: s.isActive, walkInOnly: Boolean(s.walkInOnly), priceFrom: Boolean(s.priceFrom),
      })),
    };
    const googleLinked = Boolean(gbr.connected && gbr.locationId);
    const googleMismatch = googleLinked && Boolean(gbr.locationTitle) && !namesMatch(gbr.locationTitle, t.name);
    const notAppointments = t.businessType === 'RESTAURANT' || t.businessType === 'REAL_ESTATE';
    const lint = lintTenant(feedTenant, { googleLinked, googleMismatch, notAppointments, enabled: setting.enabled && t.status === TenantStatus.ACTIVE });
    return { tenant: feedTenant, lint, profile };
  }

  /** Every live salon, inspected. The agency's readiness board. */
  async readiness(): Promise<{ id: string; name: string; slug: string; status: TenantLint['status']; feedable: number; issues: TenantLint['issues']; profileTitle: string | null; profileAt: string | null; mapsUrl: string | null }[]> {
    const rows = await this.prisma.tenant.findMany({ where: { deletedAt: null, status: TenantStatus.ACTIVE }, select: { id: true }, orderBy: { name: 'asc' }, take: 2000 });
    const out: Awaited<ReturnType<GoogleBookService['readiness']>> = [];
    for (const r of rows) {
      try {
        const { tenant, lint, profile } = await this.inspect(r.id);
        out.push({ id: tenant.id, name: tenant.name, slug: tenant.slug, status: lint.status, feedable: lint.feedable, issues: lint.issues, profileTitle: profile?.title ?? null, profileAt: profile?.fetchedAt ?? null, mapsUrl: mapsUrlOf(profile) });
      } catch (e) {
        this.logger.warn(`readiness: ${r.id}: ${String(e).slice(0, 120)}`);
      }
    }
    return out;
  }

  /** The six files of today's upload, built from the salons that pass. */
  async buildFeeds(now = new Date()): Promise<{ files: { name: string; body: string }[]; ready: string[]; held: string[] }> {
    const board = await this.readiness();
    const ready: FeedTenant[] = [];
    const held: string[] = [];
    for (const row of board) {
      if (row.status !== 'ready') { if (row.status === 'fix') held.push(row.id); continue; }
      const { tenant } = await this.inspect(row.id);
      ready.push(cleanForFeed(tenant).tenant);
    }
    return { files: buildUpload(ready, this.webUrl(), now), ready: ready.map((t) => t.id), held };
  }

  /**
   * The daily run: build, then upload over SFTP when the Partner Portal
   * credentials are configured (RWG_SFTP_HOST / RWG_SFTP_USER / RWG_SFTP_KEY,
   * key = private key PEM; RWG_SFTP_PORT optional). Without them the feeds are
   * only built — the agency can download them from the readiness screen.
   */
  async runDaily(now = new Date()): Promise<RunReport> {
    const report: RunReport = { at: now.toISOString(), tenants: 0, ready: 0, held: 0, files: [], uploaded: false };
    try {
      const { files, ready, held } = await this.buildFeeds(now);
      report.tenants = ready.length + held.length; report.ready = ready.length; report.held = held.length; report.files = files.map((f) => f.name);
      if (!ready.length) { report.error = 'no salon ready'; this.lastRun = report; return report; }
      const host = process.env.RWG_SFTP_HOST; const user = process.env.RWG_SFTP_USER; const key = process.env.RWG_SFTP_KEY;
      if (!host || !user || !key) { report.error = 'SFTP not configured'; this.lastRun = report; return report; }
      await this.sftpUpload({ host, user, key, port: Number(process.env.RWG_SFTP_PORT || 19321), dir: process.env.RWG_SFTP_DIR || '/' }, files);
      report.uploaded = true;
      this.logger.log(`Uploaded ${files.length} feed files for ${ready.length} salons (${held.length} held back).`);
    } catch (e) {
      report.error = String(e).slice(0, 300);
      this.logger.error(`Feed run failed: ${report.error}`);
    }
    this.lastRun = report;
    return report;
  }

  getLastRun(): RunReport | null { return this.lastRun; }

  private async sftpUpload(conn: { host: string; user: string; key: string; port: number; dir: string }, files: { name: string; body: string }[]): Promise<void> {
    // Loaded on demand so an environment without the library still boots.
    const modName = 'ssh2-sftp-client';
    const mod = (await import(modName)) as { default?: new () => SftpLike } & (new () => SftpLike);
    const Client = (mod.default ?? mod) as new () => SftpLike;
    const sftp = new Client();
    await sftp.connect({ host: conn.host, port: conn.port, username: conn.user, privateKey: conn.key.replace(/\\n/g, '\n') });
    try {
      // Data files first, descriptors last: Google reads the descriptor and expects its files to be there.
      const ordered = [...files.filter((f) => !f.name.includes('.filesetdesc.')), ...files.filter((f) => f.name.includes('.filesetdesc.'))];
      for (const f of ordered) await sftp.put(Buffer.from(f.body, 'utf8'), `${conn.dir.replace(/\/$/, '')}/${f.name}`);
    } finally {
      await sftp.end().catch(() => undefined);
    }
  }

  /** The one write the agency may ask for: a shouted name becomes Title Case. Audited. */
  async fixName(tenantId: string, userId: string): Promise<{ name: string }> {
    const t = await this.prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { id: true, name: true } });
    if (!t) throw new Error('Salon not found');
    // The Maps listing's own spelling wins when it is the same business and not shouted itself.
    const listing = (await this.profile(tenantId).catch(() => null))?.title?.trim() || '';
    const name = listing && namesMatch(listing, t.name) && !isAllCaps(listing) ? listing : titleCase(t.name);
    if (name !== t.name) {
      await this.prisma.tenant.update({ where: { id: tenantId }, data: { name } });
      await this.audit.log({ tenantId, userId, action: 'google_book.name_fixed', resourceType: 'tenant', resourceId: tenantId, metadata: { from: t.name, to: name } });
    }
    return { name };
  }

  /** Same for a service name — only a service of THIS salon. */
  async fixServiceName(tenantId: string, serviceId: string, userId: string): Promise<{ name: string }> {
    const s = await this.prisma.service.findFirst({ where: { id: serviceId, tenantId }, select: { id: true, name: true } });
    if (!s) throw new Error('Service not found');
    const name = titleCase(s.name);
    if (name !== s.name) {
      await this.prisma.service.update({ where: { id: serviceId }, data: { name } });
      await this.audit.log({ tenantId, userId, action: 'google_book.service_name_fixed', resourceType: 'service', resourceId: serviceId, metadata: { from: s.name, to: name } });
    }
    return { name };
  }
}

interface SftpLike {
  connect(o: { host: string; port: number; username: string; privateKey: string }): Promise<unknown>;
  put(data: Buffer, remotePath: string): Promise<unknown>;
  end(): Promise<unknown>;
}
