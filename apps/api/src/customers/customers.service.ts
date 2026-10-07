import { profileFrom } from '../common/customer-profile';
import { cleanIndustryFields, fieldsFor } from '../common/industry-fields';
import { dueFollowUps, todayIn, type LeadRow } from './follow-ups';
import { alertsFor, idList, samePhone, type AlertRow } from './record-alerts';
import { normalizeImportRow, phoneTail, type ImportIn } from './import-rows';
import { CONTACTED_KEY, pruneContacted, recallList, type RecallRow } from './recall-list';
import { recallMonthsOf } from '../bookings/recall';
import { INDUSTRY_KEY, resolveIndustry } from '../common/industry';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TrashService } from '../maintenance/trash.service';
import { dialCodeFor, toE164 } from '../common/phone';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly trash: TrashService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /** The salon's industry (common/industry), for its customer record fields. */
  private async industryOf(tenantId: string): Promise<string> {
    const [t, row] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { businessType: true } }).catch(() => null),
      this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: INDUSTRY_KEY } } }).catch(() => null),
    ]);
    return resolveIndustry(row?.value ?? null, (t as { businessType?: string } | null)?.businessType ?? null);
  }

  /** Leads whose "call back" date has come (customers/follow-ups.ts) — THIS office only. */
  async followUps(user: AuthenticatedUser) {
    return this.followUpsForTenant(this.tenantId(user));
  }

  async followUpsForTenant(tenantId: string, now = new Date()) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }).catch(() => null);
    const today = todayIn(t?.timezone, now);
    const rows = (await this.prisma.customer.findMany({
      where: { tenantId },
      select: { id: true, firstName: true, lastName: true, phone: true, industryFields: true } as never,
      take: 5000,
    }).catch(() => [])) as unknown as LeadRow[];
    return { today, items: dueFollowUps(rows, today) };
  }

  /**
   * Warning fields (allergies, dietary needs, sensitivities) for the desk:
   * by a phone being typed into the booking form, or for a list of customer
   * ids on the arrivals board. One salon's customers only.
   */
  async recordAlerts(user: AuthenticatedUser, q: { phone?: string; ids?: string }) {
    const tenantId = this.tenantId(user);
    const select = { id: true, phone: true, industryFields: true } as never;
    let rows: (AlertRow & { phone?: string | null })[] = [];
    const ids = idList(q.ids);
    if (ids.length) {
      rows = (await this.prisma.customer.findMany({ where: { tenantId, id: { in: ids } }, select })) as unknown as AlertRow[];
    } else if (q.phone && q.phone.replace(/\D/g, '').length >= 7) {
      const digits = q.phone.replace(/\D/g, '');
      const found = (await this.prisma.customer.findMany({ where: { tenantId, phone: { contains: digits.slice(-7) } }, select, take: 20 })) as unknown as (AlertRow & { phone: string | null })[];
      rows = found.filter((r) => samePhone(q.phone as string, r.phone));
    }
    if (!rows.length) return { items: [] };
    const industry = await this.industryOf(tenantId);
    return { items: alertsFor(industry, rows) };
  }

  /**
   * A dental clinic's recall list (customers/recall-list.ts): patients due
   * for their check-up with nothing booked. Other trades: empty. One clinic only.
   */
  async recalls(user: AuthenticatedUser, now = new Date()) {
    const tenantId = this.tenantId(user);
    if ((await this.industryOf(tenantId)) !== 'DENTAL') return { items: [] };
    const custs = (await this.prisma.customer.findMany({
      where: { tenantId },
      select: { id: true, firstName: true, lastName: true, phone: true, rebookRemindedAt: true, industryFields: true } as never,
      take: 5000,
    })) as unknown as { id: string; firstName: string; lastName: string | null; phone: string | null; rebookRemindedAt: Date | null; industryFields: unknown }[];
    const withRecall = custs.map((c) => ({ c, months: recallMonthsOf(c.industryFields) })).filter((x) => x.months !== null).slice(0, 2000);
    if (!withRecall.length) return { items: [] };
    const ids = withRecall.map((x) => x.c.id);
    const [done, upcoming, row] = await Promise.all([
      this.prisma.appointment.findMany({ where: { tenantId, customerId: { in: ids }, status: 'COMPLETED' }, select: { customerId: true, endTime: true }, orderBy: { endTime: 'desc' } }),
      this.prisma.appointment.findMany({ where: { tenantId, customerId: { in: ids }, startTime: { gt: now }, status: { in: ['PENDING', 'ASSIGNED', 'ACCEPTED', 'CONFIRMED'] } }, select: { customerId: true } }),
      this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: CONTACTED_KEY } } }),
    ]);
    const last = new Map<string, Date>();
    for (const a of done) if (a.customerId && !last.has(a.customerId)) last.set(a.customerId, a.endTime);
    const booked = new Set(upcoming.map((a) => a.customerId));
    const rows: RecallRow[] = withRecall.map(({ c, months }) => ({
      id: c.id, name: `${c.firstName}${c.lastName ? ' ' + c.lastName : ''}`.trim(), phone: c.phone, months: months as number,
      lastVisitEnd: last.get(c.id) ?? null, hasUpcoming: booked.has(c.id), remindedAt: c.rebookRemindedAt ?? null,
    }));
    return { items: recallList(rows, now, pruneContacted(row?.value, now)) };
  }

  /** "Đã liên hệ": hide this patient from the recall list for 14 days. */
  async markRecallContacted(user: AuthenticatedUser, customerId: string, now = new Date()) {
    const tenantId = this.tenantId(user);
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } });
    if (!c) throw new NotFoundException('Customer not found');
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: CONTACTED_KEY } } });
    const next = { ...pruneContacted(row?.value, now), [c.id]: now.toISOString() };
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: CONTACTED_KEY } },
      update: { value: next as never }, create: { tenantId, key: CONTACTED_KEY, value: next as never },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'customer.recall_contacted', resourceType: 'customer', resourceId: c.id });
    return { ok: true };
  }

  /**
   * NHẬP KHÁCH CŨ — a chunk (≤1000) of the salon's old client list
   * (customers/import-rows.ts). A row matching an existing client by phone
   * (last 9 digits) or email fills what is missing and records the old
   * system's history; otherwise a client is created. Points from the old
   * system are credited ONCE per client (a re-import updates history but never
   * adds points again). SMS marketing consent is taken only when the row says
   * so AND the owner attested it. One salon only. Owner only (controller).
   */
  async importCustomers(user: AuthenticatedUser, dto: { rows?: unknown[]; source?: string; consentAttested?: boolean }, now = new Date()) {
    const tenantId = this.tenantId(user);
    const rows = Array.isArray(dto.rows) ? dto.rows.slice(0, 1000) : [];
    const source = String(dto.source ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'CSV';
    type Ex = { id: string; lastName: string | null; phone: string | null; email: string | null; birthDate: Date | null; notes: string | null; smsConsent: boolean; importedAt: Date | null };
    const existing = (await this.prisma.customer.findMany({
      where: { tenantId },
      select: { id: true, lastName: true, phone: true, email: true, birthDate: true, notes: true, smsConsent: true, importedAt: true } as never,
      take: 50_000,
    })) as unknown as Ex[];
    const byPhone = new Map<string, Ex>(); const byEmail = new Map<string, Ex>();
    const index = (c: Ex) => { const t = phoneTail(c.phone); if (t && !byPhone.has(t)) byPhone.set(t, c); if (c.email) byEmail.set(c.email.toLowerCase(), c); };
    existing.forEach(index);

    const out = { created: 0, updated: 0, skipped: 0, pointsAdded: 0, pointsSkipped: 0, errors: [] as { row: number; reason: string }[] };
    for (let i = 0; i < rows.length; i++) {
      const r = normalizeImportRow((rows[i] ?? {}) as ImportIn);
      if (!r) { out.skipped++; if (out.errors.length < 50) out.errors.push({ row: i + 1, reason: 'no name, phone or email' }); continue; }
      const match = (r.phone ? byPhone.get(phoneTail(r.phone)) : undefined) ?? (r.email ? byEmail.get(r.email) : undefined) ?? null;
      const consent = r.smsOptIn && dto.consentAttested === true;
      const history = {
        ...(r.spentCents ? { importedSpentCents: r.spentCents } : {}),
        ...(r.visits ? { importedVisits: r.visits } : {}),
        ...(r.lastVisitAt ? { lastVisitAt: r.lastVisitAt } : {}),
        importSource: source, importedAt: now,
      };
      try {
        if (match) {
          const wasImported = Boolean(match.importedAt);
          const data: Record<string, unknown> = { ...history };
          if (!match.lastName && r.lastName) data.lastName = r.lastName;
          if (!match.phone && r.phone) data.phone = r.phone;
          if (!match.email && r.email && !byEmail.has(r.email)) data.email = r.email;
          if (!match.birthDate && r.birthDate) data.birthDate = r.birthDate;
          if (r.notes && !(match.notes ?? '').includes(r.notes)) data.notes = [match.notes, r.notes].filter(Boolean).join('\n').slice(0, 2000);
          if (consent && !match.smsConsent) { data.smsConsent = true; data.smsConsentAt = now; }
          await this.prisma.customer.updateMany({ where: { id: match.id, tenantId }, data: data as never });
          if (r.points) {
            if (wasImported) out.pointsSkipped++;
            else out.pointsAdded += await this.creditPoints(tenantId, match.id, r.points, `Imported from ${source}`, 'import');
          }
          match.importedAt = now; if (data.email) { match.email = r.email; index(match); } if (data.phone) { match.phone = r.phone; index(match); }
          out.updated++;
        } else {
          const email = r.email && !byEmail.has(r.email) ? r.email : null;
          const c = (await this.prisma.customer.create({
            data: {
              tenantId, firstName: r.firstName, lastName: r.lastName, phone: r.phone, email, birthDate: r.birthDate, notes: r.notes,
              ...history, ...(consent ? { smsConsent: true, smsConsentAt: now } : {}),
            } as never,
            select: { id: true },
          })) as { id: string };
          if (r.points) out.pointsAdded += await this.creditPoints(tenantId, c.id, r.points, `Imported from ${source}`, 'import');
          index({ id: c.id, lastName: r.lastName, phone: r.phone, email, birthDate: r.birthDate, notes: r.notes, smsConsent: consent, importedAt: now });
          out.created++;
        }
      } catch (e) {
        out.skipped++;
        if (out.errors.length < 50) out.errors.push({ row: i + 1, reason: String((e as Error)?.message ?? e).slice(0, 120) });
      }
    }
    await this.audit.log({ tenantId, userId: user.userId, action: 'customers.imported', resourceType: 'tenant', resourceId: tenantId, metadata: { source, rows: rows.length, created: out.created, updated: out.updated, skipped: out.skipped, consentAttested: dto.consentAttested === true } });
    return out;
  }

  /** Add (or, negative, take away) points with a ledger line; the balance never goes below 0. */
  private async creditPoints(tenantId: string, customerId: string, points: number, reason: string, refType: string): Promise<number> {
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { loyaltyPoints: true } });
    if (!c) return 0;
    const balanceAfter = Math.max(0, c.loyaltyPoints + points);
    const delta = balanceAfter - c.loyaltyPoints;
    if (!delta) return 0;
    await this.prisma.customer.updateMany({ where: { id: customerId, tenantId }, data: { loyaltyPoints: balanceAfter } });
    await this.prisma.loyaltyTransaction.create({ data: { tenantId, customerId, points: delta, balanceAfter, reason: reason.slice(0, 200), refType, refId: customerId } });
    return delta;
  }

  /** "Cộng / trừ điểm" by hand, with a reason. Owner only (controller). */
  async adjustPoints(user: AuthenticatedUser, id: string, dto: { points: number; reason?: string }) {
    const tenantId = this.tenantId(user);
    const c = await this.prisma.customer.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!c) throw new NotFoundException('Customer not found');
    const pts = Math.round(Number(dto.points));
    if (!Number.isFinite(pts) || pts === 0) throw new BadRequestException('Enter the points to add or remove.');
    const delta = await this.creditPoints(tenantId, id, pts, (dto.reason ?? '').trim() || (pts > 0 ? 'Added by the salon' : 'Removed by the salon'), 'manual');
    await this.audit.log({ tenantId, userId: user.userId, action: 'customer.points_adjusted', resourceType: 'customer', resourceId: id, metadata: { points: delta } });
    return this.getById(user, id);
  }

  /** The record fields this salon's industry keeps on a customer, for the form. */
  async industryFieldDefs(user: AuthenticatedUser) {
    const industry = await this.industryOf(this.tenantId(user));
    return { industry, ...fieldsFor(industry) };
  }

  /** List the salon's customers, newest first, with booking + no-show counts. */
  async list(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const customers = await this.prisma.customer.findMany({
      where: { tenantId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        createdAt: true,
        birthDate: true,
        loyaltyPoints: true,
        _count: { select: { appointments: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    // No-show count per customer (drives the "repeat no-show" risk flag).
    const grouped = await this.prisma.appointment.groupBy({
      by: ['customerId'],
      where: { tenantId, status: 'NO_SHOW' },
      _count: { _all: true },
    });
    const noShowById = new Map(grouped.map((g) => [g.customerId, g._count._all]));
    // The line-of-business record (a real-estate lead's stage shows in the list).
    // Read on its own, typed loosely: a dev machine's client may predate the column.
    const recs = (await this.prisma.customer.findMany({
      where: { tenantId, id: { in: customers.map((c) => c.id) } },
      select: { id: true, industryFields: true } as never,
    }).catch(() => [])) as unknown as { id: string; industryFields?: unknown }[];
    const recById = new Map(recs.map((r) => [r.id, r.industryFields]));
    return customers.map((c) => ({ ...c, noShowCount: noShowById.get(c.id) ?? 0, industryFields: (recById.get(c.id) ?? {}) as Record<string, string | number> }));
  }

  /** Typeahead for the POS/front desk: match by name or phone. Tenant-scoped. */
  async search(user: AuthenticatedUser, q: string) {
    const tenantId = this.tenantId(user);
    const term = (q ?? '').trim();
    if (term.length < 2) return [];
    const digits = term.replace(/[^\d]/g, '');
    const select = { id: true, firstName: true, lastName: true, phone: true, email: true, loyaltyPoints: true } as const;
    const or: Prisma.CustomerWhereInput[] = [
      { firstName: { contains: term, mode: 'insensitive' } },
      { lastName: { contains: term, mode: 'insensitive' } },
    ];
    if (term.includes('@')) or.push({ email: { contains: term, mode: 'insensitive' } });
    if (digits.length >= 3) or.push({ phone: { contains: digits } });
    // A full number finds the person however it was typed back then:
    // "+1 512-523-5123", "15125235123" and "5125235123" are the same customer.
    if (digits.length >= 7) or.push({ phone: { contains: digits.slice(-7) } });
    const rows = await this.prisma.customer.findMany({ where: { tenantId, OR: or }, select, orderBy: { createdAt: 'desc' }, take: 30 });
    let keep = rows;
    if (digits.length >= 7) {
      const dial = await this.dialFor(tenantId);
      const want = toE164(term, dial);
      const low = term.toLowerCase();
      keep = rows.filter((r) =>
        `${r.firstName} ${r.lastName ?? ''}`.toLowerCase().includes(low)
        || (r.phone ?? '').replace(/\D/g, '').includes(digits)
        || (!!want && toE164(r.phone, dial) === want));
    }
    return keep.slice(0, 8);
  }

  /** The salon's calling code: its country, else its timezone. */
  private async dialFor(tenantId: string): Promise<string> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { market: true, timezone: true } }).catch(() => null);
    return dialCodeFor(t?.market ?? null, t?.timezone ?? null);
  }

  /**
   * This salon's customer with this phone number, however either side was
   * written (with or without +1 / 0, spaces, dashes). Only ever inside one salon.
   */
  private async findByPhone(tenantId: string, raw: string) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 7) return null;
    const dial = await this.dialFor(tenantId);
    const want = toE164(raw, dial);
    const rows = await this.prisma.customer.findMany({
      where: { tenantId, phone: { contains: digits.slice(-7) } },
      select: { id: true, firstName: true, email: true, phone: true, birthDate: true },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    return rows.find((r) => r.phone === raw)
      ?? rows.find((r) => !!want && toE164(r.phone, dial) === want)
      ?? null;
  }

  /** Front-desk quick-add (POS): find-or-create by phone/email, return a brief. */
  async quickCreate(
    user: AuthenticatedUser,
    dto: { firstName?: string; lastName?: string; phone?: string; email?: string; birthDate?: string },
  ) {
    const tenantId = this.tenantId(user);
    const c = await this.findOrCreateByContact(tenantId, dto);
    if (!c) throw new BadRequestException('A phone number or email is required to add a customer.');
    await this.audit.log({ tenantId, userId: user.userId, action: 'customer.created', resourceType: 'customer', resourceId: c.id });
    return c;
  }

  private normPhone(p?: string | null): string | null {
    const v = (p ?? '').replace(/[^\d+]/g, '');
    return v.replace(/\D/g, '').length >= 7 ? v : null;
  }

  /**
   * Find an existing customer by phone (the salon's natural key), else by email,
   * else create one. Returns a brief, or null when there's nothing to key on
   * (no phone and no email — we don't create anonymous duplicates). Backfills
   * missing name/phone/email on an existing row without overwriting good data.
   */
  async findOrCreateByContact(
    tenantId: string,
    input: { firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null; birthDate?: string | null },
  ) {
    const phone = this.normPhone(input.phone);
    const email = (input.email ?? '').trim().toLowerCase() || null;
    const firstName = (input.firstName ?? '').trim().slice(0, 80) || 'Walk-in';
    const lastName = (input.lastName ?? '').trim().slice(0, 80) || null;
    // Optional birthday — only used if valid. Saved on create; backfilled onto an
    // existing customer only when they don't already have one (never overwrite).
    const birth = (() => {
      if (!input.birthDate) return null;
      const d = new Date(input.birthDate);
      return isNaN(d.getTime()) ? null : d;
    })();

    let existing = phone ? await this.findByPhone(tenantId, phone) : null;
    // Emails were not always stored lower-case — match them the way people read them.
    const byEmail = (e: string) => this.prisma.customer.findFirst({ where: { tenantId, email: { equals: e, mode: 'insensitive' } }, select: { id: true, firstName: true, email: true, phone: true, birthDate: true } });
    if (!existing && email) existing = await byEmail(email);
    if (existing) {
      const patch: Record<string, unknown> = {};
      if (phone && !existing.phone) patch.phone = phone;
      // Backfill the email only when no OTHER customer of this salon already has
      // it. The phone matched one person and the email another: writing it here
      // broke the (tenantId, email) unique key and the till showed
      // "Internal server error" on "Lưu khách".
      if (email && !existing.email) {
        const other = await byEmail(email);
        if (!other || other.id === existing.id) patch.email = email;
      }
      if ((!existing.firstName || existing.firstName === 'Walk-in') && firstName !== 'Walk-in') patch.firstName = firstName;
      if (birth && !existing.birthDate) patch.birthDate = birth;
      if (Object.keys(patch).length) await this.prisma.customer.updateMany({ where: { id: existing.id, tenantId }, data: patch });
      return this.brief(tenantId, existing.id);
    }
    if (!phone && !email) return null; // nothing to dedupe on → skip
    try {
      const created = await this.prisma.customer.create({ data: { tenantId, firstName, lastName, phone, email, birthDate: birth }, select: { id: true } });
      return this.brief(tenantId, created.id);
    } catch (e) {
      // Two tills saving the same new customer at once: the second one gets the first one's row.
      if ((e as { code?: string })?.code === 'P2002' && email) {
        const again = await byEmail(email);
        if (again) return this.brief(tenantId, again.id);
      }
      throw e;
    }
  }

  private brief(tenantId: string, id: string) {
    return this.prisma.customer.findFirst({
      where: { id, tenantId },
      select: { id: true, firstName: true, lastName: true, phone: true, email: true, loyaltyPoints: true },
    });
  }

  /** A single customer with their full history: bookings + payments + totals. */
  async getById(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        notes: true,
        birthDate: true,
        createdAt: true,
        loyaltyPoints: true,
        loyaltyTransactions: {
          select: { id: true, points: true, balanceAfter: true, reason: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 30,
        },
        appointments: {
          select: {
            id: true,
            status: true,
            startTime: true,
            service: { select: { name: true } },
            assignedStaff: { select: { firstName: true, lastName: true } },
            payments: { select: { id: true, amountCents: true, currency: true, status: true, type: true, createdAt: true } },
          },
          orderBy: { startTime: 'desc' },
          take: 100,
        },
      },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    // Till sales for this customer. A walk-in (and any retail sale) never has an
    // appointment, so counting only appointment payments showed a regular
    // customer as "$0.00 spent, no visits" — the money was in the salon's
    // reports but nowhere on their profile.
    const orders = await this.prisma.order.findMany({
      where: { tenantId, customerId: id, status: OrderStatus.PAID },
      select: {
        id: true, orderNumber: true, createdAt: true, currency: true,
        totalCents: true, tipCents: true, appointmentId: true,
        items: { select: { id: true, name: true, quantity: true, lineTotalCents: true, staffMemberId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Lifetime spend = money actually collected, counted once. An order raised
    // FROM a booking already produced that booking's payment rows, so those
    // orders are excluded here instead of being added twice.
    const payments = customer.appointments.flatMap((a) => a.payments);
    const apptSpent = payments.filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amountCents, 0);
    const orderSpent = orders.filter((o) => !o.appointmentId).reduce((s, o) => s + o.totalCents, 0);
    const totalSpentCents = apptSpent + orderSpent;

    const completed = customer.appointments.filter((a) => a.status === 'COMPLETED').length;
    const noShows = customer.appointments.filter((a) => a.status === 'NO_SHOW').length;
    // A visit is a completed booking OR a walk-in sale at the till.
    const walkInSales = orders.filter((o) => !o.appointmentId);
    const lastApptVisit = customer.appointments[0]?.startTime ?? null;
    const lastSale = walkInSales[0]?.createdAt ?? null;
    const lastVisit = lastApptVisit && lastSale
      ? (lastApptVisit > lastSale ? lastApptVisit : lastSale)
      : (lastApptVisit ?? lastSale);

    // Her habits — favourite services, usual technician, usual day/time (common/customer-profile).
    const tz = (await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }).catch(() => null))?.timezone ?? null;
    const profile = profileFrom([
      ...customer.appointments.filter((a) => a.status === 'COMPLETED').map((a) => ({
        at: a.startTime, services: [a.service?.name ?? ''].filter(Boolean),
        staff: a.assignedStaff ? a.assignedStaff.firstName : null,
        priceCents: a.payments.filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amountCents, 0) || null,
      })),
      ...walkInSales.map((o) => ({ at: o.createdAt, services: o.items.map((i) => i.name), staff: null, priceCents: o.totalCents })),
    ], tz);

    // Read on its own (typed loosely): the generated client on a dev machine may predate the column.
    const rec = await this.prisma.customer.findFirst({
      where: { id, tenantId },
      select: { industryFields: true, importedSpentCents: true, importedVisits: true, lastVisitAt: true, importSource: true, importedAt: true, smsConsent: true } as never,
    }).catch(() => null) as { industryFields?: unknown; importedSpentCents?: number; importedVisits?: number; lastVisitAt?: Date | null; importSource?: string | null; importedAt?: Date | null; smsConsent?: boolean } | null;
    // What the client spent and how often they came in the salon's previous system.
    const past = { spentCents: rec?.importedSpentCents ?? 0, visits: rec?.importedVisits ?? 0, lastVisitAt: rec?.lastVisitAt ?? null, source: rec?.importSource ?? null, importedAt: rec?.importedAt ?? null };

    return {
      ...customer,
      industryFields: (rec?.industryFields && typeof rec.industryFields === 'object' ? rec.industryFields : {}) as Record<string, string | number>,
      orders,
      profile,
      stats: {
        bookings: customer.appointments.length,
        completed,
        noShows,
        // Every paid visit, whether it started as a booking or a walk-in.
        // The old system's history counts too (shown apart as `past`).
        visits: completed + walkInSales.length + past.visits,
        walkInSales: walkInSales.length,
        totalSpentCents: totalSpentCents + past.spentCents,
        lastVisit: lastVisit && past.lastVisitAt ? (lastVisit > past.lastVisitAt ? lastVisit : past.lastVisitAt) : (lastVisit ?? past.lastVisitAt),
      },
      past,
      smsConsent: rec?.smsConsent ?? false,
    };
  }

  /** Edit a customer's profile (birthday + basic contact fields). Tenant-scoped. */
  async update(
    user: AuthenticatedUser,
    id: string,
    dto: { birthDate?: string | null; firstName?: string; lastName?: string | null; email?: string | null; phone?: string | null; notes?: string | null; industryFields?: Record<string, unknown>; pastSpentCents?: number; pastVisits?: number; lastVisitAt?: string | null },
  ) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.customer.findFirst({ where: { id, tenantId }, select: { id: true, industryFields: true } as never }) as { id: string; industryFields?: unknown } | null;
    if (!existing) throw new NotFoundException('Customer not found');
    const data: Record<string, unknown> = {};
    if ('birthDate' in dto) {
      const v = dto.birthDate ? new Date(dto.birthDate) : null;
      data.birthDate = v && !isNaN(v.getTime()) ? v : null;
    }
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName || null;
    if (dto.email !== undefined) data.email = dto.email || null;
    if (dto.phone !== undefined) data.phone = dto.phone || null;
    if (dto.notes !== undefined) data.notes = dto.notes || null;
    // History from the old system, entered by hand (same fields the import fills).
    if (dto.pastSpentCents !== undefined) data.importedSpentCents = Math.max(0, Math.round(Number(dto.pastSpentCents) || 0));
    if (dto.pastVisits !== undefined) data.importedVisits = Math.max(0, Math.round(Number(dto.pastVisits) || 0));
    if ('lastVisitAt' in dto) { const v = dto.lastVisitAt ? new Date(dto.lastVisitAt) : null; data.lastVisitAt = v && !isNaN(v.getTime()) ? v : null; }
    // The line-of-business record: only THIS salon's industry's own fields.
    if (dto.industryFields !== undefined) {
      data.industryFields = cleanIndustryFields(await this.industryOf(tenantId), dto.industryFields, existing.industryFields);
    }
    // Scope the write by tenantId too (a forged id can't touch another tenant).
    await this.prisma.customer.updateMany({ where: { id, tenantId }, data: data as never });
    await this.audit.log({ tenantId, userId: user.userId, action: 'customer.updated', resourceType: 'customer', resourceId: id });
    return this.getById(user, id);
  }

  /** Delete a customer (and, by cascade, their appointments). Admin only. */
  async remove(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.customer.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Customer not found');

    // A customer takes their appointments and loyalty ledger with them, so all
    // three go into the bin together — restoring a customer without their
    // history would be worse than not restoring at all.
    const appts = await this.prisma.appointment.findMany({ where: { tenantId, customerId: id } });
    const loyalty = await this.prisma.loyaltyTransaction.findMany({ where: { tenantId, customerId: id } });
    const label = `${existing.firstName} ${existing.lastName ?? ''}`.trim() + (existing.phone ? ` · ${existing.phone}` : '');

    await this.prisma.$transaction(async (tx) => {
      await this.trash.capture(tx, {
        tenantId, entity: 'customer', entityId: id, label,
        snapshot: { customer: existing, appointments: appts, loyalty },
        deletedByUserId: user.userId,
      });
      // deleteMany with tenantId is a safety net so a forged id can't touch another tenant.
      await tx.customer.deleteMany({ where: { id, tenantId } });
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'customer.deleted', resourceType: 'customer', resourceId: id });
    return { id, deleted: true };
  }
}
