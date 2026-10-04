/**
 * Who may open what, and the login behind it. The owner adjusts one person's
 * screens, changes a login's email, switches it off — always inside their own
 * salon, never reaching another salon's people, and never handing a staff
 * account the owner-only areas.
 */
jest.mock('../auth/password.util', () => ({ hashSecret: async () => 'hashed' }));
jest.mock('../pos/pos.service', () => ({ PosService: class {} }));
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  Prisma: { DbNull: 'DB_NULL' },
  UserRole: { SUPER_ADMIN: 'SUPER_ADMIN', SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF', SUPPORT: 'SUPPORT' },
  StaffRole: { MANAGER: 'MANAGER', RECEPTIONIST: 'RECEPTIONIST', TECHNICIAN: 'TECHNICIAN' },
}));
import { ConflictException, NotFoundException } from '@nestjs/common';
import { capabilitiesFor, cleanStaffCaps, ROLE_PRESETS } from '../auth/capabilities';
import { StaffService } from './staff.service';

type Row = Record<string, any>;
const owner = (tenantId: string) => ({ userId: `owner-${tenantId}`, email: 'o@x.test', role: 'SALON_ADMIN', tenantId }) as any;

describe('capabilities with a per-person list', () => {
  it('a receptionist starts from the front-desk preset', () => {
    expect(capabilitiesFor('STAFF' as any, 'RECEPTIONIST' as any)).toEqual(ROLE_PRESETS.RECEPTIONIST);
    expect(capabilitiesFor('STAFF' as any, 'TECHNICIAN' as any)).toEqual([]);
  });
  it("the owner's own list replaces the preset — but never reaches owner-only areas", () => {
    expect(capabilitiesFor('STAFF' as any, 'RECEPTIONIST' as any, ['calendar', 'reports', 'settings', 'billing', 'nonsense'])).toEqual(['calendar', 'reports']);
    expect(cleanStaffCaps(['integrations'])).toEqual([]);
  });
  it('anything that is not a list means "the preset", never "nothing" and never "everything"', () => {
    expect(capabilitiesFor('STAFF' as any, 'MANAGER' as any, null)).toEqual(ROLE_PRESETS.MANAGER);
    expect(capabilitiesFor('STAFF' as any, 'MANAGER' as any, 'all')).toEqual(ROLE_PRESETS.MANAGER);
  });
  it('owners keep everything whatever is passed', () => {
    expect(capabilitiesFor('SALON_ADMIN' as any, null, [])).toContain('settings');
  });
});

function makeSvc() {
  const users: Row[] = [
    { id: 'u-kim', tenantId: 't1', email: 'kim@a.test', isActive: true },
    { id: 'u-zoe', tenantId: 't2', email: 'zoe@b.test', isActive: true },
  ];
  const staff: Row[] = [
    { id: 'kim', tenantId: 't1', userId: 'u-kim', firstName: 'Kim', lastName: null, staffRole: 'RECEPTIONIST', permissions: null, staffServices: [], workingHours: [], user: null },
    { id: 'nologin', tenantId: 't1', userId: null, firstName: 'Ann', lastName: null, staffRole: 'TECHNICIAN', permissions: null, staffServices: [], workingHours: [], user: null },
    { id: 'zoe', tenantId: 't2', userId: 'u-zoe', firstName: 'Zoe', lastName: null, staffRole: 'RECEPTIONIST', permissions: null, staffServices: [], workingHours: [], user: null },
  ];
  const writes: { model: string; args: Row }[] = [];
  const match = (r: Row, where: Row) => Object.entries(where).every(([k, v]) => r[k] === v);
  const prisma: any = {
    staffMember: {
      findFirst: async ({ where }: Row) => staff.find((r) => match(r, where)) ?? null,
      updateMany: async (args: Row) => { writes.push({ model: 'staffMember.updateMany', args }); return { count: 1 }; },
    },
    user: {
      findFirst: async ({ where }: Row) => users.find((r) => match(r, where)) ?? null,
      findUnique: async ({ where }: Row) => users.find((r) => r.email === where.email) ?? null,
      update: async (args: Row) => { writes.push({ model: 'user.update', args }); const u = users.find((r) => r.id === args.where.id)!; Object.assign(u, args.data); return u; },
      updateMany: async (args: Row) => { writes.push({ model: 'user.updateMany', args }); return { count: 1 }; },
    },
    staffService: { deleteMany: async () => ({}), createMany: async () => ({}) },
    staffWorkingHour: { deleteMany: async () => ({}), createMany: async () => ({}) },
  };
  prisma.$transaction = async (fn: (tx: unknown) => unknown) => fn(prisma);
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new StaffService(prisma, audit as never, {} as never);
  return { svc, writes, users, audit };
}

describe('changing what a person may open', () => {
  it('stores the cleaned list and signs the person out so it applies at once', async () => {
    const { svc, writes, audit } = makeSvc();
    await svc.update(owner('t1'), 'kim', { permissions: ['calendar', 'reports', 'billing'] } as never);
    const st = writes.find((w) => w.model === 'staffMember.updateMany')!;
    expect(st.args.where).toEqual({ id: 'kim', tenantId: 't1' });
    expect(st.args.data.permissions).toEqual(['calendar', 'reports']);
    const out = writes.find((w) => w.model === 'user.updateMany' && w.args.data.passwordChangedAt);
    expect(out?.args.where).toEqual({ id: 'u-kim', tenantId: 't1' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'staff.access_changed', tenantId: 't1' }));
  });

  it('null puts the person back on the role preset', async () => {
    const { svc, writes } = makeSvc();
    await svc.update(owner('t1'), 'kim', { permissions: null } as never);
    expect(writes.find((w) => w.model === 'staffMember.updateMany')!.args.data.permissions).toBe('DB_NULL');
  });

  it('an edit that does not touch access does not sign anyone out; a rename follows to the login', async () => {
    const { svc, writes } = makeSvc();
    await svc.update(owner('t1'), 'kim', { firstName: 'Kimberly', staffRole: 'RECEPTIONIST' } as never);
    expect(writes.some((w) => w.model === 'user.updateMany' && w.args.data.passwordChangedAt)).toBe(false);
    const rename = writes.find((w) => w.model === 'user.updateMany' && w.args.data.firstName);
    expect(rename?.args).toEqual({ where: { id: 'u-kim', tenantId: 't1' }, data: { firstName: 'Kimberly' } });
  });

  it("cannot touch another salon's staff member", async () => {
    const { svc, writes } = makeSvc();
    await expect(svc.update(owner('t1'), 'zoe', { permissions: ['reports'] } as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(writes).toHaveLength(0);
  });
});

describe('editing a login', () => {
  it('changes the sign-in email', async () => {
    const { svc, users } = makeSvc();
    const r = await svc.updateLogin(owner('t1'), 'kim', { email: 'Kim.New@A.test' });
    expect(r).toMatchObject({ email: 'kim.new@a.test', changed: true });
    expect(users[0].email).toBe('kim.new@a.test');
  });

  it('refuses an email somebody else already signs in with', async () => {
    const { svc } = makeSvc();
    await expect(svc.updateLogin(owner('t1'), 'kim', { email: 'zoe@b.test' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('switches sign-in off and back on', async () => {
    const { svc, users } = makeSvc();
    expect(await svc.updateLogin(owner('t1'), 'kim', { active: false })).toMatchObject({ active: false });
    expect(users[0].isActive).toBe(false);
    expect(await svc.updateLogin(owner('t1'), 'kim', { active: true })).toMatchObject({ active: true });
  });

  it("never reaches another salon's login, and needs a login to exist", async () => {
    const { svc, users } = makeSvc();
    await expect(svc.updateLogin(owner('t1'), 'zoe', { active: false })).rejects.toBeInstanceOf(NotFoundException);
    expect(users[1].isActive).toBe(true);
    await expect(svc.updateLogin(owner('t1'), 'nologin', { email: 'a@a.test' })).rejects.toThrow(/no login yet/);
  });
});
