/**
 * Technicians switch notifications on in their own app now. A salon-wide alert
 * (a new booking, a customer wrote) still goes only to the people who run the
 * salon — not to a technician's phone with every client's name on it.
 */
import { PushService } from './push.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('who a salon-wide alert wakes', () => {
  it('owner and desk logins yes; a technician with no desk permission no; one salon only', async () => {
    const seen: string[] = [];
    const prisma: Row = {
      user: { findMany: async ({ where }: Row) => { seen.push(where.tenantId); return [{ id: 'u-tech' }, { id: 'u-desk' }]; } },
      staffMember: { findMany: async ({ where }: Row) => { seen.push(where.tenantId); return [{ userId: 'u-tech', staffRole: 'TECHNICIAN', permissions: null }, { userId: 'u-desk', staffRole: 'RECEPTIONIST', permissions: null }]; } },
    };
    const svc = Object.create(PushService.prototype) as Row;
    svc.prisma = prisma;
    const quiet: Set<string> = await svc.techOnlyUsers('A', ['u-owner', 'u-tech', 'u-desk']);
    expect([...quiet]).toEqual(['u-tech']);
    expect(seen.every((t) => t === 'A')).toBe(true);
  });
  it('a technician the owner gave desk permissions counts as desk', async () => {
    const prisma: Row = {
      user: { findMany: async () => [{ id: 'u-tech' }] },
      staffMember: { findMany: async () => [{ userId: 'u-tech', staffRole: 'TECHNICIAN', permissions: ['bookings'] }] },
    };
    const svc = Object.create(PushService.prototype) as Row;
    svc.prisma = prisma;
    expect([...(await svc.techOnlyUsers('A', ['u-tech']))]).toEqual([]);
  });
});
