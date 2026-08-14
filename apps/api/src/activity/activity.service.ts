import { Injectable } from '@nestjs/common';
import { formatMoneyShort } from '../common/money';
import { AppointmentStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type ActivityType = 'booking' | 'cancel' | 'payment' | 'report';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  customer: string;
  detail: string; // service name, or the paid amount for a payment
  at: string; // ISO timestamp of when the event happened (booked/cancelled/paid)
  when: string | null; // the appointment's start time (ISO) for booking/cancel events
  appointmentId: string | null; // the booking this event points to (null for POS-only payments)
  link?: string | null; // in-app page to open when the event is not a booking
}

/**
 * In-app activity feed. Instead of a new table + writing an event on every
 * action, we DERIVE the feed from existing rows: each appointment yields a
 * "booking" event (at createdAt) and, if cancelled, a "cancel" event (at
 * cancelledAt); each PAID payment yields a "payment" event. Tenant-scoped.
 * No migration required.
 */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  private nameOf(c: { firstName: string; lastName: string | null } | null | undefined): string {
    if (!c) return 'Khách';
    return [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || 'Khách';
  }

  async feed(tenantId: string, limit = 50): Promise<ActivityItem[]> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const appts = await this.prisma.appointment.findMany({
      where: { tenantId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 150,
      select: {
        id: true,
        createdAt: true,
        cancelledAt: true,
        status: true,
        startTime: true,
        customer: { select: { firstName: true, lastName: true } },
        service: { select: { name: true } },
      },
    });

    // Month-end marketing reports drafted automatically — otherwise a salon
    // never learns a draft is sitting in review.
    const reports = await this.prisma.marketingReport.findMany({
      where: { tenantId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { id: true, periodMonth: true, status: true, createdAt: true },
    });

    const pays = await this.prisma.payment.findMany({
      where: { tenantId, status: PaymentStatus.PAID, paidAt: { gte: since } },
      orderBy: { paidAt: 'desc' },
      take: 80,
      select: {
        id: true,
        amountCents: true,
        currency: true,
        paidAt: true,
        appointmentId: true,
        appointment: { select: { customer: { select: { firstName: true, lastName: true } } } },
      },
    });

    const items: ActivityItem[] = [];

    for (const a of appts) {
      const cust = this.nameOf(a.customer);
      const detail = a.service?.name ?? 'Đặt chỗ';
      const when = a.startTime ? a.startTime.toISOString() : null;
      items.push({ id: 'b_' + a.id, type: 'booking', customer: cust, detail, at: a.createdAt.toISOString(), when, appointmentId: a.id });
      if (a.cancelledAt && (a.status === AppointmentStatus.CANCELLED || a.status === AppointmentStatus.NO_SHOW)) {
        items.push({ id: 'c_' + a.id, type: 'cancel', customer: cust, detail, at: a.cancelledAt.toISOString(), when, appointmentId: a.id });
      }
    }

    for (const p of pays) {
      if (!p.paidAt) continue;
      let amt: string;
      try {
        // Same hundredfold bug: a 200,000₫ payment showed in the feed as ₫2,000.
        amt = formatMoneyShort(p.amountCents, p.currency || 'USD', 'en-US');
      } catch {
        amt = '$' + Math.round(p.amountCents / 100);
      }
      items.push({ id: 'p_' + p.id, type: 'payment', customer: this.nameOf(p.appointment?.customer), detail: amt, at: p.paidAt.toISOString(), when: null, appointmentId: p.appointmentId ?? null });
    }

    for (const r of reports) {
      const [y, m] = r.periodMonth.split('-').map((x) => parseInt(x, 10));
      const label = y && m
        ? new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
        : r.periodMonth;
      items.push({
        id: 'r_' + r.id,
        type: 'report',
        customer: label,
        detail: r.status, // 'review' | 'approved' | 'sent' — the UI words it per language
        at: r.createdAt.toISOString(),
        when: null,
        appointmentId: null,
        link: `/salon/marketing/monthly?month=${r.periodMonth}`,
      });
    }

    items.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
    return items.slice(0, limit);
  }
}
