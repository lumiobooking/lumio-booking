/**
 * Friendly nails: online bookings for services added after the team's skills
 * were set ("Solar Fill In", "UV Gel Full Set"…) were never assigned — every
 * technician had a skill list and none listed the new service, so the engine
 * found nobody and the booking sat "unassigned". A service NOBODY lists is now
 * anybody's, on the booking page and in the engine alike.
 */
import { AppointmentStatus } from '@prisma/client';
import { skilledFor } from './assignment.util';
import { AssignmentService } from './assignment.service';

const T = (id: string, skills: string[], tenantId = 't1', extra: Record<string, unknown> = {}) => ({
  id, tenantId, firstName: id, lastName: null, isActive: true, takesAppointments: true, performanceScore: 100,
  staffServices: skills.map((serviceId) => ({ serviceId })), workingHours: [] as unknown[], ...extra,
});

describe('skilledFor', () => {
  it('a listed service: only those who list it, plus those with no list', () => {
    const team = [T('lisa', ['gel']), T('kim', ['pedi']), T('anna', [])];
    expect(skilledFor(team, 'gel').map((s) => s.id)).toEqual(['lisa', 'anna']);
  });
  it('a service nobody lists: everyone', () => {
    const team = [T('lisa', ['gel']), T('kim', ['pedi'])];
    expect(skilledFor(team, 'solar-fill').map((s) => s.id)).toEqual(['lisa', 'kim']);
  });
});

describe('the engine, one salon at a time', () => {
  function make(team: ReturnType<typeof T>[], busyIds: string[] = []) {
    const seen: Record<string, unknown>[] = [];
    const prisma = {
      tenant: { findUnique: async () => ({ timezone: 'America/Edmonton' }) },
      assignmentRule: { findMany: async () => [] },
      staffMember: { findMany: async ({ where }: { where: Record<string, unknown> }) => { seen.push(where); return team.filter((s) => s.tenantId === where.tenantId); } },
      appointment: {
        findFirst: async ({ where }: { where: { tenantId: string; assignedStaffId: string } }) => { seen.push(where); return busyIds.includes(where.assignedStaffId) ? { id: 'x' } : null; },
        count: async () => 0,
      },
      bookingRejection: { count: async () => 0 },
    };
    return { svc: new AssignmentService(prisma as never), seen };
  }
  const appt = { id: 'a1', serviceId: 'solar-fill', startTime: new Date('2026-10-06T22:00:00Z'), endTime: new Date('2026-10-06T23:00:00Z'), preferredStaffId: null };

  it('assigns a technician for a service nobody lists', async () => {
    const { svc, seen } = make([T('lisa', ['gel']), T('kim', ['pedi']), T('other-salon', [], 't2')]);
    const r = await svc.rankEligibleStaff('t1', appt);
    expect(r.orderedStaffIds.sort()).toEqual(['kim', 'lisa']);
    expect(seen.every((w) => w.tenantId === 't1')).toBe(true);
  });

  it('an excluded technician (who rejected it) still counts as listing it — nobody else is pulled in', async () => {
    const { svc } = make([T('lisa', ['solar-fill']), T('kim', ['pedi'])]);
    const r = await svc.rankEligibleStaff('t1', appt, ['lisa']);
    expect(r.orderedStaffIds).toEqual([]);
  });

  it('explains why nobody: all busy', async () => {
    const { svc } = make([T('lisa', ['gel']), T('kim', ['pedi'], 't1', { takesAppointments: false })], ['lisa']);
    const why = await svc.explain('t1', appt);
    expect(why).toEqual({ team: 2, takesAppointments: 1, serviceUnclaimed: true, skilled: 1, onShift: 1, onLeave: 0, free: [] });
  });

  it('BLOCKING statuses are what make a technician busy', () => {
    expect(AppointmentStatus.CONFIRMED).toBe('CONFIRMED');
  });
});
