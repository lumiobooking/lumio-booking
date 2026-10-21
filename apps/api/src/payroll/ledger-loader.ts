import { AppointmentStatus, OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { bucketFor } from '../pos/payment-methods';
import { dayKeyTz } from '../common/salon-time';
import { buildLedger, LedgerRefund, StaffLedger } from './sales-ledger';

/**
 * Reads one salon's paid tickets and till-less completed bookings for
 * [from, to] and adds them up per technician (see sales-ledger.ts).
 *
 * Every query carries the caller's tenantId; nothing here can see another
 * salon's sales.
 */
export async function loadLedger(prisma: PrismaService, tenantId: string, tz: string, from: Date, to: Date): Promise<{
  ledger: Map<string, StaffLedger>;
  orderCount: number;
  extraVisits: number;
  orders: { id: string; changeCents: number; giftCardAppliedCents: number; tenders: { method: string; amountCents: number }[] }[];
}> {
  const [orders, appts] = await Promise.all([
    prisma.order.findMany({
      where: { tenantId, status: OrderStatus.PAID, paidAt: { gte: from, lte: to } },
      select: {
        id: true, paidAt: true, discountCents: true, changeCents: true, giftCardAppliedCents: true,
        items: { select: { kind: true, quantity: true, lineTotalCents: true, tipCents: true, staffMemberId: true } },
        tenders: { select: { method: true, amountCents: true } },
      },
    }),
    prisma.appointment.findMany({
      where: { tenantId, status: AppointmentStatus.COMPLETED, completedAt: { gte: from, lte: to } },
      select: { id: true, priceCents: true, assignedStaffId: true, completedAt: true },
    }),
  ]);

  // A booking closed by a paid ticket in ANY period is the ticket's sale, not
  // the booking's — checked against all tickets, not only this range's.
  const ids = appts.map((a) => a.id);
  const paidByTicket = new Set<string>();
  if (ids.length) {
    const closing = await prisma.order.findMany({
      where: { tenantId, status: OrderStatus.PAID, OR: [{ appointmentId: { in: ids } }, { appointmentIds: { hasSome: ids } }] },
      select: { appointmentId: true, appointmentIds: true },
    });
    for (const o of closing) {
      if (o.appointmentId) paidByTicket.add(o.appointmentId);
      for (const x of o.appointmentIds ?? []) paidByTicket.add(x);
    }
  }

  // Part refunds given back in the range (what came off which line).
  type RefundRow = { createdAt: Date; method: string; lines: unknown };
  const refundRows: RefundRow[] = await ((prisma as unknown as { orderRefund?: { findMany: (a: unknown) => Promise<RefundRow[]> } }).orderRefund
    ?.findMany({ where: { tenantId, full: false, createdAt: { gte: from, lte: to } }, select: { createdAt: true, method: true, lines: true } })
    .catch(() => [] as RefundRow[]) ?? Promise.resolve([] as RefundRow[]));
  const refunds: LedgerRefund[] = refundRows.map((r) => ({
    at: r.createdAt,
    card: bucketFor(r.method) === 'card',
    lines: (Array.isArray(r.lines) ? r.lines : []) as LedgerRefund['lines'],
  }));

  const ledger = buildLedger({
    refunds,
    orders: orders.map((o) => ({ ...o, items: o.items.map((l) => ({ ...l, kind: String(l.kind) })) })),
    appointments: appts,
    paidByTicket,
    dayOf: (d) => dayKeyTz(d, tz),
    bucket: (m) => bucketFor(m),
  });
  return {
    ledger,
    orderCount: orders.length,
    extraVisits: appts.filter((a) => !paidByTicket.has(a.id)).length,
    orders,
  };
}
