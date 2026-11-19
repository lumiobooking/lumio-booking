jest.mock('./password.util', () => ({
  hashSecret: async (s: string) => `h:${s}`,
  verifySecret: async (s: string, h: string) => h === `h:${s}`,
}));
import { TeamPinsService, maySetTeamPins } from './team-pins.service';

type U = { id: string; tenantId: string; email: string; firstName: string | null; lastName: string | null; role: string; isActive: boolean; approvalPinHash: string | null };

function setup(users: U[], cards: { userId: string; tenantId: string; staffRole: string | null; permissions: unknown }[] = []) {
  const logs: { action: string; tenantId?: string | null; resourceId?: string }[] = [];
  const prisma = {
    user: {
      findMany: jest.fn(async ({ where }: { where: { tenantId: string; role: { in: string[] } } }) =>
        users.filter((u) => u.tenantId === where.tenantId && u.isActive && where.role.in.includes(u.role))),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { approvalPinHash: string | null } }) => {
        const u = users.find((x) => x.id === where.id)!; u.approvalPinHash = data.approvalPinHash; return u;
      }),
    },
    staffMember: {
      findMany: jest.fn(async ({ where }: { where: { tenantId: string; userId: { in: string[] } } }) =>
        cards.filter((c) => c.tenantId === where.tenantId && where.userId.in.includes(c.userId))),
    },
  };
  const audit = { log: jest.fn(async (x: { action: string }) => { logs.push(x); }) };
  return { svc: new TeamPinsService(prisma as never, audit as never), users, logs };
}

const owner = (id: string, tenantId: string, hash: string | null = null): U => ({ id, tenantId, email: `${id}@x.vn`, firstName: id, lastName: null, role: 'SALON_ADMIN', isActive: true, approvalPinHash: hash });
const staff = (id: string, tenantId: string): U => ({ id, tenantId, email: `${id}@x.vn`, firstName: id, lastName: null, role: 'STAFF', isActive: true, approvalPinHash: null });
const support = { userId: 'sup', email: 'support@lumiobooking.com', role: 'SALON_ADMIN', tenantId: 'A', supportSession: true, supportLevel: 'setup' } as never;
const ownerA = { userId: 'oA', email: 'oA@x.vn', role: 'SALON_ADMIN', tenantId: 'A' } as never;

describe('team approval PINs', () => {
  it('who may set PINs for others', () => {
    expect(maySetTeamPins(support)).toBe(true);
    expect(maySetTeamPins(ownerA)).toBe(true);
    expect(maySetTeamPins({ role: 'SALON_ADMIN', tenantId: 'A', supportSession: true, supportLevel: 'content' } as never)).toBe(false);
    expect(maySetTeamPins({ role: 'STAFF', tenantId: 'A' } as never)).toBe(false);
    expect(maySetTeamPins({ role: 'SUPER_ADMIN', tenantId: null } as never)).toBe(false);
  });

  it('lists owners and staff who may void, never cashiers without the right', async () => {
    const { svc } = setup([owner('oA', 'A'), staff('mgr', 'A'), staff('cash', 'A')], [
      { userId: 'mgr', tenantId: 'A', staffRole: 'MANAGER', permissions: null },
      { userId: 'cash', tenantId: 'A', staffRole: 'RECEPTIONIST', permissions: null },
    ]);
    const r = await svc.list(support);
    expect(r.people.map((p) => p.id)).toEqual(['oA', 'mgr']);
    expect(r.people[0]).toMatchObject({ role: 'OWNER', set: false });
    expect(JSON.stringify(r)).not.toContain('h:');
  });

  it('support sets the owner PIN; the audit log says who did it, never the PIN', async () => {
    const { svc, users, logs } = setup([owner('oA', 'A')]);
    await expect(svc.set(support, 'oA', '4826')).resolves.toEqual({ ok: true, set: true });
    expect(users[0].approvalPinHash).toBe('h:4826');
    expect(logs[0]).toMatchObject({ action: 'approval_pin.set_for', tenantId: 'A', resourceId: 'oA' });
    expect(JSON.stringify(logs)).not.toContain('4826');
  });

  it('refuses 0000, bad PINs and a PIN another approver already uses', async () => {
    const { svc } = setup([owner('oA', 'A', 'h:1111'), owner('o2', 'A')]);
    await expect(svc.set(support, 'o2', '0000')).rejects.toThrow(/0000/);
    await expect(svc.set(support, 'o2', '12a4')).rejects.toThrow(/4 to 6/);
    await expect(svc.set(support, 'o2', '1111')).rejects.toThrow(/Someone else/);
    await expect(svc.set(support, 'oA', '1111')).resolves.toMatchObject({ set: true });
  });

  it('a staff member cannot set anyone’s PIN', async () => {
    const { svc } = setup([owner('oA', 'A')]);
    await expect(svc.set({ userId: 'cash', role: 'STAFF', tenantId: 'A' } as never, 'oA', '4826')).rejects.toThrow(/owner or Lumio Support/);
    await expect(svc.list({ userId: 'cash', role: 'STAFF', tenantId: 'A' } as never)).rejects.toThrow();
  });

  it('CROSS-TENANT: salon A (owner or support) cannot touch salon B people', async () => {
    const { svc, users } = setup([owner('oA', 'A'), owner('oB', 'B')]);
    await expect(svc.set(support, 'oB', '4826')).rejects.toThrow(/not an approver/);
    await expect(svc.set(ownerA, 'oB', '4826')).rejects.toThrow(/not an approver/);
    expect(users[1].approvalPinHash).toBeNull();
    expect((await svc.list(ownerA)).people.map((p) => p.id)).toEqual(['oA']);
  });

  it('clears a PIN and logs it', async () => {
    const { svc, users, logs } = setup([owner('oA', 'A', 'h:4826')]);
    await expect(svc.set(ownerA, 'oA', '')).resolves.toEqual({ ok: true, set: false });
    expect(users[0].approvalPinHash).toBeNull();
    expect(logs[0].action).toBe('approval_pin.cleared_for');
  });
});
