/**
 * Booking must not rename the customer. The inbox shows the name
 * Facebook/Instagram shows for the person; the name they type for a booking
 * goes to the Customer record. Only a thread with no name yet (a website
 * visitor) takes the typed one.
 */
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  AppointmentStatus: { PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', ACCEPTED: 'ACCEPTED', CONFIRMED: 'CONFIRMED', ARRIVED: 'ARRIVED', CANCELLED: 'CANCELLED' },
}));
import { MessengerService } from './messenger.service';

type Row = Record<string, any>;

function make(threadName: string | null) {
  const updates: Row[] = [];
  const customers: Row[] = [];
  const prisma: any = {
    customer: {
      findFirst: async () => null,
      create: async ({ data }: Row) => { customers.push(data); return { id: 'c1', firstName: data.firstName }; },
    },
    messengerThread: {
      findUnique: async ({ where }: Row) => (where.id === 'th1' ? { senderName: threadName } : null),
      update: async ({ where, data }: Row) => { updates.push({ where, data }); return {}; },
    },
  };
  const svc = new MessengerService(prisma, {} as never, {} as never, {} as never, {} as never, {} as never);
  const tool = (input: Row) => (svc as unknown as { runTool: (...a: unknown[]) => Promise<string> })
    .runTool('t1', 'America/Chicago', 'save_contact', input, { mode: 'booking', leadEmail: null, channel: 'messenger', threadId: 'th1' });
  return { tool, updates, customers };
}

describe('save_contact keeps the name the Page shows', () => {
  it('a Facebook thread keeps its profile name; the typed name goes to the Customer', async () => {
    const { tool, updates, customers } = make('Quỳnh Lê');
    expect(await tool({ name: 'Lyli', phone: '210 555 0101' })).toMatch(/^SUCCESS/);
    expect(updates).toHaveLength(1);
    expect(updates[0].data.senderName).toBeUndefined();
    expect(updates[0].data.customerId).toBe('c1');
    expect(customers[0].firstName).toBe('Lyli');
    expect(customers[0].tenantId).toBe('t1');
  });

  it('a nameless website thread takes the typed name', async () => {
    const { tool, updates } = make(null);
    await tool({ name: 'Lyli Tran', phone: '2105550101' });
    expect(updates[0].data.senderName).toBe('Lyli Tran');
  });
});
