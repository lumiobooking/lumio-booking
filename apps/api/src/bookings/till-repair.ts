/**
 * A BOOKING PAID AT THE TILL THROUGH ITS FLOOR TICKET MUST SAY SO.
 *
 * Before 26/10/2026 two things went missing when a checked-in booking was
 * checked out from its floor ticket instead of from the booking itself:
 *  - the money rows (payments) were written without the booking, so its
 *    drawer read "Chưa thu" for a visit that was paid;
 *  - a different service sold at the till ("General Massage 90 mins" for a
 *    booked "60 mins") changed the booking's price and time but not its
 *    service, so it showed "60 mins" next to a 90-minute price.
 * pos.service now writes both. This repairs what was written before, once per
 * boot (idempotent). Every write is scoped to the order's own salon and only
 * touches a row that is still in the broken state.
 */

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type TillRepairDb = {
  payment: { findMany: (a: unknown) => Promise<Row[]>; updateMany: (a: unknown) => Promise<{ count: number }> };
  order: { findMany: (a: unknown) => Promise<Row[]> };
  appointment: { findMany: (a: unknown) => Promise<Row[]>; updateMany: (a: unknown) => Promise<{ count: number }> };
  service: { findMany: (a: unknown) => Promise<Row[]> };
};

/** The one booking an order settled, or null (none, or a party). */
export function soleBooking(o: { appointmentId?: string | null; appointmentIds?: string[] | null }): string | null {
  const ids = [...new Set([o.appointmentId, ...(o.appointmentIds ?? [])].filter((x): x is string => !!x))];
  return ids.length === 1 ? ids[0] : null;
}

/** The service the till sold instead of the booked one, or null when the booking already names it. */
export function soldInstead(bookedServiceId: string | null, lines: { kind: string; serviceId: string | null; lineTotalCents: number }[], bookingPriceCents: number): string | null {
  const svc = lines.filter((l) => l.kind === 'SERVICE');
  if (!svc.length || !svc[0].serviceId) return null;
  if (svc.some((l) => l.serviceId === bookedServiceId)) return null;
  // Only where the till's write-back happened (the booking carries the till's price).
  const total = svc.reduce((s, l) => s + (l.lineTotalCents ?? 0), 0);
  return total === bookingPriceCents ? svc[0].serviceId : null;
}

export async function repairTillLinks(db: TillRepairDb, now = new Date(), days = 90): Promise<{ payments: number; services: number }> {
  const since = new Date(now.getTime() - days * 86400000);
  let payments = 0;
  let services = 0;

  // 1) Money rows of a till sale that settled exactly one booking.
  const loose = await db.payment.findMany({
    where: { appointmentId: null, status: 'PAID', providerReference: { startsWith: 'order:' }, createdAt: { gte: since } },
    select: { id: true, tenantId: true, providerReference: true }, take: 20000,
  });
  const orderIds = [...new Set(loose.map((p) => String(p.providerReference).slice('order:'.length)).filter(Boolean))];
  const orders = orderIds.length
    ? await db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, tenantId: true, appointmentId: true, appointmentIds: true } })
    : [];
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const wanted = new Map<string, string>(); // payment id -> booking id
  for (const p of loose) {
    const o = orderById.get(String(p.providerReference).slice('order:'.length));
    if (!o || o.tenantId !== p.tenantId) continue;
    const b = soleBooking(o);
    if (b) wanted.set(p.id, b);
  }
  if (wanted.size) {
    const real = await db.appointment.findMany({ where: { id: { in: [...new Set(wanted.values())] } }, select: { id: true, tenantId: true } });
    const tenantOf = new Map(real.map((a) => [a.id, a.tenantId]));
    for (const p of loose) {
      const b = wanted.get(p.id);
      if (!b || tenantOf.get(b) !== p.tenantId) continue;
      const r = await db.payment.updateMany({ where: { id: p.id, tenantId: p.tenantId, appointmentId: null }, data: { appointmentId: b } });
      payments += r.count;
    }
  }

  // 2) Bookings that kept the booked service after the till sold another one.
  const paid = await db.order.findMany({
    where: { status: 'PAID', createdAt: { gte: since }, OR: [{ appointmentId: { not: null } }, { appointmentIds: { isEmpty: false } }] },
    select: { id: true, tenantId: true, appointmentId: true, appointmentIds: true, items: { select: { kind: true, serviceId: true, lineTotalCents: true } } },
    take: 20000,
  });
  const sole = paid.map((o) => ({ o, b: soleBooking(o) })).filter((x): x is { o: Row; b: string } => !!x.b);
  if (sole.length) {
    const appts = await db.appointment.findMany({
      where: { id: { in: [...new Set(sole.map((x) => x.b))] }, status: 'COMPLETED' },
      select: { id: true, tenantId: true, serviceId: true, priceCents: true },
    });
    const apptById = new Map(appts.map((a) => [a.id, a]));
    const fixes: { id: string; tenantId: string; from: string | null; to: string }[] = [];
    for (const { o, b } of sole) {
      const a = apptById.get(b);
      if (!a || a.tenantId !== o.tenantId) continue;
      const to = soldInstead(a.serviceId ?? null, o.items ?? [], a.priceCents);
      if (to) fixes.push({ id: a.id, tenantId: a.tenantId, from: a.serviceId ?? null, to });
    }
    if (fixes.length) {
      const exist = await db.service.findMany({ where: { id: { in: [...new Set(fixes.map((f) => f.to))] } }, select: { id: true, tenantId: true } });
      const svcTenant = new Map(exist.map((s) => [s.id, s.tenantId]));
      for (const f of fixes) {
        if (svcTenant.get(f.to) !== f.tenantId) continue;
        const r = await db.appointment.updateMany({ where: { id: f.id, tenantId: f.tenantId, serviceId: f.from }, data: { serviceId: f.to } });
        services += r.count;
      }
    }
  }
  return { payments, services };
}
