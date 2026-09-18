import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma, WalkInStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { displayBaseUrl, displayPairUrl } from '../common/public-url.util';
import { CustomersService } from '../customers/customers.service';
import { WalkinsService } from '../walkins/walkins.service';
import { liveEvents } from '../common/live-events';
import { dayKeyTz, weekdayTz } from '../common/salon-time';
import { WEEKDAY_DISCOUNTS_KEY, DATE_DISCOUNTS_KEY } from '../settings/settings.constants';
import { priceService, promoBanner, PromoSettings, SalonDay } from './checkin-pricing';

// Server-only split used to attribute the after-payment QR tip across the ticket's
// technician(s). Never exposed to the paired device.
type TechSplit = { staffMemberId: string; weightCents: number };
interface PayTicket {
  ref: string;
  baseCents: number;
  techs: TechSplit[];
}

@Injectable()
export class DisplayService {
  private readonly logger = new Logger('Display');

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    // Optional so the unit tests can build the service with a bare prisma.
    @Optional() private readonly walkins?: WalkinsService,
  ) {}

  /** Resolve a paired device's token to its tenant, or 404. */
  private async tenantOfToken(token: string): Promise<string> {
    const s = await this.prisma.displaySession.findUnique({ where: { token }, select: { tenantId: true } });
    if (!s) throw new NotFoundException('This device is no longer paired.');
    return s.tenantId;
  }

  /**
   * Kiosk: the salon's own name/branding + the menu the customer can pick from.
   * Public by design — the token is the credential and it only ever exposes what
   * a customer standing in the shop can already see on the wall.
   */
  async checkInMenu(token: string) {
    const tenantId = await this.tenantOfToken(token);
    const [tenant, services, promos] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, branding: true, timezone: true } }),
      this.prisma.service.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true, priceCents: true, discountPercent: true, isFeatured: true, durationMinutes: true, category: { select: { id: true, name: true } } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.promosOf(tenantId),
    ]);
    const b = (tenant?.branding ?? {}) as { logoUrl?: string; accentColor?: string };
    // Priced for TODAY in the salon's own timezone — the same rule as the
    // booking page and as the ticket selfCheckIn writes, see checkin-pricing.
    const day = await this.salonDay(tenantId, tenant?.timezone);
    const priced = services.map((sv) => priceService(sv, promos, day));
    const cats = new Map<string, string>();
    for (const sv of services) if (sv.category) cats.set(sv.category.id, sv.category.name);
    return {
      salonName: tenant?.name ?? '',
      logoUrl: b.logoUrl ?? null,
      accentColor: b.accentColor ?? '#6366f1',
      services: priced,
      /** Today's promotion, for the band at the top. Null when none runs. */
      promo: promoBanner(promos, day, [...cats].map(([id, name]) => ({ id, name }))),
    };
  }

  /** The salon's weekday and date promotions, read straight from settings. */
  private async promosOf(tenantId: string): Promise<PromoSettings> {
    // A promotion that cannot be read is a promotion that does not apply —
    // never a reason to stop a customer who is standing at the kiosk. So the
    // read is fenced whole, not just its promise: a client without this table
    // throws synchronously, and .catch alone would not have caught it.
    try {
      const rows = await this.prisma.setting.findMany({
        where: { tenantId, key: { in: [WEEKDAY_DISCOUNTS_KEY, DATE_DISCOUNTS_KEY] } },
        select: { key: true, value: true },
      });
      const byKey = new Map<string, unknown>(rows.map((r) => [r.key, r.value] as [string, unknown]));
      return {
        weekday: (byKey.get(WEEKDAY_DISCOUNTS_KEY) ?? null) as PromoSettings['weekday'],
        dates: (byKey.get(DATE_DISCOUNTS_KEY) ?? null) as PromoSettings['dates'],
      };
    } catch {
      return {};
    }
  }

  private async salonDay(tenantId: string, tz?: string | null): Promise<SalonDay> {
    let zone = tz ?? null;
    if (!zone) {
      try {
        const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
        zone = t?.timezone ?? null;
      } catch { zone = null; }
    }
    const now = new Date();
    const z = zone || 'America/Chicago';
    return { dayKey: dayKeyTz(now, z), weekday: weekdayTz(now, z) };
  }

  /**
   * Kiosk: the customer checks themselves in. The ticket lands in the WAITING
   * queue — never auto-assigned to a tech, because the front desk decides who
   * takes it. Staff can add or fix anything afterwards on the walk-in board.
   */
  async selfCheckIn(
    token: string,
    dto: { firstName?: string; lastName?: string; phone?: string; email?: string; birthDate?: string; serviceIds?: string[]; partySize?: number; note?: string },
  ) {
    const tenantId = await this.tenantOfToken(token);
    const name = (dto.firstName ?? '').trim().slice(0, 80);
    if (!name) throw new BadRequestException('Please enter your name.');

    // Only services that really belong to this salon and are on the menu.
    const ids = [...new Set(dto.serviceIds ?? [])].filter(Boolean).slice(0, 12);
    const [svcs, promos, day] = ids.length
      ? await Promise.all([
          this.prisma.service.findMany({
            where: { id: { in: ids }, tenantId, isActive: true },
            select: { id: true, name: true, priceCents: true, discountPercent: true, durationMinutes: true, category: { select: { id: true, name: true } } },
          }),
          this.promosOf(tenantId),
          this.salonDay(tenantId),
        ])
      : [[], {} as PromoSettings, { dayKey: '', weekday: -1 } as SalonDay];
    // The SAME price the kiosk just showed. Before this the screen printed the
    // list price and the ticket applied the discount, so a customer read $65
    // on the wall and $52 on the receipt; and the weekday promotion was never
    // applied to a walk-in at all, only to online bookings.
    const items = svcs.map((sv) => {
      const priced = priceService(sv, promos, day);
      return {
        lineId: randomBytes(12).toString('base64url'),
        serviceId: sv.id,
        name: sv.name,
        priceCents: priced.netCents,
        durationMinutes: sv.durationMinutes,
        staffId: null as string | null,
      };
    });

    // Build the CRM record so a self-served walk-in is remarketable like any other.
    const linked = (dto.phone?.trim() || dto.email?.trim())
      ? await this.customers.findOrCreateByContact(tenantId, {
          firstName: name, lastName: dto.lastName, phone: dto.phone, email: dto.email, birthDate: dto.birthDate,
        })
      : null;

    const walkIn = await this.prisma.walkIn.create({
      data: {
        tenantId,
        serviceId: svcs[0]?.id ?? null,
        customerId: linked?.id ?? null,
        customerName: `${name}${dto.lastName?.trim() ? ' ' + dto.lastName.trim() : ''}`.slice(0, 80),
        phone: dto.phone?.trim().slice(0, 40) || null,
        note: dto.note?.trim().slice(0, 300) || null,
        partySize: Math.max(1, Math.min(20, Math.round(dto.partySize ?? 1))),
        items: items as unknown as Prisma.InputJsonValue,
        source: 'walkin',
        status: WalkInStatus.WAITING,
      },
      select: { id: true },
    });
    // Straight onto the "up next" technician — the owner asked that a phone
    // check-in not sit as a WAITING card until somebody presses "Giao". Best
    // effort: if nobody is free, or the seating fails, the ticket simply waits.
    const staffId = this.walkins ? await this.walkins.seatSelfCheckIn(tenantId, walkIn.id).catch(() => null) : null;
    // The desk's board is polling; this makes it fetch now, while the
    // customer is still looking up from their phone.
    liveEvents.emit(tenantId, 'walkins', walkIn.id);
    return { ok: true, id: walkIn.id, queued: !staffId, seated: !!staffId };
  }

  private tid(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  // Long, unguessable secret the paired device uses to poll + post tips.
  private newToken(): string {
    return randomBytes(24).toString('base64url');
  }

  // Short, human-friendly code shown on the register to link a device once.
  // Excludes easily-confused characters (0/O, 1/I).
  private newPairCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(6);
    let code = '';
    for (let i = 0; i < 6; i++) code += alphabet[bytes[i] % alphabet.length];
    return code;
  }

  private info(s: { pairCode: string }) {
    return { pairCode: s.pairCode, pairUrl: displayPairUrl(s.pairCode), displayUrl: displayBaseUrl() };
  }

  /** Register: fetch (or lazily create) this salon's pairing info. */
  async getSession(user: AuthenticatedUser) {
    const tenantId = this.tid(user);
    const s = (await this.prisma.displaySession.findUnique({ where: { tenantId } })) ?? (await this.createSession(tenantId));
    return this.info(s);
  }

  /** Register: revoke the current link (old token/code stop working) and issue a new one. */
  async rotate(user: AuthenticatedUser) {
    const tenantId = this.tid(user);
    await this.prisma.displaySession.deleteMany({ where: { tenantId } });
    return this.info(await this.createSession(tenantId));
  }

  private async createSession(tenantId: string) {
    for (let i = 0; i < 6; i++) {
      try {
        return await this.prisma.displaySession.create({
          data: { tenantId, token: this.newToken(), pairCode: this.newPairCode() },
        });
      } catch (e) {
        // A concurrent create (same tenant) or a rare token/code clash — return the
        // existing row if present, else retry with fresh values.
        const existing = await this.prisma.displaySession.findUnique({ where: { tenantId } });
        if (existing) return existing;
        if (i === 5) throw e;
      }
    }
    throw new Error('Could not create display session');
  }

  /**
   * Register: store the latest display state. Tenant comes from the JWT — never the
   * client — so one salon can only ever write its own display. `payTicket` is kept
   * ONLY while a ticket is in the paid state, so a stray tip can't attach to nothing.
   */
  async pushState(user: AuthenticatedUser, state: Record<string, unknown>, payTicket?: Record<string, unknown>) {
    const tenantId = this.tid(user);
    const exists = await this.prisma.displaySession.findUnique({ where: { tenantId }, select: { id: true } });
    if (!exists) await this.createSession(tenantId);
    const isPaid = (state?.status as string | undefined) === 'paid';
    await this.prisma.displaySession.update({
      where: { tenantId },
      data: {
        state: state as unknown as Prisma.InputJsonValue,
        payTicket: isPaid && payTicket ? (payTicket as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
    return { ok: true };
  }

  /** Public: exchange a short pairing code for the long polling token. */
  async pair(pairCode: string) {
    const code = (pairCode || '').trim().toUpperCase();
    if (!code) throw new BadRequestException('Missing code');
    const s = await this.prisma.displaySession.findUnique({ where: { pairCode: code }, select: { token: true } });
    if (!s) throw new NotFoundException('That code is not valid. Check the register and try again.');
    return { token: s.token };
  }

  /** Public: the paired device polls the current customer-facing state (no secrets). */
  async stateByToken(token: string) {
    const s = await this.prisma.displaySession.findUnique({ where: { token }, select: { state: true, updatedAt: true } });
    if (!s) throw new NotFoundException('This screen is not linked. Re-pair it from the register.');
    return { state: s.state ?? null, at: s.updatedAt };
  }

  /**
   * Public: record an after-payment QR tip the customer chose on the paired device.
   * The tip goes straight to the tech (they scan the QR with their phone) — this only
   * LOGS it for payroll visibility. Tenant + techs come from the server-side pay ticket
   * (never the client), and it is idempotent per paid ticket so a re-tap can't double it.
   */
  async recordTip(token: string, amountCents: number) {
    const amount = Math.round(amountCents);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Invalid tip amount');
    const s = await this.prisma.displaySession.findUnique({ where: { token } });
    if (!s) throw new NotFoundException('This screen is not linked.');
    const pt = (s.payTicket as unknown as PayTicket | null) || null;
    if (!pt || !Array.isArray(pt.techs) || pt.techs.length === 0) return { ok: true, recorded: false };
    if (s.lastTipRef === pt.ref) return { ok: true, recorded: false };
    // Atomically claim this ticket ref so two quick taps record the tip only once.
    const claim = await this.prisma.displaySession.updateMany({
      where: { token, NOT: { lastTipRef: pt.ref } },
      data: { lastTipRef: pt.ref },
    });
    if (claim.count === 0) return { ok: true, recorded: false };

    const techs = pt.techs.filter((t) => t && t.staffMemberId);
    const totalW = techs.reduce((sum, t) => sum + Math.max(0, t.weightCents || 0), 0);
    let assigned = 0;
    for (let i = 0; i < techs.length; i++) {
      const last = i === techs.length - 1;
      const share = last
        ? Math.max(0, amount - assigned)
        : totalW > 0
          ? Math.round((amount * Math.max(0, techs[i].weightCents || 0)) / totalW)
          : Math.round(amount / techs.length);
      assigned += share;
      if (share <= 0) continue;
      // Defense in depth: the tech must belong to THIS session's tenant.
      const tech = await this.prisma.staffMember.findFirst({
        where: { id: techs[i].staffMemberId, tenantId: s.tenantId },
        select: { id: true },
      });
      if (!tech) continue;
      try {
        await this.prisma.tipLog.create({
          data: { tenantId: s.tenantId, staffMemberId: techs[i].staffMemberId, amountCents: share, method: 'QR' },
        });
      } catch (e) {
        this.logger.warn(`Display tip log failed: ${(e as Error).message}`);
      }
    }
    return { ok: true, recorded: true };
  }
}
