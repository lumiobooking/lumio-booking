/**
 * From the technician app, a technician changes only her own tickets (and
 * removes only her own lines). Owners and desk staff run the whole floor.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    UserRole: actual.UserRole ?? { SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF', SUPER_ADMIN: 'SUPER_ADMIN' },
    WalkInStatus: actual.WalkInStatus ?? { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE', CANCELLED: 'CANCELLED' },
  };
});
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WalkinsService } from './walkins.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ticket = { id: 'w1', tenantId: 'A', assignedStaffId: 'lisa', status: 'SERVING', items: [
  { lineId: 'l-lisa', legId: 'g1', serviceId: 's', name: 'Gel', priceCents: 4000, staffId: 'lisa', legStatus: 'SERVING' },
  { lineId: 'l-kim', legId: 'g2', serviceId: 's2', name: 'Pedi', priceCents: 4000, staffId: 'kim', legStatus: 'SERVING' },
] };

function make() {
  const prisma: Row = {
    walkIn: { findFirst: async ({ where }: Row) => (where.id === 'w1' && where.tenantId === 'A' ? ticket : null) },
    staffMember: { findFirst: async ({ where }: Row) => ({ 'u-kim': { id: 'kim' }, 'u-amy': { id: 'amy' } } as Row)[where.userId] ?? null },
  };
  const svc = new WalkinsService(prisma as never, {} as never, {} as never);
  const calls: string[] = [];
  (svc as unknown as Row).removeService = async () => { calls.push('remove'); return {}; };
  (svc as unknown as Row).moveToStation = async () => { calls.push('move'); return {}; };
  (svc as unknown as Row).reactivate = async () => { calls.push('reactivate'); return {}; };
  return { svc, calls };
}
const tech = (u: string, tenantId = 'A') => ({ userId: u, tenantId, role: 'STAFF', staffRole: 'TECHNICIAN' } as never);
const owner = { userId: 'u-own', tenantId: 'A', role: 'SALON_ADMIN' } as never;

describe('my chair, my tickets', () => {
  it('a technician not on the ticket can do nothing to it', async () => {
    const { svc, calls } = make();
    await expect(svc.removeServiceAsMe(tech('u-amy'), 'w1', 'l-lisa')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.moveToStationAsMe(tech('u-amy'), 'w1', 'st1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.reactivateAsMe(tech('u-amy'), 'w1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(calls).toEqual([]);
  });
  it('a technician on the ticket removes her own line, not a colleague\'s', async () => {
    const { svc, calls } = make();
    await svc.removeServiceAsMe(tech('u-kim'), 'w1', 'l-kim');
    await expect(svc.removeServiceAsMe(tech('u-kim'), 'w1', 'l-lisa')).rejects.toBeInstanceOf(ForbiddenException);
    await svc.moveToStationAsMe(tech('u-kim'), 'w1', 'st1');
    expect(calls).toEqual(['remove', 'move']);
  });
  it('the owner runs the whole floor; another salon\'s ticket is not found', async () => {
    const { svc, calls } = make();
    await svc.removeServiceAsMe(owner, 'w1', 'l-lisa');
    expect(calls).toEqual(['remove']);
    await expect(svc.removeServiceAsMe(tech('u-kim', 'B'), 'w1', 'l-kim')).rejects.toBeInstanceOf(NotFoundException);
  });
});
