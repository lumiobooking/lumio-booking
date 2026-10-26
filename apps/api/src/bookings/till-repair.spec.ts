import { repairTillLinks, soldInstead, soleBooking } from './till-repair';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const svc = (serviceId: string | null, lineTotalCents: number) => ({ kind: 'SERVICE', serviceId, lineTotalCents });

describe('till repair — pure rules', () => {
  it('one booking per order, never a party', () => {
    expect(soleBooking({ appointmentId: 'b1', appointmentIds: ['b1'] })).toBe('b1');
    expect(soleBooking({ appointmentId: null, appointmentIds: ['b1', 'b2'] })).toBeNull();
    expect(soleBooking({ appointmentId: null, appointmentIds: [] })).toBeNull();
  });
  it('the service sold instead of the booked one, only where the till wrote its price back', () => {
    expect(soldInstead('m60', [svc('m90', 15000)], 15000)).toBe('m90');
    expect(soldInstead('m60', [svc('m60', 10000)], 10000)).toBeNull();
    expect(soldInstead('m60', [svc('m90', 15000)], 10000)).toBeNull(); // the booking never got the till's version
    expect(soldInstead('m60', [{ kind: 'PRODUCT', serviceId: null, lineTotalCents: 2000 }], 2000)).toBeNull();
  });
});

describe('repairTillLinks', () => {
  function db() {
    const payments: Row[] = [
      { id: 'p1', tenantId: 'A', appointmentId: null, status: 'PAID', providerReference: 'order:o1' }, // Renu, paid via her ticket
      { id: 'p2', tenantId: 'A', appointmentId: null, status: 'PAID', providerReference: 'order:o2' }, // a party: left alone
      { id: 'p3', tenantId: 'B', appointmentId: null, status: 'PAID', providerReference: 'order:o1' }, // another salon claiming A's order
    ];
    const orders: Row[] = [
      { id: 'o1', tenantId: 'A', status: 'PAID', appointmentId: 'b1', appointmentIds: ['b1'], items: [svc('m90', 15000)] },
      { id: 'o2', tenantId: 'A', status: 'PAID', appointmentId: 'b2', appointmentIds: ['b2', 'b3'], items: [svc('m90', 15000)] },
      { id: 'o3', tenantId: 'B', status: 'PAID', appointmentId: 'bA', appointmentIds: ['bA'], items: [svc('m90', 15000)] }, // B's order naming A's booking
    ];
    const appts: Row[] = [
      { id: 'b1', tenantId: 'A', serviceId: 'm60', priceCents: 15000, status: 'COMPLETED' },
      { id: 'bA', tenantId: 'A', serviceId: 'm60', priceCents: 15000, status: 'COMPLETED' },
    ];
    const services: Row[] = [{ id: 'm90', tenantId: 'A' }];
    const writes: Row[] = [];
    const inIds = (where: Row) => (where?.id?.in ?? null) as string[] | null;
    const d = {
      payment: {
        findMany: async () => payments,
        updateMany: async (a: Row) => { writes.push({ payment: a }); const p = payments.find((x) => x.id === a.where.id && x.tenantId === a.where.tenantId && x.appointmentId === null); if (p) p.appointmentId = a.data.appointmentId; return { count: p ? 1 : 0 }; },
      },
      order: { findMany: async ({ where }: Row) => (inIds(where) ? orders.filter((o) => inIds(where)!.includes(o.id)) : orders) },
      appointment: {
        findMany: async ({ where }: Row) => appts.filter((a) => inIds(where)!.includes(a.id) && (!where.status || a.status === where.status)),
        updateMany: async (a: Row) => { writes.push({ appointment: a }); const x = appts.find((y) => y.id === a.where.id && y.tenantId === a.where.tenantId && y.serviceId === a.where.serviceId); if (x) x.serviceId = a.data.serviceId; return { count: x ? 1 : 0 }; },
      },
      service: { findMany: async ({ where }: Row) => services.filter((s) => inIds(where)!.includes(s.id)) },
    };
    return { d, payments, appts, writes };
  }

  it('links the paid money and names the service sold — only inside the order\'s own salon', async () => {
    const { d, payments, appts } = db();
    const r = await repairTillLinks(d as never, new Date('2026-10-26T12:00:00Z'));
    expect(r).toEqual({ payments: 1, services: 1 });
    expect(payments.find((p) => p.id === 'p1')!.appointmentId).toBe('b1');
    expect(payments.find((p) => p.id === 'p2')!.appointmentId).toBeNull(); // party
    expect(payments.find((p) => p.id === 'p3')!.appointmentId).toBeNull(); // other salon
    expect(appts.find((a) => a.id === 'b1')!.serviceId).toBe('m90');
    expect(appts.find((a) => a.id === 'bA')!.serviceId).toBe('m60'); // B's order never edits A's booking
  });
  it('runs twice without changing anything the second time', async () => {
    const { d } = db();
    await repairTillLinks(d as never);
    expect(await repairTillLinks(d as never)).toEqual({ payments: 0, services: 0 });
  });
});
