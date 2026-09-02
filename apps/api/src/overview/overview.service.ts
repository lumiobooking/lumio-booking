import { Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, PaymentStatus, OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { addDaysToKey, dayKeyTz, dayRangeTz, hourTz, startOfDayTz, weekdayTz } from '../common/salon-time';

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
    // Staff revenue counts ONLY completed bookings, credited to the technician
    // who finally handled it (assignedStaffId already reflects any reassignment).
    for (const p of payments) {
      if (p.appointment?.status !== AppointmentStatus.COMPLETED) continue;
      const id = p.appointment?.assignedStaffId ?? 'unassigned';
      const entry = staffAgg.get(id) ?? {
        name: staffName(p.appointment?.assignedStaff ?? null),
        bookings: 0,
        revenueCents: 0,
      };
      entry.revenueCents += p.amountCents;
      staffAgg.set(id, entry);
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
      sourceRows: appts.map((a) => ({ source: a.source ?? null, utmSource: a.utmSource ?? null, attrReferrer: a.attrReferrer ?? null })),
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
}
