import { WalkinsService } from './walkins.service';

/**
 * The queue rule, which is the one thing on this board a customer can see is
 * wrong from the waiting chairs: whoever sat down first goes next.
 *
 * Two ways it used to break, both reproduced below. A tech finishing did not
 * pull anybody in — the board sat still until somebody pressed "Giao". And a
 * phone check-in was seated the instant it arrived, so it walked past every
 * person already waiting.
 */

type Row = { id: string; tenantId: string; status: string; assignedStaffId: string | null; createdAt: Date; items?: unknown[] };

function makePrisma(rows: Row[], staffIds: string[]) {
  const db = rows.map((r) => ({ items: [], service: null, ...r }));
  return {
    _db: db,
    tenant: { findUnique: jest.fn(async () => ({ timezone: 'America/Los_Angeles' })) },
    staffMember: {
      findMany: jest.fn(async () => staffIds.map((id) => ({ id }))),
      count: jest.fn(async () => staffIds.length),
    },
    walkIn: {
      count: jest.fn(async ({ where }: never) =>
        db.filter((r) => r.status === (where as { status: string }).status).length),
      findMany: jest.fn(async ({ where }: never) => {
        const w = where as { status: string; stationId?: unknown };
        return db.filter((r) => r.status === w.status);
      }),
      findFirst: jest.fn(async ({ where }: never) => {
        const w = where as { id?: string; status?: string };
        if (w.id) return db.find((r) => r.id === w.id) ?? null;
        return db.filter((r) => r.status === w.status)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
      }),
      groupBy: jest.fn(async () => []),
      update: jest.fn(async ({ where, data }: never) => {
        const row = db.find((r) => r.id === (where as { id: string }).id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    station: { findMany: jest.fn(async () => []) },
    appointment: { groupBy: jest.fn(async () => []) },
  };
}
const svc = (prisma: unknown) => new WalkinsService(prisma as never, {} as never, {} as never);

const at = (min: number) => new Date(Date.UTC(2026, 8, 19, 10, min));
const waiting = (id: string, min: number): Row =>
  ({ id, tenantId: 't1', status: 'WAITING', assignedStaffId: null, createdAt: at(min) });

describe('the walk-in queue goes in order', () => {
  it('gives the free chair to whoever has waited longest, not the newest ticket', async () => {
    const prisma = makePrisma([waiting('first', 0), waiting('second', 5), waiting('third', 9)], ['hana']);
    const seated = await svc(prisma).seatWaitingQueue('t1');
    expect(seated).toEqual(['first']);
    expect(prisma._db.find((r) => r.id === 'second')!.status).toBe('WAITING');
  });

  // One free tech, one chair. The loop must stop, not keep seating people on
  // a technician who is now busy.
  it('seats one customer per free technician and no more', async () => {
    const prisma = makePrisma([waiting('a', 0), waiting('b', 1), waiting('c', 2)], ['hana', 'lisa']);
    const seated = await svc(prisma).seatWaitingQueue('t1');
    expect(seated).toEqual(['a', 'b']);
    expect(prisma._db.find((r) => r.id === 'c')!.status).toBe('WAITING');
  });

  it('does nothing when every technician is busy', async () => {
    const prisma = makePrisma(
      [{ id: 'busy', tenantId: 't1', status: 'SERVING', assignedStaffId: 'hana', createdAt: at(0) }, waiting('a', 1)],
      ['hana'],
    );
    expect(await svc(prisma).seatWaitingQueue('t1')).toEqual([]);
    expect(prisma._db.find((r) => r.id === 'a')!.status).toBe('WAITING');
  });

  it('does nothing when nobody is waiting', async () => {
    const prisma = makePrisma([], ['hana']);
    expect(await svc(prisma).seatWaitingQueue('t1')).toEqual([]);
  });

  // THE CHECK-IN RULE. A phone check-in is seated only when it IS the front of
  // the queue; arriving behind three people puts the free chair on the person
  // at the front and leaves the newcomer where they queued.
  it('a phone check-in behind a queue does not jump it', async () => {
    const prisma = makePrisma([waiting('early', 0), waiting('justNow', 8)], ['hana']);
    const staffId = await svc(prisma).seatSelfCheckIn('t1', 'justNow');
    expect(staffId).toBeNull();
    expect(prisma._db.find((r) => r.id === 'justNow')!.status).toBe('WAITING');
    expect(prisma._db.find((r) => r.id === 'early')!.status).toBe('SERVING');
  });

  it('a phone check-in with nobody ahead still lands on a tech straight away', async () => {
    const prisma = makePrisma([waiting('only', 0)], ['hana']);
    expect(await svc(prisma).seatSelfCheckIn('t1', 'only')).toBe('hana');
    expect(prisma._db.find((r) => r.id === 'only')!.status).toBe('SERVING');
  });
});
