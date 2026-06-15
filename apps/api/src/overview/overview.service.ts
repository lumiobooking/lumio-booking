import { Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

const ACTIVE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.ASSIGNED,
  AppointmentStatus.ACCEPTED,
  AppointmentStatus.CONFIRMED,
];

@Injectable()
export class OverviewService {
  constructor(private readonly prisma: PrismaService) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /** Headline numbers + recent bookings for the Salon Admin overview page. */
  async stats(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

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

    // --- Resolve the date range (default: trailing 30 days, inclusive). ---
    const now = new Date();
    const endBase = toStr ? new Date(`${toStr}T00:00:00`) : now;
    const to = new Date(endBase.getFullYear(), endBase.getMonth(), endBase.getDate(), 23, 59, 59, 999);
    let from: Date;
    if (fromStr) {
      const f = new Date(`${fromStr}T00:00:00`);
      from = new Date(f.getFullYear(), f.getMonth(), f.getDate());
    } else {
      from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 29);
    }

    const [appts, payments, newCustomers, upcomingBookings] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { tenantId, startTime: { gte: from, lte: to } },
        select: {
          id: true,
          status: true,
          startTime: true,
          assignedStaffId: true,
          serviceId: true,
          assignedStaff: { select: { firstName: true, lastName: true } },
          service: { select: { name: true } },
        },
      }),
      this.prisma.payment.findMany({
        where: { tenantId, status: PaymentStatus.PAID, paidAt: { gte: from, lte: to } },
        select: {
          amountCents: true,
          paidAt: true,
          appointment: {
            select: {
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
    const revenueCents = payments.reduce((s, p) => s + p.amountCents, 0);
    const paidCount = payments.length;
    const avgBookingValueCents = paidCount > 0 ? Math.round(revenueCents / paidCount) : 0;
    const noShowRate = totalBookings > 0 ? noShow / totalBookings : 0;
    const completionRate = totalBookings > 0 ? completed / totalBookings : 0;

    // --- Per-day time series (bookings + revenue). Capped to keep payload small. ---
    const dayKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const bookingsByDay = new Map<string, number>();
    for (const a of appts) {
      const k = dayKey(new Date(a.startTime));
      bookingsByDay.set(k, (bookingsByDay.get(k) ?? 0) + 1);
    }
    const revenueByDay = new Map<string, number>();
    for (const p of payments) {
      if (!p.paidAt) continue;
      const k = dayKey(new Date(p.paidAt));
      revenueByDay.set(k, (revenueByDay.get(k) ?? 0) + p.amountCents);
    }
    const series: { date: string; bookings: number; revenueCents: number }[] = [];
    const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    let guard = 0;
    while (cursor <= to && guard < 370) {
      const k = dayKey(cursor);
      series.push({ date: k, bookings: bookingsByDay.get(k) ?? 0, revenueCents: revenueByDay.get(k) ?? 0 });
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    }

    // --- Top staff (bookings handled + revenue earned). ---
    const staffAgg = new Map<string, { name: string; bookings: number; revenueCents: number }>();
    const staffName = (s: { firstName: string; lastName: string | null } | null) =>
      s ? `${s.firstName} ${s.lastName ?? ''}`.trim() : 'Unassigned';
    for (const a of appts) {
      const id = a.assignedStaffId ?? 'unassigned';
      const entry = staffAgg.get(id) ?? { name: staffName(a.assignedStaff), bookings: 0, revenueCents: 0 };
      entry.bookings += 1;
      staffAgg.set(id, entry);
    }
    for (const p of payments) {
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
      .slice(0, 5);

    // --- Top services (bookings + revenue). ---
    const serviceAgg = new Map<string, { name: string; bookings: number; revenueCents: number }>();
    for (const a of appts) {
      const id = a.serviceId ?? 'unknown';
      const entry = serviceAgg.get(id) ?? { name: a.service?.name ?? '—', bookings: 0, revenueCents: 0 };
      entry.bookings += 1;
      serviceAgg.set(id, entry);
    }
    for (const p of payments) {
      const id = p.appointment?.serviceId ?? 'unknown';
      const entry = serviceAgg.get(id) ?? {
        name: p.appointment?.service?.name ?? '—',
        bookings: 0,
        revenueCents: 0,
      };
      entry.revenueCents += p.amountCents;
      serviceAgg.set(id, entry);
    }
    const topServices = [...serviceAgg.values()]
      .sort((a, b) => b.revenueCents - a.revenueCents || b.bookings - a.bookings)
      .slice(0, 5);

    return {
      range: { from: dayKey(from), to: dayKey(to) },
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
      series,
      topStaff,
      topServices,
      upcoming: upcomingBookings,
    };
  }
}
