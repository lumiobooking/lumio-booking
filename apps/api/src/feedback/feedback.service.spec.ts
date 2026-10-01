import { NotFoundException } from '@nestjs/common';

// The FTP client is not needed to test any of this (photos are optional).
jest.mock('../uploads/uploads.service', () => ({ UploadsService: class {} }));
import { FeedbackService, FEEDBACK_SETTINGS_KEY } from './feedback.service';

/**
 * The feedback service against a small in-memory database. Every staff-side
 * read is checked for carrying a tenantId, the way the real database would
 * silently NOT check it — so a missing scope fails loudly here.
 */
type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
    if (k === 'tenantId_key') return row.tenantId === v.tenantId && row.key === v.key;
    const cell = row[k];
    if (v === null) return cell === null || cell === undefined;
    if (v instanceof Date) return cell instanceof Date && cell.getTime() === v.getTime();
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('in' in v) return (v.in as unknown[]).includes(cell);
      if ('not' in v) return v.not === null ? cell !== null && cell !== undefined : cell !== v.not;
      const t = (x: unknown) => (x instanceof Date ? x.getTime() : (x as number));
      if ('gte' in v && !(cell != null && t(cell) >= t(v.gte))) return false;
      if ('gt' in v && !(cell != null && t(cell) > t(v.gt))) return false;
      if ('lt' in v && !(cell != null && t(cell) < t(v.lt))) return false;
      if ('lte' in v && !(cell != null && t(cell) <= t(v.lte))) return false;
      return true;
    }
    return cell === v;
  });
}

function table(name: string, rows: Row[], scoped = true) {
  let n = 0;
  const need = (where: Row) => { if (scoped && (!where || (typeof where.tenantId !== 'string' && !where.token && !where.tenantId_key))) throw new Error(`${name}: query without tenantId ${JSON.stringify(where)}`); };
  return {
    rows,
    findUnique: jest.fn(async ({ where }: Row) => rows.find((r) => matches(r, where)) ?? null),
    findFirst: jest.fn(async ({ where }: Row = {}) => { need(where); return rows.find((r) => matches(r, where)) ?? null; }),
    findMany: jest.fn(async ({ where }: Row = {}) => { if (name !== 'feedbackRequest' || where?.tenantId) need(where); return rows.filter((r) => matches(r, where)); }),
    count: jest.fn(async ({ where }: Row = {}) => { need(where); return rows.filter((r) => matches(r, where)).length; }),
    create: jest.fn(async ({ data }: Row) => { const r = { id: `${name}-${++n}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(r); return r; }),
    updateMany: jest.fn(async ({ where, data }: Row) => { if (name !== 'feedbackRequest' || where?.tenantId) need(where); const hit = rows.filter((r) => matches(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; }),
    upsert: jest.fn(async ({ where, update, create }: Row) => { const r = rows.find((x) => matches(x, where)); if (r) { Object.assign(r, update); return r; } rows.push({ ...create }); return create; }),
    groupBy: jest.fn(async ({ where }: Row) => { need(where); const m = new Map<string, number>(); rows.filter((r) => matches(r, where)).forEach((r) => m.set(r.status, (m.get(r.status) ?? 0) + 1)); return [...m].map(([status, c]) => ({ status, _count: { _all: c } })); }),
    aggregate: jest.fn(async ({ where }: Row) => { need(where); const hit = rows.filter((r) => matches(r, where)); return { _count: { _all: hit.length }, _sum: { totalCents: hit.reduce((a, r) => a + (r.totalCents ?? 0), 0) } }; }),
  };
}

function setup() {
  const db: Row = {
    setting: table('setting', [
      { tenantId: 'A', key: FEEDBACK_SETTINGS_KEY, value: { enabled: true, smsDelayMinutes: 45, cooldownDays: 45 } },
      { tenantId: 'B', key: FEEDBACK_SETTINGS_KEY, value: { enabled: true } },
    ]),
    customer: table('customer', [
      { id: 'cA', tenantId: 'A', firstName: 'Anna', lastName: 'Nguyen', phone: '+15128868189' },
      { id: 'cB', tenantId: 'B', firstName: 'Bea', lastName: null, phone: '+15125550000' },
    ]),
    staffMember: table('staffMember', [
      { id: 'lisa', tenantId: 'A', firstName: 'Lisa', lastName: 'Pham', isActive: true, userId: 'uLisa' },
      { id: 'tom', tenantId: 'B', firstName: 'Tom', lastName: null, isActive: true },
    ]),
    walkIn: table('walkIn', []),
    feedbackRequest: table('feedbackRequest', []),
    feedback: table('feedback', []),
    feedbackCase: table('feedbackCase', []),
    feedbackCaseEvent: table('feedbackCaseEvent', []),
    staffCoaching: table('staffCoaching', []),
    notification: table('notification', []),
    order: table('order', [{ id: 'o1', tenantId: 'A', customerId: 'cA', status: 'PAID', totalCents: 4500 }]),
    appointment: table('appointment', []),
    tenant: table('tenant', [{ id: 'A', name: 'Zb Nails', market: 'US', timezone: 'UTC', branding: {} }, { id: 'B', name: 'Other Salon', market: 'US', timezone: 'UTC', branding: {} }], false),
    user: table('user', [
      { id: 'uOwnerA', tenantId: 'A', role: 'SALON_ADMIN', firstName: 'Kim', email: 'kim@a.com', staffMember: null },
      { id: 'uOwnerB', tenantId: 'B', role: 'SALON_ADMIN', firstName: 'Bo', email: 'bo@b.com', staffMember: null },
    ], false),
  };
  const settings: any = { effectiveGoogleReviewUrl: jest.fn(async (t: string) => (t === 'A' ? 'https://g.page/r/A/review' : null)), brandingFrom: () => ({ accentColor: '#6366f1', logoUrl: '' }) };
  const audit: any = { log: jest.fn(async () => undefined) };
  const notifications: any = { send: jest.fn(async () => ({})) };
  const push: any = { sendToUser: jest.fn(async () => 1) };
  const svc = new FeedbackService(db as never, settings, audit, notifications, push);
  return { svc, db, push, notifications, audit };
}

const ownerA = { userId: 'uOwnerA', tenantId: 'A', role: 'SALON_ADMIN' } as any;
const ownerB = { userId: 'uOwnerB', tenantId: 'B', role: 'SALON_ADMIN' } as any;
const order = { id: 'o1', customerId: 'cA', items: [{ kind: 'SERVICE', name: 'Gel Manicure', staffMemberId: 'lisa' }, { kind: 'PRODUCT', name: 'Oil', staffMemberId: null }] };

describe('asking after a sale', () => {
  it('creates one request with the technician and services, and schedules the text', async () => {
    const { svc, db } = setup();
    const r = await svc.createForOrder('A', order);
    expect(r?.status).toBe('PENDING');
    expect(r?.token).toHaveLength(24);
    const row = db.feedbackRequest.rows[0];
    expect(row).toMatchObject({ tenantId: 'A', staffId: 'lisa', customerName: 'Anna', phone: '+15128868189', serviceNames: ['Gel Manicure'] });
    expect(row.smsDueAt.getTime()).toBeGreaterThan(Date.now() + 44 * 60_000);
  });

  it('does nothing while the salon has it switched off', async () => {
    const { svc, db } = setup();
    db.setting.rows[0].value.enabled = false;
    expect(await svc.createForOrder('A', order)).toBeNull();
    expect(db.feedbackRequest.rows).toHaveLength(0);
  });

  it('does not ask the same customer again inside the cooldown', async () => {
    const { svc } = setup();
    await svc.createForOrder('A', order);
    const again = await svc.createForOrder('A', { ...order, id: 'o2' });
    expect(again).toEqual({ token: null, status: 'COOLDOWN', receiptQr: false });
  });
});

describe('the customer answers', () => {
  it('happy: no case, the Google link comes back, a second tap changes nothing', async () => {
    const { svc, db, push } = setup();
    const { token } = (await svc.createForOrder('A', order))!;
    const res = await svc.publicSubmit(token!, { sentiment: 'HAPPY', source: 'ipad' });
    expect(res).toEqual({ ok: true, googleUrl: 'https://g.page/r/A/review' });
    expect(db.feedbackCase.rows).toHaveLength(0);
    expect(push.sendToUser).not.toHaveBeenCalled();
    expect(await svc.publicSubmit(token!, { sentiment: 'UNHAPPY' })).toMatchObject({ already: true });
    expect(db.feedback.rows).toHaveLength(1);
  });

  it('not quite: a case with a 24 h clock, only offered reasons kept, the owner of THIS salon alerted — and the Google link still offered', async () => {
    const { svc, db, push } = setup();
    const { token } = (await svc.createForOrder('A', order))!;
    const res = await svc.publicSubmit(token!, { sentiment: 'UNHAPPY', reasons: ['Waited too long', 'hacked'], comment: 'Late', wantsContact: true, source: 'sms' });
    expect(res.googleUrl).toBe('https://g.page/r/A/review');
    const fb = db.feedback.rows[0];
    expect(fb).toMatchObject({ tenantId: 'A', sentiment: 'UNHAPPY', reasons: ['Waited too long'], wantsContact: true, rating: 2, staffId: 'lisa' });
    const c = db.feedbackCase.rows[0];
    expect(c).toMatchObject({ tenantId: 'A', status: 'NEW', staffId: 'lisa' });
    expect(Math.round((c.dueAt.getTime() - c.createdAt.getTime()) / 3_600_000)).toBe(24);
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
    expect(push.sendToUser.mock.calls[0][0]).toBe('A');
    expect(push.sendToUser.mock.calls[0][1]).toBe('uOwnerA');
  });

  it('a bad token is a plain 404', async () => {
    const { svc } = setup();
    await expect(svc.publicContext('x'.repeat(24))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the public context never carries ids, and masks the phone', async () => {
    const { svc } = setup();
    const { token } = (await svc.createForOrder('A', order))!;
    const ctx = await svc.publicContext(token!);
    const text = JSON.stringify(ctx);
    expect(text).not.toContain('lisa');
    expect(text).not.toContain('cA');
    expect(ctx.maskedPhone).toBe('+1 512 •••• 8189');
    expect(ctx.staffName).toBe('Lisa');
  });
});

describe('cases stay inside their salon', () => {
  async function withCase() {
    const s = setup();
    const { token } = (await s.svc.createForOrder('A', order))!;
    await s.svc.publicSubmit(token!, { sentiment: 'UNHAPPY', reasons: ['Price'] });
    return { ...s, caseId: s.db.feedbackCase.rows[0].id as string };
  }

  it('another salon can neither read, list nor act on it', async () => {
    const { svc, caseId } = await withCase();
    await expect(svc.getCase(ownerB, caseId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.caseAction(ownerB, caseId, { action: 'resolve' })).rejects.toBeInstanceOf(NotFoundException);
    expect((await svc.listCases(ownerB, {})).cases).toHaveLength(0);
    expect((await svc.listCases(ownerA, {})).cases).toHaveLength(1);
    expect((await svc.openCount(ownerB)).open).toBe(0);
  });

  it('the till of another salon learns nothing about the sale', async () => {
    const { svc } = await withCase();
    expect(await svc.statusForOrder(ownerB, 'o1')).toEqual({ status: 'NONE' });
    const mine = await svc.statusForOrder(ownerA, 'o1');
    expect(mine).toMatchObject({ status: 'ANSWERED', answered: true });
    expect(JSON.stringify(mine)).not.toMatch(/UNHAPPY|HAPPY"/);
  });

  it('taking, texting and resolving stop the clock and leave a timeline', async () => {
    const { svc, caseId, notifications, db } = await withCase();
    await svc.caseAction(ownerA, caseId, { action: 'take' });
    const after = await svc.caseAction(ownerA, caseId, { action: 'send_text', text: 'So sorry — free fix this week?' });
    expect(after.status).toBe('CONTACTED');
    expect(after.firstResponseAt).toBeInstanceOf(Date);
    expect(notifications.send).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'A', recipient: '+15128868189', body: 'So sorry — free fix this week?' }));
    const done = await svc.caseAction(ownerA, caseId, { action: 'resolve', resolution: 'Free fix' });
    expect(done.status).toBe('RESOLVED');
    expect(done.events.map((e: any) => e.kind)).toEqual(['received', 'taken', 'text_sent', 'resolved']);
    expect(db.feedbackCaseEvent.rows.every((e: any) => e.tenantId === 'A')).toBe(true);
  });

  it('coaching notes cannot be written onto another salon’s technician', async () => {
    const { svc } = setup();
    await expect(svc.addCoaching(ownerB, 'lisa', { kind: 'NOTE', text: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.staffCard(ownerB, 'lisa', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a skip from another salon is refused', async () => {
    const { svc, db } = setup();
    await svc.createForOrder('A', order);
    const id = db.feedbackRequest.rows[0].id;
    await expect(svc.skip(ownerB, id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.skip(ownerA, id)).resolves.toEqual({ ok: true });
  });
});

describe('the text after the visit', () => {
  it('goes once, only when due, only for unanswered visits', async () => {
    const { svc, db, notifications } = setup();
    await svc.createForOrder('A', order);
    expect((await svc.processDue(new Date())).sent).toBe(0);
    const later = new Date(Date.now() + 50 * 60_000);
    expect((await svc.processDue(later)).sent).toBe(1);
    expect(notifications.send.mock.calls[0][0].body).toContain('/f/');
    expect((await svc.processDue(later)).sent).toBe(0);
    expect(db.feedbackRequest.rows[0].smsSentAt).toBeInstanceOf(Date);
  });
});

describe('what a technician sees', () => {
  const lisaUser = { userId: 'uLisa', tenantId: 'A', role: 'STAFF' } as any;
  function seed(db: Row) {
    const at = new Date(Date.now() - 3_600_000);
    for (let i = 0; i < 4; i++) db.feedback.rows.push({ id: `fa${i}`, tenantId: 'A', staffId: 'lisa', sentiment: i ? 'HAPPY' : 'UNHAPPY', reasons: i ? [] : ['Waited too long'], invitedToGoogle: i === 1, createdAt: at });
    // Another salon's technician, busy and unhappy — must never show up in salon A's board.
    for (let i = 0; i < 5; i++) db.feedback.rows.push({ id: `fb${i}`, tenantId: 'B', staffId: 'tom', sentiment: 'UNHAPPY', reasons: ['Price'], invitedToGoogle: false, createdAt: at });
  }

  it('their own numbers only, no board unless the owner turns it on', async () => {
    const { svc, db } = setup();
    seed(db);
    const me: any = await svc.mine(lisaUser);
    expect(me).toMatchObject({ visible: true, answers: 4, happy: 3, pct: 75, google: 1, board: null });
    expect(me.reasons).toEqual([{ reason: 'Waited too long', count: 1 }]);
    expect(JSON.stringify(me)).not.toMatch(/Anna|\+1512/);
  });

  it('the team board lists this salon only, by first name', async () => {
    const { svc, db } = setup();
    seed(db);
    db.setting.rows[0].value = { ...db.setting.rows[0].value, techLeaderboard: true };
    const me: any = await svc.mine(lisaUser);
    expect(me.board).toEqual([{ name: 'Lisa', pct: 75, answers: 4, me: true }]);
  });

  it('hidden entirely when the owner keeps scores private', async () => {
    const { svc, db } = setup();
    seed(db);
    db.setting.rows[0].value = { ...db.setting.rows[0].value, techSeeOwnScore: false };
    expect(await svc.mine(lisaUser)).toEqual({ visible: false });
  });
});

describe('a photo for the visit', () => {
  function withUploads() {
    const env = setup();
    const uploads: any = { uploadDataUrl: jest.fn(async (t: string) => `https://cdn.example/${t}/p${uploads.uploadDataUrl.mock.calls.length}.jpg`) };
    const svc = new FeedbackService(env.db as never, (env.svc as any).settings, env.audit, env.notifications, env.push, uploads);
    return { ...env, svc, uploads };
  }

  it('sent from the phone while the customer answers on the shared screen, it lands on the answer', async () => {
    const { svc, db } = withUploads();
    const r = await svc.createForOrder('A', order);
    expect((await svc.publicContext(r!.token!)).hasPhoto).toBe(false);
    await svc.publicPhoto(r!.token!, 'data:image/jpeg;base64,AAAA');
    expect((await svc.publicContext(r!.token!)).hasPhoto).toBe(true);
    await svc.publicSubmit(r!.token!, { sentiment: 'UNHAPPY', reasons: ['Polish chipped'], source: 'ipad' });
    expect(db.feedback.rows[0].photoUrl).toBe('https://cdn.example/A/p1.jpg');
  });

  it('added after a "not quite" is sent, it joins the answer and the case timeline — once', async () => {
    const { svc, db } = withUploads();
    const r = await svc.createForOrder('A', order);
    await svc.publicSubmit(r!.token!, { sentiment: 'UNHAPPY', reasons: ['Polish chipped'], source: 'ipad' });
    await svc.publicPhoto(r!.token!, 'data:image/jpeg;base64,AAAA');
    expect(db.feedback.rows[0].photoUrl).toMatch(/^https:\/\/cdn\.example\/A\//);
    expect(db.feedbackCaseEvent.rows.some((e: Row) => e.kind === 'photo' && e.tenantId === 'A')).toBe(true);
    await expect(svc.publicPhoto(r!.token!, 'data:image/jpeg;base64,BBBB')).rejects.toThrow();
  });

  it('never after a happy answer, and not when the owner switched photos off', async () => {
    const { svc, db } = withUploads();
    const r = await svc.createForOrder('A', order);
    await svc.publicSubmit(r!.token!, { sentiment: 'HAPPY', source: 'link' });
    await expect(svc.publicPhoto(r!.token!, 'data:image/jpeg;base64,AAAA')).rejects.toThrow();
    const r2 = await svc.createForOrder('A', { ...order, id: 'o9', customerId: null as never });
    db.setting.rows[0].value = { ...db.setting.rows[0].value, askPhoto: false };
    await expect(svc.publicPhoto(r2!.token!, 'data:image/jpeg;base64,AAAA')).rejects.toThrow();
  });
});
