/**
 * Walk-in 2.0, step 2 — the desk's optional rules. Off by default (nothing
 * changes for a salon that does nothing); when on: no finishing a visit with
 * no service, a reason when seating someone else than the suggestion, no
 * walk-in that would run into a technician's next booking, a nudge when a
 * visit waits too long at the till. Every read and write is one salon's.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    WalkInStatus: actual.WalkInStatus ?? { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE', CANCELLED: 'CANCELLED' },
  };
});
import { WalkinsService } from './walkins.service';
import { DEFAULT_DESK_POLICY, cleanDeskPolicy, cleanOverrideReason, fitsBeforeBooking, hasService, newlyUnpaidTooLong, payNudgeAlert, suggestFor } from './desk-policy';
import { planDispatch, type TechInfo, type TicketLike } from './walkin-legs';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const T = (id: string, priority = 0): TechInfo => ({ id, name: id, priority, skills: [] });
const NOW = Date.parse('2026-10-17T20:00:00Z');

function waiting(id: string, o: { minutes?: number; pinned?: string } = {}): TicketLike & Row {
  return {
    id, tenantId: 't1', status: 'WAITING', createdAt: new Date(NOW - 5 * 60000), assignedAt: null, doneAt: null, awaitingPayment: false, assignedStaffId: null,
    items: [{ lineId: 'l1', legId: 'g1', serviceId: 's1', name: 'Pedicure', priceCents: 4500, durationMinutes: o.minutes ?? 50, zone: 'FOOT', legStatus: 'WAITING', staffId: o.pinned ?? null, pinned: Boolean(o.pinned), startedAt: null, doneAt: null }],
  };
}

describe('the policy itself', () => {
  it('defaults are all off, and anything sent is cleaned and clamped', () => {
    expect(cleanDeskPolicy(null)).toEqual(DEFAULT_DESK_POLICY);
    expect(DEFAULT_DESK_POLICY).toMatchObject({ requireService: false, overrideReason: false, protectBooking: false, payNudge: false, waitTargetMin: 10 });
    expect(cleanDeskPolicy({ requireService: 'yes', protectBooking: true, bookingBufferMin: 999, waitTargetMin: 1, evil: 1 })).toEqual({
      ...DEFAULT_DESK_POLICY, protectBooking: true, bookingBufferMin: 60, waitTargetMin: 3,
    });
    expect(cleanOverrideReason('customer_request')).toBe('customer_request');
    expect(cleanOverrideReason('because')).toBeNull();
    expect(hasService([{ lineId: 'x' }])).toBe(false);
    expect(hasService([{ serviceId: 's1' }])).toBe(true);
  });

  it('a technician fits a walk-in only if she is free again before her booking (+ buffer)', () => {
    expect(fitsBeforeBooking(NOW, 50, NOW + 70 * 60000, 10)).toBe(true);
    expect(fitsBeforeBooking(NOW, 50, NOW + 55 * 60000, 10)).toBe(false);
    expect(fitsBeforeBooking(NOW, 50, undefined, 10)).toBe(true);
  });
});

describe('who the rules suggest, and the dispatcher', () => {
  const turns = new Map([['tai', 2], ['elena', 3]]);
  it('fewest turns, or the technician she asked for', () => {
    expect(suggestFor(waiting('w'), [T('elena'), T('tai')], [T('elena'), T('tai')], turns, { now: NOW })).toBe('tai');
    expect(suggestFor(waiting('w', { pinned: 'elena' }), [T('tai')], [T('elena'), T('tai')], turns, { now: NOW })).toBe('elena');
  });
  it('protecting a booking: Tai has a client in 40′, the 50′ pedicure goes to Elena; off → Tai as before', () => {
    const bookingAt = new Map([['tai', NOW + 40 * 60000]]);
    expect(suggestFor(waiting('w'), [T('elena'), T('tai')], [T('elena'), T('tai')], turns, { now: NOW, bookingAt, bookingBufferMin: 10 })).toBe('elena');
    expect(planDispatch([waiting('w')], [T('elena'), T('tai')], turns, { now: NOW, bookingAt, bookingBufferMin: 10 }).map((a) => a.staffId)).toEqual(['elena']);
    expect(planDispatch([waiting('w')], [T('elena'), T('tai')], turns, {}).map((a) => a.staffId)).toEqual(['tai']);
  });
});

describe('waiting to pay too long', () => {
  it('pings once per visit, after the salon\'s minutes, longest first', () => {
    const t = (id: string, minsAgo: number): Row => ({ id, status: 'SERVING', awaitingPayment: true, createdAt: new Date(NOW - 90 * 60000), assignedAt: new Date(NOW - minsAgo * 60000), items: [], customerName: id });
    const out = newlyUnpaidTooLong([t('a', 25), t('b', 4), t('c', 12)] as never, new Date(NOW), 10, ['c']);
    expect(out.map((x) => x.id)).toEqual(['a']);
    expect(payNudgeAlert(out)?.body).toBe('a 25′');
    expect(payNudgeAlert([])).toBeNull();
  });
});

describe('the rules on the floor, salon by salon', () => {
  function build(policy: Row | null) {
    const rows: Row[] = [
      { id: 'w1', tenantId: 't1', status: 'SERVING', awaitingPayment: false, doneAt: null, assignedStaffId: 'tai', serviceId: null, createdAt: new Date(), assignedAt: new Date(), items: [] },
      { id: 'w2', tenantId: 't1', status: 'WAITING', awaitingPayment: false, doneAt: null, assignedStaffId: null, serviceId: null, createdAt: new Date(), assignedAt: null, items: waiting('w2').items },
    ];
    const settings: Row[] = policy ? [{ tenantId: 't1', key: 'desk_policy', value: policy }] : [];
    const audits: Row[] = [];
    const prisma: Row = {
      walkIn: {
        findFirst: async ({ where }: Row) => rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null,
        updateMany: async ({ where, data }: Row) => { for (const r of rows) if (r.id === where.id && r.tenantId === where.tenantId) Object.assign(r, data); return { count: 1 }; },
      },
      setting: {
        findUnique: async ({ where }: Row) => settings.find((x) => x.tenantId === where.tenantId_key.tenantId && x.key === where.tenantId_key.key) ?? null,
        upsert: async ({ where, create, update }: Row) => {
          const cur = settings.find((x) => x.tenantId === where.tenantId_key.tenantId && x.key === where.tenantId_key.key);
          if (cur) Object.assign(cur, update); else settings.push({ ...create });
          return {};
        },
      },
      appointment: { findMany: async () => [] },
    };
    const svc = new WalkinsService(prisma as never, {} as never, {} as never, undefined, { log: async (a: Row) => { audits.push(a); } } as never);
    const s = svc as unknown as Row;
    s.settle = async () => undefined;
    s.row = async (_t: string, id: string) => rows.find((r) => r.id === id);
    s.startOfToday = async () => new Date(NOW - 12 * 3600000);
    s.techOf = async (_t: string, id: string) => id;
    s.assignLeg = async () => ({ ok: true });
    s.floor = async () => ({ open: [], techs: [T('elena'), T('tai')], turns: new Map([['tai', 2], ['elena', 3]]), onBreak: new Set(), restricted: new Set(), pick: {} });
    return { svc, rows, settings, audits };
  }
  const owner = { userId: 'u1', tenantId: 't1', role: 'SALON_ADMIN' } as never;

  it('off: a visit with no service finishes as before', async () => {
    const { svc, rows } = build(null);
    await svc.done(owner, 'w1');
    expect(rows[0].status).toBe('DONE');
  });

  it('on: no finishing or sending to the till without a service — but "close without payment" still closes', async () => {
    const { svc, rows } = build({ requireService: true });
    await expect(svc.done(owner, 'w1')).rejects.toThrow(/^NO_SERVICE/);
    await expect(svc.waitPayment(owner, 'w1')).rejects.toThrow(/^NO_SERVICE/);
    expect(rows[0].status).toBe('SERVING');
    await svc.closeUnpaid(owner, 'w1', 'mistake');
    expect(rows[0]).toMatchObject({ status: 'DONE', awaitingPayment: false });
  });

  it('seating someone else than the suggestion: logged always, a reason required only when the rule is on', async () => {
    const off = build(null);
    await off.svc.assign(owner, 'w2', 'elena');
    expect(off.audits[0]).toMatchObject({ action: 'turn.override', tenantId: 't1', metadata: { suggested: 'tai', chosen: 'elena', reason: null } });
    const on = build({ overrideReason: true });
    await expect(on.svc.assign(owner, 'w2', 'elena')).rejects.toThrow(/^OVERRIDE_REASON/);
    await on.svc.assign(owner, 'w2', 'elena', 'customer_request');
    expect(on.audits[0].metadata).toEqual({ suggested: 'tai', chosen: 'elena', reason: 'customer_request' });
    await on.svc.assign(owner, 'w2', 'tai');
    expect(on.audits).toHaveLength(1); // the suggestion itself needs no reason
  });

  it('the policy is saved under this salon only, cleaned, and audited', async () => {
    const { svc, settings, audits } = build(null);
    await svc.setDeskPolicy(owner, { payNudge: true, payNudgeMin: 15, tenantId: 't2' });
    expect(settings).toHaveLength(1);
    expect(settings[0]).toMatchObject({ tenantId: 't1', key: 'desk_policy' });
    expect(settings[0].value).toMatchObject({ payNudge: true, payNudgeMin: 15 });
    expect(settings[0].value.tenantId).toBeUndefined();
    expect(audits[0]).toMatchObject({ tenantId: 't1', action: 'settings.desk_policy_updated' });
    await expect(svc.done({ userId: 'u9', tenantId: 't2', role: 'SALON_ADMIN' } as never, 'w1')).rejects.toThrow('Walk-in not found');
  });
});
