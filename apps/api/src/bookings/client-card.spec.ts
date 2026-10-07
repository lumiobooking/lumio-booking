/**
 * THẺ KHÁCH: what the technician sees about the client on her booking —
 * careful-with, preferences, regular or new — hers only, one salon only.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    AppointmentStatus: actual.AppointmentStatus ?? { COMPLETED: 'COMPLETED' },
    OrderStatus: actual.OrderStatus ?? { PAID: 'PAID' },
    UserRole: actual.UserRole ?? { SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF', SUPER_ADMIN: 'SUPER_ADMIN' },
  };
});
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { buildClientCard, daysToBirthday } from './client-card';
import { BookingsService } from './bookings.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const NOW = new Date('2026-10-08T22:00:00Z');

describe('the card', () => {
  const base = { firstName: 'Mai', lastName: 'Tran', notes: 'Likes it quiet', loyaltyPoints: 120, birthDate: new Date('1990-10-15T00:00:00Z'), createdAt: new Date('2025-01-01T00:00:00Z'), importedVisits: 0, lastVisitAt: null };
  it('a regular: warnings first, preferences, favourites, visits with me, birthday soon', () => {
    const c = buildClientCard({
      industry: 'NAIL', now: NOW,
      customer: { ...base, industryFields: { allergies: 'acrylic', nailShape: 'almond', colors: 'OPI Big Apple Red' } },
      visits: [
        { at: new Date('2026-09-20T17:00:00Z'), services: ['Gel manicure'], staff: 'Kim', withMe: true },
        { at: new Date('2026-08-20T17:00:00Z'), services: ['Gel manicure', 'Pedicure'], staff: 'Kim', withMe: true },
        { at: new Date('2026-07-20T17:00:00Z'), services: ['Pedicure'], staff: 'Lisa', withMe: false },
      ],
    })!;
    expect(c.firstVisit).toBe(false);
    expect(c).toMatchObject({ name: 'Mai Tran', visits: 3, withMe: 2, points: 120, birthdaySoon: true, notes: 'Likes it quiet' });
    expect(c.warnings).toEqual([{ label: { vi: 'Dị ứng / da nhạy cảm', en: 'Allergies / sensitivities' }, value: 'acrylic' }]);
    expect(c.prefs.map((p) => p.value)).toEqual(['Hạnh nhân / Almond', 'OPI Big Apple Red']);
    expect(c.favourites[0]).toEqual({ name: 'Gel manicure', count: 2 });
    expect(c.preferredStaff).toEqual({ name: 'Kim', count: 2 });
    expect(c.lastWithMe?.toISOString()).toBe('2026-09-20T17:00:00.000Z');
  });
  it('a first visit; old-system history still counts', () => {
    const c = buildClientCard({ industry: 'NAIL', now: NOW, customer: { ...base, industryFields: {}, birthDate: null }, visits: [] })!;
    expect(c).toMatchObject({ firstVisit: true, visits: 0, warnings: [], prefs: [], birthdaySoon: false });
    const old = buildClientCard({ industry: 'NAIL', now: NOW, customer: { ...base, industryFields: {}, importedVisits: 12, lastVisitAt: new Date('2026-05-01T00:00:00Z') }, visits: [] })!;
    expect(old).toMatchObject({ firstVisit: false, visits: 12, pastVisits: 12 });
    expect(old.lastVisit?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(buildClientCard({ industry: 'NAIL', customer: null, visits: [] })).toBeNull();
  });
  it('birthday arithmetic across the year end', () => {
    expect(daysToBirthday(new Date('1990-10-08T00:00:00Z'), NOW)).toBe(0);
    expect(daysToBirthday(new Date('1990-01-02T00:00:00Z'), new Date('2026-12-30T12:00:00Z'))).toBe(3);
    expect(daysToBirthday(null, NOW)).toBeNull();
  });
});

describe('who may read it', () => {
  function make() {
    const seen: string[] = [];
    const appts: Row[] = [
      { id: 'b1', tenantId: 'A', customerId: 'c1', assignedStaffId: 'kim' },
      { id: 'b2', tenantId: 'A', customerId: 'c1', assignedStaffId: 'lisa' },
      { id: 'b3', tenantId: 'B', customerId: 'c9', assignedStaffId: 'zoe' },
    ];
    const staff: Row[] = [
      { id: 'kim', tenantId: 'A', userId: 'u-kim', staffRole: 'TECHNICIAN', permissions: null },
      { id: 'desk', tenantId: 'A', userId: 'u-desk', staffRole: 'RECEPTIONIST', permissions: null },
    ];
    const prisma: Row = {
      appointment: { findFirst: async ({ where }: Row) => { seen.push(where.tenantId); return appts.find((a) => a.id === where.id && a.tenantId === where.tenantId) ?? null; } },
      staffMember: { findFirst: async ({ where }: Row) => staff.find((s) => s.tenantId === where.tenantId && s.userId === where.userId) ?? null, findMany: async () => [] },
      customer: { findFirst: async ({ where }: Row) => { seen.push(where.tenantId); return where.tenantId === 'A' && where.id === 'c1' ? { firstName: 'Mai', lastName: null, notes: null, loyaltyPoints: 0, birthDate: null, createdAt: NOW, industryFields: { allergies: 'latex' }, appointments: [] } : null; } },
      tenant: { findUnique: async () => ({ timezone: 'America/Edmonton', businessType: 'SALON' }) },
      setting: { findUnique: async () => null },
      order: { findMany: async ({ where }: Row) => { seen.push(where.tenantId); return []; } },
    };
    const svc = Object.create(BookingsService.prototype) as BookingsService;
    (svc as unknown as Row).prisma = prisma;
    return { svc, seen };
  }
  const kim = { userId: 'u-kim', tenantId: 'A', role: 'STAFF' } as never;
  const desk = { userId: 'u-desk', tenantId: 'A', role: 'STAFF' } as never;
  const owner = { userId: 'own', tenantId: 'A', role: 'SALON_ADMIN' } as never;
  const ownerB = { userId: 'own-b', tenantId: 'B', role: 'SALON_ADMIN' } as never;

  it('her own booking: yes; a colleague\'s: no; the desk and the owner: any of this salon; another salon: nothing', async () => {
    const { svc, seen } = make();
    const r: Row = await svc.clientCard(kim, 'b1');
    expect(r.card.warnings[0].value).toBe('latex');
    await expect(svc.clientCard(kim, 'b2')).rejects.toBeInstanceOf(ForbiddenException);
    expect((await svc.clientCard(desk, 'b2') as Row).card.name).toBe('Mai');
    expect((await svc.clientCard(owner, 'b2') as Row).card.name).toBe('Mai');
    await expect(svc.clientCard(ownerB, 'b1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.clientCard(kim, 'b3')).rejects.toBeInstanceOf(NotFoundException);
    expect(seen.filter((t) => t === 'B')).toHaveLength(1); // only ownerB's own lookup touched B; kim's read of b3 stayed in A
  });
});
