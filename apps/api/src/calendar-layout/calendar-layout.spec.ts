jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    UserRole: actual.UserRole?.SALON_ADMIN ? actual.UserRole : { SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF', SUPER_ADMIN: 'SUPER_ADMIN', SUPPORT: 'SUPPORT' },
    StaffRole: actual.StaffRole?.MANAGER ? actual.StaffRole : { MANAGER: 'MANAGER', TECHNICIAN: 'TECHNICIAN', RECEPTIONIST: 'RECEPTIONIST' },
  };
});
import { ForbiddenException } from '@nestjs/common';
import { CalendarLayoutService, canArrange } from './calendar-layout.service';
import { cleanLayout, STAFF_LAYOUT_KEY } from './staff-layout';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function makeDb() {
  const settings = new Map<string, unknown>();
  const staff = [{ id: 'lisa', tenantId: 'A' }, { id: 'kim', tenantId: 'A' }, { id: 'mai', tenantId: 'A' }, { id: 'zoe', tenantId: 'B' }];
  const prisma = {
    setting: {
      findUnique: jest.fn(async ({ where }: Row) => {
        const k = `${where.tenantId_key.tenantId}:${where.tenantId_key.key}`;
        return settings.has(k) ? { value: settings.get(k) } : null;
      }),
      upsert: jest.fn(async ({ where, create }: Row) => { settings.set(`${where.tenantId_key.tenantId}:${where.tenantId_key.key}`, create.value); return create; }),
    },
    staffMember: { findMany: jest.fn(async ({ where }: Row) => staff.filter((s) => s.tenantId === where.tenantId)) },
  };
  const audit = { log: jest.fn(async () => undefined) };
  return { svc: new CalendarLayoutService(prisma as never, audit as never), prisma, settings, audit };
}
const owner = (t: string) => ({ userId: 'o' + t, email: 'o@x', role: 'SALON_ADMIN', tenantId: t }) as never;
const staffUser = (t: string, staffRole: string) => ({ userId: 's' + t, email: 's@x', role: 'STAFF', staffRole, tenantId: t }) as never;

describe('technician line-up on the calendar', () => {
  it('cleans: strings only, no duplicates, trims', () => {
    expect(cleanLayout({ order: ['a', 'a', 3, ' b ', ''], hidden: 'x' })).toEqual({ order: ['a', 'b'], hidden: [] });
    expect(cleanLayout(null)).toEqual({ order: [], hidden: [] });
  });

  it('the owner saves the order and who is hidden; everyone reads the same', async () => {
    const { svc, audit } = makeDb();
    await svc.save(owner('A'), { order: ['lisa', 'mai', 'kim'], hidden: ['kim'] });
    expect(await svc.get(staffUser('A', 'RECEPTIONIST'))).toEqual({ order: ['lisa', 'mai', 'kim'], hidden: ['kim'], canEdit: false });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'A', action: 'calendar.staff_layout_saved' }));
  });

  it('a manager may arrange; a receptionist or a technician may not', async () => {
    const { svc } = makeDb();
    expect(canArrange(staffUser('A', 'MANAGER'))).toBe(true);
    await expect(svc.save(staffUser('A', 'MANAGER'), { order: ['kim'] })).resolves.toMatchObject({ order: ['kim'] });
    await expect(svc.save(staffUser('A', 'RECEPTIONIST'), { order: ['lisa'] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.save(staffUser('A', 'TECHNICIAN'), { order: ['lisa'] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cross-tenant: another salon\'s staff ids are dropped, and each salon reads only its own row', async () => {
    const { svc, settings } = makeDb();
    await svc.save(owner('A'), { order: ['zoe', 'lisa'], hidden: ['zoe'] });
    expect(settings.get(`A:${STAFF_LAYOUT_KEY}`)).toEqual({ order: ['lisa'], hidden: [] });
    await svc.save(owner('B'), { order: ['lisa', 'zoe'] });
    expect(settings.get(`B:${STAFF_LAYOUT_KEY}`)).toEqual({ order: ['zoe'], hidden: [] });
    expect((await svc.get(owner('A'))).order).toEqual(['lisa']);
    expect((await svc.get(owner('B'))).order).toEqual(['zoe']);
  });

  it('nothing saved yet → empty line-up (the calendar falls back to A → Z)', async () => {
    const { svc } = makeDb();
    expect(await svc.get(owner('A'))).toEqual({ order: [], hidden: [], canEdit: true });
  });
});
