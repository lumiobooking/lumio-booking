/**
 * A group from the online booking page: the person who filled the form and
 * their friends, in ONE request. The friends used to be posted as separate
 * public bookings without a phone — and refused, every time. Now they ride on
 * the validated booking, server-side, with the same time and group, and only
 * this salon's services are ever accepted for them.
 */
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  TenantStatus: { ACTIVE: 'ACTIVE' },
}));
jest.mock('../payments/payments.service', () => ({ PaymentsService: class {} }));
jest.mock('../payments-hub/payment-orchestrator.service', () => ({ PaymentOrchestrator: class {} }));
import { BadRequestException } from '@nestjs/common';
import { PublicSalonController } from './public-salon.controller';

type Row = Record<string, any>;
const SERVICES: Row[] = [
  { id: 'gel', tenantId: 't1', isActive: true }, { id: 'pedi', tenantId: 't1', isActive: true },
  { id: 'theirs', tenantId: 't2', isActive: true },
];

function make(o: { failGuest?: string } = {}) {
  const created: Row[] = [];
  const prisma: any = {
    tenant: { findFirst: async () => ({ id: 't1', status: 'ACTIVE', billingExempt: true, accessUntil: null }) },
    service: { count: async ({ where }: Row) => SERVICES.filter((s) => s.tenantId === where.tenantId && s.isActive && where.id.in.includes(s.id)).length },
  };
  const bookings: any = {
    createForTenant: async (tenantId: string, dto: Row, actor: unknown, source: string, device: unknown, opts: Row) => {
      if (o.failGuest && dto.customerFirstName === o.failGuest) throw new Error('No slot');
      created.push({ tenantId, dto, source, opts });
      return { id: `ap${created.length}`, customerId: 'c1', priceCents: 5000 };
    },
  };
  const payments: any = { requiredDeposit: async () => 0, createForBookingTenant: async () => null };
  const settings: any = { getDepositSettings: async () => ({}) };
  const hub: any = { onlineProviderFor: async () => null };
  const ctl = new PublicSalonController(prisma, bookings, payments, settings, hub);
  return { ctl, created };
}

const base = {
  serviceId: 'gel', startTime: '2030-03-09T19:00:00.000Z', customerFirstName: 'Anna', customerPhone: '5125551234',
};

describe('online group booking', () => {
  it('books the person and every guest at the same time, in one group', async () => {
    const { ctl, created } = make();
    const r: any = await ctl.createBooking('glow', { ...base, guests: [{ firstName: 'Lisa', serviceIds: ['pedi'] }, { firstName: '', serviceIds: ['gel', 'pedi'] }] } as never);
    expect(created).toHaveLength(3);
    const [anna, lisa, guest3] = created;
    expect(anna.dto.customerPhone).toBe('5125551234');
    expect(anna.opts).toEqual({ autoAssign: true });
    expect(anna.dto.guests).toBeUndefined();
    for (const g of [lisa, guest3]) {
      expect(g.dto.customerPhone).toBeUndefined();
      expect(g.opts).toEqual({ autoAssign: true, groupGuest: true });
      expect(g.dto.startTime).toBe(base.startTime);
    }
    expect(guest3.dto.customerFirstName).toBe('Guest 3');
    expect(guest3.dto.serviceIds).toEqual(['gel', 'pedi']);
    const groups = new Set(created.map((c) => c.dto.groupId));
    expect(groups.size).toBe(1);
    expect([...groups][0]).toMatch(/^web-/);
    for (const c of created) { expect(c.dto.partySize).toBe(3); expect(c.tenantId).toBe('t1'); }
    expect(r.guests).toEqual([
      { name: 'Lisa', ok: true, id: 'ap2', priceCents: 5000 },
      { name: 'Guest 3', ok: true, id: 'ap3', priceCents: 5000 },
    ]);
  });

  it("a guest service from another salon books nobody", async () => {
    const { ctl, created } = make();
    await expect(ctl.createBooking('glow', { ...base, guests: [{ firstName: 'Lisa', serviceIds: ['theirs'] }] } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(created).toHaveLength(0);
  });

  it('one guest failing is reported, and never undoes the booking that was confirmed', async () => {
    const { ctl, created } = make({ failGuest: 'Lisa' });
    const r: any = await ctl.createBooking('glow', { ...base, guests: [{ firstName: 'Lisa', serviceIds: ['pedi'] }] } as never);
    expect(created).toHaveLength(1);
    expect(r.booking.id).toBe('ap1');
    expect(r.guests).toEqual([{ name: 'Lisa', ok: false, error: 'No slot' }]);
  });

  it('a single booking is unchanged — no group, no guests field', async () => {
    const { ctl, created } = make();
    const r: any = await ctl.createBooking('glow', base as never);
    expect(created).toHaveLength(1);
    expect(created[0].dto.groupId).toBeUndefined();
    expect(r.guests).toBeUndefined();
  });
});
