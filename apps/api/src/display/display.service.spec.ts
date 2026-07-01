import { UserRole } from '@prisma/client';
import { DisplayService } from './display.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

type Session = {
  id: string; tenantId: string; token: string; pairCode: string;
  state?: unknown; payTicket?: unknown; lastTipRef?: string | null;
};
type Staff = { id: string; tenantId: string };

function makePrismaFake(sessions: Session[] = [], staff: Staff[] = []) {
  const tips: { tenantId: string; staffMemberId: string; amountCents: number; method: string }[] = [];
  const bySel = (where: any) => sessions.find((s) =>
    (where.tenantId === undefined || s.tenantId === where.tenantId) &&
    (where.token === undefined || s.token === where.token) &&
    (where.pairCode === undefined || s.pairCode === where.pairCode),
  );
  return {
    _tips: tips,
    displaySession: {
      findUnique: jest.fn(async ({ where }: any) => bySel(where) ?? null),
      update: jest.fn(async ({ where, data }: any) => { const s = bySel(where); if (s) Object.assign(s, data); return s; }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const s = bySel({ token: where.token });
        // Emulate `NOT: { lastTipRef: ref }` — claim only if not already this ref.
        const notRef = where.NOT?.lastTipRef;
        if (s && s.lastTipRef !== notRef) { Object.assign(s, data); return { count: 1 }; }
        return { count: 0 };
      }),
      create: jest.fn(async ({ data }: any) => { const s = { id: 'new', ...data }; sessions.push(s); return s; }),
      deleteMany: jest.fn(async ({ where }: any) => { for (let i = sessions.length - 1; i >= 0; i--) if (sessions[i].tenantId === where.tenantId) sessions.splice(i, 1); return { count: 1 }; }),
    },
    staffMember: {
      findFirst: jest.fn(async ({ where }: any) => staff.find((t) => t.id === where.id && t.tenantId === where.tenantId) ?? null),
    },
    tipLog: {
      create: jest.fn(async ({ data }: any) => { tips.push(data); return data; }),
    },
  };
}

const salonA: AuthenticatedUser = { userId: 'u-a', email: 'a@x.test', role: UserRole.SALON_ADMIN, tenantId: 'tenant-a' };

describe('DisplayService tenant isolation + tip integrity', () => {
  it('pair resolves only a real code; unknown codes are rejected', async () => {
    const prisma = makePrismaFake([{ id: '1', tenantId: 'tenant-a', token: 'TOK-A', pairCode: 'ABC123' }]);
    const svc = new DisplayService(prisma as any);
    expect(await svc.pair('abc123')).toEqual({ token: 'TOK-A' }); // case-insensitive
    await expect(svc.pair('NOPE99')).rejects.toBeDefined();
  });

  it('stateByToken returns only the matching token, else 404', async () => {
    const prisma = makePrismaFake([{ id: '1', tenantId: 'tenant-a', token: 'TOK-A', pairCode: 'ABC123', state: { status: 'idle' } }]);
    const svc = new DisplayService(prisma as any);
    expect((await svc.stateByToken('TOK-A')).state).toEqual({ status: 'idle' });
    await expect(svc.stateByToken('TOK-OTHER')).rejects.toBeDefined();
  });

  it('pushState writes under the caller tenant and clears payTicket when not paid', async () => {
    const prisma = makePrismaFake([{ id: '1', tenantId: 'tenant-a', token: 'TOK-A', pairCode: 'ABC123' }]);
    const svc = new DisplayService(prisma as any);
    await svc.pushState(salonA, { status: 'active' }, { ref: 'r1', baseCents: 1, techs: [] });
    expect(prisma.displaySession.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-a' } }),
    );
    // Not paid → payTicket must be cleared (never left dangling for a stray tip).
    const call = (prisma.displaySession.update as jest.Mock).mock.calls[0][0];
    expect(call.data.payTicket).not.toEqual({ ref: 'r1', baseCents: 1, techs: [] });
  });

  it('recordTip logs to the session tenant, is idempotent, and skips foreign techs', async () => {
    const prisma = makePrismaFake(
      [{ id: '1', tenantId: 'tenant-a', token: 'TOK-A', pairCode: 'ABC123', lastTipRef: null,
         payTicket: { ref: 'r1', baseCents: 1000, techs: [{ staffMemberId: 'sa', weightCents: 700 }, { staffMemberId: 'sForeign', weightCents: 300 }] } }],
      [{ id: 'sa', tenantId: 'tenant-a' }, { id: 'sForeign', tenantId: 'tenant-b' }], // sForeign is another salon's tech
    );
    const svc = new DisplayService(prisma as any);

    const first = await svc.recordTip('TOK-A', 1000);
    expect(first).toEqual({ ok: true, recorded: true });
    // Only the in-tenant tech is logged; the foreign tech is refused.
    expect(prisma._tips.every((t) => t.tenantId === 'tenant-a')).toBe(true);
    expect(prisma._tips.some((t) => t.staffMemberId === 'sForeign')).toBe(false);
    expect(prisma._tips.some((t) => t.staffMemberId === 'sa')).toBe(true);
    expect(prisma.tipLog.create).toHaveBeenCalledTimes(1);

    // Re-tap on the same paid ticket must NOT double-record.
    const again = await svc.recordTip('TOK-A', 1000);
    expect(again).toEqual({ ok: true, recorded: false });
    expect(prisma.tipLog.create).toHaveBeenCalledTimes(1);
  });

  it('recordTip on an unpaid/blank display records nothing', async () => {
    const prisma = makePrismaFake([{ id: '1', tenantId: 'tenant-a', token: 'TOK-A', pairCode: 'ABC123', payTicket: null }]);
    const svc = new DisplayService(prisma as any);
    expect(await svc.recordTip('TOK-A', 500)).toEqual({ ok: true, recorded: false });
    expect(prisma.tipLog.create).not.toHaveBeenCalled();
  });
});
