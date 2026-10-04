/**
 * "Me and my sister, acrylic full sets, Saturday at 1" — the chat bot books the
 * whole group in one call: the guests first (no contact of their own), the
 * customer last (the one confirmation), one group id, the same start time.
 * A guest whose service cannot be found books nobody, and nothing crosses
 * from one salon's menu into another's.
 */
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  AppointmentStatus: { CANCELLED: 'CANCELLED' },
}));
import { MessengerService } from './messenger.service';

type Row = Record<string, any>;
const MENUS: Record<string, { id: string; name: string }[]> = {
  t1: [{ id: 'acr', name: 'Acrylic Full Set' }, { id: 'fill', name: 'Acrylic Fill' }, { id: 'pedi', name: 'Pedicure' }],
  t2: [{ id: 'other', name: 'Hair Coloring' }],
};

function makeSvc(o: { failOn?: number } = {}) {
  const created: Row[] = [];
  const updates: Row[] = [];
  const wheres: Row[] = [];
  const prisma = {
    service: { findMany: async (a: { where: Row }) => { wheres.push(a.where); return MENUS[a.where.tenantId] ?? []; } },
    appointment: { updateMany: async (a: Row) => { updates.push(a); return { count: 1 }; } },
    messengerThread: { update: async () => ({}) },
    tenant: { findUnique: async () => ({ market: 'US' }) },
  };
  const bookings = {
    createForTenant: async (tenantId: string, dto: Row, actor: unknown, source: string, device: unknown, opts: Row) => {
      if (o.failOn && created.length + 1 === o.failOn) throw new Error('A phone number is required to book.');
      created.push({ tenantId, dto, source, opts });
      return { id: `ap${created.length}`, customerId: null, endTime: new Date(dto.startTime) };
    },
    buildApptManageUrl: (id: string) => `https://x.test/appt/${id}`,
    autoAssignForTenant: async () => ({}),
  };
  const settings = { getBookingRules: async () => ({ assignmentMode: 'manual' }) };
  const svc = new MessengerService(prisma as never, bookings as never, settings as never, {} as never, {} as never, {} as never);
  const tool = (input: Row) => (svc as unknown as { runTool: (...a: unknown[]) => Promise<string> })
    .runTool('t1', 'America/Chicago', 'create_booking', input, { mode: 'booking', leadEmail: null, channel: 'messenger' });
  return { tool, created, updates, wheres };
}

const base = {
  customerFirstName: 'Rebecca', customerPhone: '5125551234', localDateTime: '2030-03-09T13:00',
  services: [{ serviceId: 'acr', serviceName: 'Acrylic Full Set' }],
};

describe('chat bot group booking', () => {
  it('books the whole group at once: guests first, the customer last, one group', async () => {
    const { tool, created } = makeSvc();
    const out = await tool({ ...base, guests: [{ firstName: 'Tasha', services: [{ serviceId: 'acr', serviceName: 'Acrylic Full Set' }] }] });
    expect(out).toMatch(/^SUCCESS/);
    expect(out).toContain('whole group of 2');
    expect(created.map((c) => c.dto.customerFirstName)).toEqual(['Tasha', 'Rebecca']);
    const [tasha, rebecca] = created;
    expect(tasha.dto.customerPhone).toBeUndefined();
    expect(tasha.opts).toMatchObject({ groupGuest: true });
    expect(rebecca.dto.customerPhone).toBe('5125551234');
    expect(tasha.dto.groupId).toBeTruthy();
    expect(tasha.dto.groupId).toBe(rebecca.dto.groupId);
    for (const c of created) {
      expect(c.tenantId).toBe('t1');
      expect(c.dto.partySize).toBe(2);
      expect(c.dto.startTime).toBe(rebecca.dto.startTime);
    }
  });

  it('one person is still a plain booking', async () => {
    const { tool, created } = makeSvc();
    expect(await tool(base)).toMatch(/^SUCCESS/);
    expect(created).toHaveLength(1);
    expect(created[0].dto.groupId).toBeUndefined();
  });

  it('a guest service that is not on THIS menu books nobody', async () => {
    const { tool, created, wheres } = makeSvc();
    const out = await tool({ ...base, guests: [{ firstName: 'Tasha', services: [{ serviceId: 'other', serviceName: 'Hair Coloring' }] }] });
    expect(out).toMatch(/^ERROR/);
    expect(created).toHaveLength(0);
    for (const w of wheres) expect(w.tenantId).toBe('t1');
  });

  it('if the customer\'s own booking fails, the guests already written are cancelled', async () => {
    const { tool, created, updates } = makeSvc({ failOn: 2 });
    const out = await tool({ ...base, guests: [{ firstName: 'Tasha', services: [{ serviceId: 'pedi', serviceName: 'Pedicure' }] }] });
    expect(out).not.toMatch(/^SUCCESS/);
    expect(created).toHaveLength(1);
    expect(updates[0].where).toEqual({ tenantId: 't1', id: { in: ['ap1'] } });
  });
});
