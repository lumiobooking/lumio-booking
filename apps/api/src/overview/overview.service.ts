import { loadLedger } from '../payroll/ledger-loader';
import { UNASSIGNED } from '../payroll/sales-ledger';
import { Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, PaymentStatus, OrderStatus, WalkInStatus, WaitlistStatus, GoogleReviewStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { addDaysToKey, dayKeyTz, dayRangeTz, hourTz, startOfDayTz, weekdayTz } from '../common/salon-time';

/** A walk-in waiting this long is called out on the home screen (same rule as the turns board). */
const LONG_WAIT_MINUTES = 10;

const ACTIVE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.ASSIGNED,
  AppointmentStatus.ACCEPTED,
  AppointmentStatus.CONFIRMED,
];

// Money tied to a cancelled/rejected booking is refunded/void and must never
// count as revenue. (No-show keeps its deposit, so NO_SHOW is NOT excluded.)
const REVENUE_EXCLUDED_STATUSES = new Set<string>([
  AppointmentStatus.CANCELLED,
  AppointmentStatus.REJECTED,
]);

@Injectable()
export class OverviewService {
  constructor(private readonly prisma: PrismaService) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /** The tenant's own timezone — every "today" and "this month" here is theirs. */
  private async tzOf(tenantId: string): Promise<string> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }).catch(() => null);
    return t?.timezone || 'UTC';
  }

  /** Headline numbers + recent bookings for the Salon Admin overview page. */
  async stats(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);

    const now = new Date();
    // "Today" and "this month" are the SALON's, not the server's: on a server
    // in another timezone the old headline rolled over mid-shift and showed
    // tomorrow's bookings before the owner had closed today.
    const tz = await this.tzOf(tenantId);
    const todayKey = dayKeyTz(now, tz);
    const startOfToday = startOfDayTz(todayKey, tz);
    const endOfToday = startOfDayTz(addDaysToKey(todayKey, 1), tz);
    const startOfMonth = startOfDayTz(`${todayKey.slice(0, 7)}-01`, tz);

    const [
      bookingsToday,
      pending,
      upcoming,
      revenueAgg,
      staffCount,
      servicesCount,
      customersCount,
      recentBookings,
    ] = await Promise.all([
      this.prisma.appointment.count({
        where: { tenantId, startTime: { gte: startOfToday, lt: endOfToday } },
      }),
      this.prisma.appointment.count({ where: { tenantId, status: AppointmentStatus.PENDING } }),
      this.prisma.appointment.count({
        where: { tenantId, status: { in: ACTIVE_STATUSES }, startTime: { gte: now } },
      }),
      this.prisma.payment.aggregate({
        _sum: { amountCents: true },
        where: { tenantId, status: PaymentStatus.PAID, paidAt: { gte: startOfMonth } },
      }),
      this.prisma.staffMember.count({ where: { tenantId, isActive: true } }),
      this.prisma.service.count({ where: { tenantId, isActive: true } }),
      this.prisma.customer.count({ where: { tenantId } }),
      this.prisma.appointment.findMany({
        where: { tenantId },
        select: {
          id: true,
          status: true,
          startTime: true,
          customer: { select: { firstName: true, lastName: true } },
          service: { select: { name: true } },
          assignedStaff: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

    return {
      bookingsToday,
      pending,
      upcoming,
      revenueThisMonthCents: revenueAgg._sum.amountCents ?? 0,
      staffCount,
      servicesCount,
      customersCount,
      recentBookings,
    };
  }

  /**
   * Rich Amelia-style dashboard for a date range: KPIs, a per-day time series,
   * status breakdown, top staff, top services and upcoming bookings.
   * Everything is strictly scoped to the authenticated tenant.
   */
  async dashboard(user: AuthenticatedUser, fromStr?: string, toStr?: string) {
    const tenantId = this.tenantId(user);

    // --- Resolve the date range (default: trailing 30 days, inclusive) — in
    // the SALON's days. Parsing "?to=2026-09-30" with the server's clock used
    // to cut the last afternoon off every report read across timezones. ---
    const now = new Date();
    const tz = await this.tzOf(tenantId);
    const { from, to, fromKey, toKey } = dayRangeTz(fromStr, toStr, tz, { now });

    const [appts, payments, newCustomers, upcomingBookings] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { tenantId, startTime: { gte: from, lte: to } },
        select: {
          id: true,
          status: true,
          startTime: true,
          assignedStaffId: true,
          serviceId: true,
          // Where each booking came from — the dashboard's source panel counts
          // these client-side with the same lib the calendar legend uses, so
          // both screens can never disagree about what "Messenger" means.
          source: true,
          utmSource: true,
          attrReferrer: true,
          // The third evidence layer. A Google Maps arrival can carry no utm
          // (the salon has not pasted the /gbp link yet) and no referrer (the
          // Maps app opens links in an in-app browser, which has none) — the
          // landing path is what is left. See common/booking-channel.ts.
          attrLandingUrl: true,
          assignedStaff: { select: { firstName: true, lastName: true } },
          service: { select: { name: true } },
        },
      }),
      this.prisma.payment.findMany({
        where: { tenantId, status: PaymentStatus.PAID, paidAt: { gte: from, lte: to } },
        select: {
          amountCents: true,
          paidAt: true,
          provider: true,
          type: true,
          appointment: {
            select: {
              status: true,
              assignedStaffId: true,
              serviceId: true,
              assignedStaff: { select: { firstName: true, lastName: true } },
              service: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.customer.count({ where: { tenantId, createdAt: { gte: from, lte: to } } }),
      this.prisma.appointment.findMany({
        where: { tenantId, status: { in: ACTIVE_STATUSES }, startTime: { gte: now } },
        select: {
          id: true,
          status: true,
          startTime: true,
          customer: { select: { firstName: true, lastName: true } },
          service: { select: { name: true } },
          assignedStaff: { select: { firstName: true, lastName: true } },
        },
        orderBy: { startTime: 'asc' },
        take: 6,
      }),
    ]);

    // --- KPIs ---
    const totalBookings = appts.length;
    const statusBreakdown: Record<string, number> = {};
    for (const a of appts) statusBreakdown[a.status] = (statusBreakdown[a.status] ?? 0) + 1;
    const completed = statusBreakdown[AppointmentStatus.COMPLETED] ?? 0;
    const noShow = statusBreakdown[AppointmentStatus.NO_SHOW] ?? 0;
    const cancelled =
      (statusBreakdown[AppointmentStatus.CANCELLED] ?? 0) +
      (statusBreakdown[AppointmentStatus.REJECTED] ?? 0);
    // Countable revenue = PAID payments NOT tied to a cancelled/rejected booking
    // (manual payments with no appointment are always counted).
    const countablePayments = payments.filter(
      (p) => !p.appointment || !REVENUE_EXCLUDED_STATUSES.has(p.appointment.status),
    );
    const revenueCents = countablePayments.reduce((s, p) => s + p.amountCents, 0);
    const paidCount = countablePayments.length;
    const avgBookingValueCents = paidCount > 0 ? Math.round(revenueCents / paidCount) : 0;

    // Revenue split by payment source/method (for the breakdown + filtering).
    const paymentMethods = { cash: 0, card: 0, transfer: 0, online: 0, onsite: 0 };
    for (const p of countablePayments) {
      const prov = p.provider || '';
      if (prov === 'pos-cash') paymentMethods.cash += p.amountCents;
      else if (prov === 'pos-card') paymentMethods.card += p.amountCents;
      else if (prov === 'pos-transfer') paymentMethods.transfer += p.amountCents;
      else if (p.type === 'PAY_ONLINE') paymentMethods.online += p.amountCents;
      else paymentMethods.onsite += p.amountCents; // booking paid at salon (Mark paid)
    }
    const noShowRate = totalBookings > 0 ? noShow / totalBookings : 0;
    const completionRate = totalBookings > 0 ? completed / totalBookings : 0;

    // --- Per-day time series (bookings + revenue), on the SALON's days. ---
    const bookingsByDay = new Map<string, number>();
    for (const a of appts) {
      const k = dayKeyTz(new Date(a.startTime), tz);
      bookingsByDay.set(k, (bookingsByDay.get(k) ?? 0) + 1);
    }
    const revenueByDay = new Map<string, number>();
    for (const p of countablePayments) {
      if (!p.paidAt) continue;
      const k = dayKeyTz(new Date(p.paidAt), tz);
      revenueByDay.set(k, (revenueByDay.get(k) ?? 0) + p.amountCents);
    }
    const series: { date: string; bookings: number; revenueCents: number }[] = [];
    let k = fromKey;
    let guard = 0;
    while (k <= toKey && guard < 370) {
      series.push({ date: k, bookings: bookingsByDay.get(k) ?? 0, revenueCents: revenueByDay.get(k) ?? 0 });
      k = addDaysToKey(k, 1);
      guard += 1;
    }

    // --- Demand shape: bookings by hour-of-day (0-23) and by weekday (0=Sun).
    // Uses the same clock as the series above; lets a salon see peak hours for
    // staffing and quiet slots worth a promotion. Only real demand counts, so
    // cancelled/no-show still count (the customer DID want that slot). ---
    const byHour = Array.from({ length: 24 }, () => 0);
    const byWeekday = Array.from({ length: 7 }, () => 0);
    for (const a of appts) {
      const d = new Date(a.startTime);
      byHour[hourTz(d, tz)] += 1;
      byWeekday[weekdayTz(d, tz)] += 1;
    }

    // --- Staff revenue: bookings handled + revenue earned, for EVERY active
    // technician (seeded at zero so no one is hidden — full, fair transparency). ---
    const staffName = (s: { firstName: string; lastName: string | null } | null) =>
      s ? `${s.firstName} ${s.lastName ?? ''}`.trim() : 'Unassigned';
    const activeStaff = await this.prisma.staffMember.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    });
    const staffAgg = new Map<string, { name: string; bookings: number; revenueCents: number }>();
    for (const s of activeStaff) staffAgg.set(s.id, { name: staffName(s), bookings: 0, revenueCents: 0 });
    for (const a of appts) {
      const id = a.assignedStaffId ?? 'unassigned';
      const entry = staffAgg.get(id) ?? { name: staffName(a.assignedStaff), bookings: 0, revenueCents: 0 };
      entry.bookings += 1;
      staffAgg.set(id, entry);
    }
    // Staff revenue = what each technician SOLD in the range, from the same
    // ledger payroll uses: walk-ins at the till included (they never had a
    // booking), ticket discounts taken off, tips and tax left out.
    const { ledger } = await loadLedger(this.prisma, tenantId, tz, from, to);
    for (const led of ledger.values()) {
      if (led.staffId === UNASSIGNED) continue;
      const entry = staffAgg.get(led.staffId);
      if (entry) entry.revenueCents += led.serviceCents + led.productCents;
    }
    const topStaff = [...staffAgg.values()]
      .sort((a, b) => b.revenueCents - a.revenueCents || b.bookings - a.bookings)
      .slice(0, 50);

    // --- Top services (bookings + revenue). ---
    const serviceAgg = new Map<string, { name: string; bookings: number; revenueCents: number }>();
    for (const a of appts) {
      const id = a.serviceId ?? 'unknown';
      const entry = serviceAgg.get(id) ?? { name: a.service?.name ?? 'Products / other', bookings: 0, revenueCents: 0 };
      entry.bookings += 1;
      serviceAgg.set(id, entry);
    }
    for (const p of countablePayments) {
      // Payments not tied to a booked service (POS product sales, gift cards, manual
      // "mark paid") group under one clear bucket instead of a nameless "—" row.
      const id = p.appointment?.serviceId ?? 'unknown';
      const entry = serviceAgg.get(id) ?? {
        name: p.appointment?.service?.name ?? 'Products / other',
        bookings: 0,
        revenueCents: 0,
      };
      entry.revenueCents += p.amountCents;
      serviceAgg.set(id, entry);
    }
    const topServices = [...serviceAgg.values()]
      .sort((a, b) => b.revenueCents - a.revenueCents || b.bookings - a.bookings)
      .slice(0, 5);

    // --- Counter markdowns -------------------------------------------------
    // Every till line sold below its list price. The POS stores these as
    // list price + discountCents (never as a cheaper service), so this is the
    // real amount given away at the counter — the number a salon owner needs to
    // see, because a free hand with the price button is invisible otherwise.
    const markdownItems = await this.prisma.orderItem.findMany({
      where: {
        tenantId,
        discountCents: { gt: 0 },
        createdAt: { gte: from, lte: to },
        order: { status: { in: [OrderStatus.PAID, OrderStatus.OPEN] } },
      },
      select: {
        name: true,
        quantity: true,
        unitPriceCents: true,
        discountCents: true,
        lineTotalCents: true,
        staffMemberId: true,
        createdAt: true,
      },
    });
    const mdStaffIds = Array.from(new Set(markdownItems.map((i) => i.staffMemberId).filter(Boolean))) as string[];
    const mdStaff = mdStaffIds.length
      ? await this.prisma.staffMember.findMany({ where: { tenantId, id: { in: mdStaffIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const mdStaffName = new Map(mdStaff.map((s2) => [s2.id, `${s2.firstName} ${s2.lastName ?? ''}`.trim()]));

    const byNameMap = new Map<string, { name: string; lines: number; listCents: number; chargedCents: number; discountCents: number }>();
    const byStaffMap = new Map<string, { staffId: string | null; name: string; lines: number; listCents: number; chargedCents: number; discountCents: number }>();
    let markdownTotal = 0;
    let markdownList = 0;
    for (const it of markdownItems) {
      const list = it.unitPriceCents * it.quantity;
      markdownTotal += it.discountCents;
      markdownList += list;
      const n = byNameMap.get(it.name) ?? { name: it.name, lines: 0, listCents: 0, chargedCents: 0, discountCents: 0 };
      n.lines += 1; n.listCents += list; n.chargedCents += it.lineTotalCents; n.discountCents += it.discountCents;
      byNameMap.set(it.name, n);
      const sid = it.staffMemberId ?? '';
      const st = byStaffMap.get(sid) ?? { staffId: it.staffMemberId ?? null, name: mdStaffName.get(sid) ?? 'Unassigned', lines: 0, listCents: 0, chargedCents: 0, discountCents: 0 };
      st.lines += 1; st.listCents += list; st.chargedCents += it.lineTotalCents; st.discountCents += it.discountCents;
      byStaffMap.set(sid, st);
    }
    const markdowns = {
      totalDiscountCents: markdownTotal,
      listValueCents: markdownList,
      chargedCents: Math.max(0, markdownList - markdownTotal),
      lines: markdownItems.length,
      // Share of what those lines were worth that was given away.
      discountRate: markdownList > 0 ? Math.round((markdownTotal / markdownList) * 1000) / 10 : 0,
      byService: Array.from(byNameMap.values()).sort((a, b) => b.discountCents - a.discountCents).slice(0, 10),
      byStaff: Array.from(byStaffMap.values()).sort((a, b) => b.discountCents - a.discountCents).slice(0, 10),
    };

    return {
      range: { from: fromKey, to: toKey },
      // Raw (source, utmSource) pairs — tiny, and the web's booking-sources
      // lib owns ALL classification rules in one place.
      sourceRows: appts.map((a) => ({
        source: a.source ?? null, utmSource: a.utmSource ?? null,
        attrReferrer: a.attrReferrer ?? null, attrLandingUrl: a.attrLandingUrl ?? null,
      })),
      kpis: {
        totalBookings,
        revenueCents,
        newCustomers,
        completed,
        noShow,
        cancelled,
        avgBookingValueCents,
        noShowRate,
        completionRate,
      },
      statusBreakdown,
      paymentMethods,
      byHour,
      byWeekday,
      series,
      topStaff,
      topServices,
      markdowns,
      upcoming: upcomingBookings,
    };
  }

  /**
   * The owner's home screen: what the dashboard shows, plus the previous
   * period of the same length (so every number can say "vs last week"), plus
   * what is happening on the floor right now and what needs a decision.
   *
   * Everything here is the authenticated tenant's own: every query carries
   * tenantId, and the live picture is built from that tenant's staff, walk-ins,
   * appointments, waitlist, reviews and products only.
   */
  async home(user: AuthenticatedUser, fromStr?: string, toStr?: string) {
    const tenantId = this.tenantId(user);
    const now = new Date();
    const tz = await this.tzOf(tenantId);
    const { fromKey, toKey } = dayRangeTz(fromStr, toStr, tz, { now, defaultDays: 1 });

    // The previous period: the same number of days, ending the day before.
    let days = 1;
    for (let k = fromKey, g = 0; k < toKey && g < 370; k = addDaysToKey(k, 1), g += 1) days += 1;
    const prevToKey = addDaysToKey(fromKey, -1);
    const prevFromKey = addDaysToKey(fromKey, -days);

    const [current, previous, live, tips, prevTips] = await Promise.all([
      this.dashboard(user, fromKey, toKey),
      this.periodKpis(tenantId, tz, prevFromKey, prevToKey, now),
      this.live(tenantId, tz, now),
      this.tipsFor(tenantId, tz, fromKey, toKey, now),
      this.tipsFor(tenantId, tz, prevFromKey, prevToKey, now),
    ]);

    return {
      ...current,
      tipsCents: tips,
      previous: { range: { from: prevFromKey, to: prevToKey }, kpis: previous, tipsCents: prevTips },
      ...live,
    };
  }

  /** The handful of headline numbers for a range — same revenue rules as dashboard(). */
  private async periodKpis(tenantId: string, tz: string, fromKey: string, toKey: string, now: Date) {
    const { from, to } = dayRangeTz(fromKey, toKey, tz, { now });
    const [appts, payments, newCustomers] = await Promise.all([
      this.prisma.appointment.findMany({ where: { tenantId, startTime: { gte: from, lte: to } }, select: { status: true } }),
      this.prisma.payment.findMany({
        where: { tenantId, status: PaymentStatus.PAID, paidAt: { gte: from, lte: to } },
        select: { amountCents: true, appointment: { select: { status: true } } },
      }),
      this.prisma.customer.count({ where: { tenantId, createdAt: { gte: from, lte: to } } }),
    ]);
    const countable = payments.filter((p) => !p.appointment || !REVENUE_EXCLUDED_STATUSES.has(p.appointment.status));
    const revenueCents = countable.reduce((sum, p) => sum + p.amountCents, 0);
    const completed = appts.filter((a) => a.status === AppointmentStatus.COMPLETED).length;
    return {
      totalBookings: appts.length,
      revenueCents,
      newCustomers,
      completed,
      paidCount: countable.length,
      avgBookingValueCents: countable.length ? Math.round(revenueCents / countable.length) : 0,
    };
  }

  /** Tips collected at the till in a range (what the technicians took home). */
  private async tipsFor(tenantId: string, tz: string, fromKey: string, toKey: string, now: Date): Promise<number> {
    const { from, to } = dayRangeTz(fromKey, toKey, tz, { now });
    const agg = await this.prisma.order.aggregate({
      _sum: { tipCents: true },
      where: { tenantId, status: OrderStatus.PAID, paidAt: { gte: from, lte: to } },
    });
    return agg._sum.tipCents ?? 0;
  }

  /**
   * The floor right now: one row per active technician (what they are doing,
   * or when their next booking is), today's booking counts, chairs in use, and
   * the short list of things waiting on the owner.
   */
  private async live(tenantId: string, tz: string, now: Date) {
    const todayKey = dayKeyTz(now, tz);
    const startOfToday = startOfDayTz(todayKey, tz);
    const endOfToday = startOfDayTz(addDaysToKey(todayKey, 1), tz);
    const LIVE_STATUSES: AppointmentStatus[] = [...ACTIVE_STATUSES, AppointmentStatus.ARRIVED];

    const [staff, todayAppts, serving, stations, pendingBookings, waitlist, reviews, lowStockRows, waitingRows] = await Promise.all([
      this.prisma.staffMember.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, firstName: true, lastName: true },
        orderBy: { firstName: 'asc' },
      }),
      this.prisma.appointment.findMany({
        where: { tenantId, startTime: { gte: startOfToday, lt: endOfToday }, status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.REJECTED] } },
        select: {
          id: true, status: true, startTime: true, endTime: true, assignedStaffId: true,
          customer: { select: { firstName: true, lastName: true } },
          service: { select: { name: true } },
        },
        orderBy: { startTime: 'asc' },
      }),
      this.prisma.walkIn.findMany({
        where: { tenantId, status: WalkInStatus.SERVING },
        select: { id: true, customerName: true, items: true, assignedStaffId: true, assignedAt: true, extraMinutes: true, awaitingPayment: true, service: { select: { name: true, durationMinutes: true } }, customer: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.station.count({ where: { tenantId, isActive: true } }),
      this.prisma.appointment.count({ where: { tenantId, status: AppointmentStatus.PENDING, startTime: { gte: now } } }),
      this.prisma.waitlistEntry.count({ where: { tenantId, status: WaitlistStatus.WAITING } }),
      this.prisma.googleReview.count({ where: { tenantId, status: { in: [GoogleReviewStatus.NEW, GoogleReviewStatus.DRAFTED, GoogleReviewStatus.NEEDS_ATTENTION] } } }),
      this.prisma.product.findMany({ where: { tenantId, isActive: true, trackStock: true, stockQty: { lte: 3 } }, select: { name: true, stockQty: true }, orderBy: { stockQty: 'asc' }, take: 5 }),
      // The walk-in queue, oldest first — the same set the turns board shows.
      this.prisma.walkIn.findMany({
        where: { tenantId, status: WalkInStatus.WAITING },
        select: { id: true, customerName: true, createdAt: true, customer: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const personName = (c: { firstName: string; lastName: string | null } | null | undefined, fallback: string) =>
      c ? `${c.firstName} ${c.lastName ?? ''}`.trim() : fallback;
    const walkInWhat = (w: (typeof serving)[number]) => {
      const items = Array.isArray(w.items) ? (w.items as { name?: string }[]).map((i) => i?.name).filter(Boolean) : [];
      return items.length ? items.join(' + ') : w.service?.name ?? '';
    };

    type Slot = { kind: 'walkin' | 'appointment'; id: string; customer: string; service: string; startTime: string; endTime: string | null; awaitingPayment: boolean; status: string };
    const rows = staff.map((s) => {
      const w = serving.find((x) => x.assignedStaffId === s.id);
      let current: Slot | null = null;
      if (w) {
        const started = w.assignedAt ?? now;
        const mins = (w.service?.durationMinutes ?? 45) + (w.extraMinutes ?? 0);
        current = {
          kind: 'walkin', id: w.id, customer: w.customerName || personName(w.customer, 'Walk-in'), service: walkInWhat(w),
          startTime: started.toISOString(), endTime: new Date(started.getTime() + mins * 60000).toISOString(),
          awaitingPayment: w.awaitingPayment, status: WalkInStatus.SERVING,
        };
      } else {
        const a = todayAppts.find((x) => x.assignedStaffId === s.id && LIVE_STATUSES.includes(x.status) && x.startTime <= now && x.endTime > now);
        if (a) current = { kind: 'appointment', id: a.id, customer: personName(a.customer, 'Khách'), service: a.service?.name ?? '', startTime: a.startTime.toISOString(), endTime: a.endTime.toISOString(), awaitingPayment: false, status: a.status };
      }
      const n = todayAppts.find((x) => x.assignedStaffId === s.id && LIVE_STATUSES.includes(x.status) && x.startTime > now);
      const next = n ? { id: n.id, customer: personName(n.customer, 'Khách'), service: n.service?.name ?? '', startTime: n.startTime.toISOString() } : null;
      return { staffId: s.id, name: `${s.firstName} ${s.lastName ?? ''}`.trim(), current, next };
    });
    // Whoever is waiting to pay first, then everyone busy, then the free chairs.
    rows.sort((a, b) => Number(!!b.current?.awaitingPayment) - Number(!!a.current?.awaitingPayment) || Number(!!b.current) - Number(!!a.current));

    const busy = rows.filter((r) => r.current).length;
    const awaitingPayment = serving.filter((w) => w.awaitingPayment).length;
    const completedToday = todayAppts.filter((a) => a.status === AppointmentStatus.COMPLETED).length;
    const upcomingToday = todayAppts.filter((a) => LIVE_STATUSES.includes(a.status) && a.startTime > now).length;
    const inProgress = todayAppts.filter((a) => LIVE_STATUSES.includes(a.status) && a.startTime <= now && a.endTime > now).length;

    // The strip across the top of the home screen: the floor in four numbers,
    // and the one client who has waited too long (if any).
    const hourAhead = new Date(now.getTime() + 60 * 60000);
    const nextHour = todayAppts.filter((a) => LIVE_STATUSES.includes(a.status) && a.startTime > now && a.startTime <= hourAhead).length;
    const oldest = waitingRows[0];
    const oldestMins = oldest ? Math.max(0, Math.floor((now.getTime() - oldest.createdAt.getTime()) / 60000)) : 0;
    const floor = {
      inService: serving.filter((w) => !w.awaitingPayment).length + inProgress,
      waiting: waitingRows.length,
      nextHour,
      freeTechs: Math.max(0, staff.length - busy),
      longestWait: oldest && oldestMins >= LONG_WAIT_MINUTES
        ? { id: oldest.id, name: oldest.customerName || personName(oldest.customer, 'Walk-in'), minutes: oldestMins }
        : null,
    };

    return {
      now: rows,
      floor,
      today: { bookings: todayAppts.length, completed: completedToday, inProgress, upcoming: upcomingToday, noShow: todayAppts.filter((a) => a.status === AppointmentStatus.NO_SHOW).length },
      chairs: { total: stations, busy, staff: staff.length },
      attention: {
        awaitingPayment,
        pendingBookings,
        waitlist,
        reviews,
        lowStock: lowStockRows.map((p) => ({ name: p.name, qty: p.stockQty })),
      },
    };
  }
}
