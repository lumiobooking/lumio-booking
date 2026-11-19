import { adIdOf, cleanLinks, escalationDue, isAdThread, linkOf, parseStaffCommand, turnAlert, turnDueAt, unrepliedMinsFor, windowOpen, type StaffLink } from './staff-alerts';
import { StaffAlertsService } from './staff-alerts.service';

const now = new Date('2026-11-19T07:00:00Z');
const ago = (m: number) => new Date(now.getTime() - m * 60_000);

describe('chia turn đợt 1 — pure rules', () => {
  it('reads team commands, and nothing a customer would normally write', () => {
    expect(parseStaffCommand('LUMIO 482913')).toEqual({ kind: 'link', code: '482913' });
    expect(parseStaffCommand('lumio-482913')).toEqual({ kind: 'link', code: '482913' });
    expect(parseStaffCommand('Vào ca')).toEqual({ kind: 'on' });
    expect(parseStaffCommand('ra ca')).toEqual({ kind: 'off' });
    expect(parseStaffCommand('Nhận khách', 'LUMIO_CLAIM:t1')).toEqual({ kind: 'claim', threadId: 't1' });
    expect(parseStaffCommand('Bỏ qua', 'LUMIO_SKIP:t1')).toEqual({ kind: 'skip', threadId: 't1' });
    expect(parseStaffCommand('cho em hỏi giá gel')).toBeNull();
    expect(parseStaffCommand('em muốn vào ca chiều')).toBeNull();
    expect(parseStaffCommand('x', 'LUMIO_CLAIM:bad id!')).toBeNull();
  });

  it('the Page may write only inside the 24-hour window, and only on shift', () => {
    const l: StaffLink = { userId: 'u', pageId: '111', psid: '222', linkedAt: '', lastAt: ago(60).toISOString(), on: true };
    expect(windowOpen(l, now)).toBe(true);
    expect(windowOpen({ ...l, on: false }, now)).toBe(false);
    expect(windowOpen({ ...l, lastAt: ago(24 * 60).toISOString() }, now)).toBe(false);
  });

  it('links are cleaned and found per Page', () => {
    const links = cleanLinks({ u1: { psid: '222', pageId: '111', on: true }, bad: { psid: 'x', pageId: '111' } });
    expect(Object.keys(links)).toEqual(['u1']);
    expect(linkOf(links, '111', '222')?.userId).toBe('u1');
    expect(linkOf(links, '999', '222')).toBeNull();
  });

  it('a customer from an ad is recognised wherever Meta put the referral', () => {
    expect(adIdOf({ message: { text: 'hi', referral: { source: 'ADS', ad_id: '23851' } } })).toBe('23851');
    expect(adIdOf({ referral: { source: 'ADS' } })).toBe('ad');
    expect(adIdOf({ referral: { source: 'SHORTLINK', ref: 'x' } })).toBeNull();
    expect(isAdThread({ adId: 'a', adAt: ago(60) }, now)).toBe(true);
    expect(isAdThread({ adId: 'a', adAt: ago(25 * 60) }, now)).toBe(false);
  });

  it('ad customers pass on sooner; the countdown follows the same rule', () => {
    const set = { reassignUnreadMins: 0, reassignUnrepliedMins: 5, reassignAdMins: 2, maxHops: 3 };
    const ad = { status: 'open', assignedUserId: 'u', assignedAt: ago(1), assignHops: 0, adId: 'a', adAt: ago(1) };
    expect(unrepliedMinsFor(ad, set, now)).toBe(2);
    expect(turnDueAt(ad, set, now)?.getTime()).toBe(ago(1).getTime() + 2 * 60_000);
    expect(turnDueAt({ ...ad, adId: null }, set, now)?.getTime()).toBe(ago(1).getTime() + 5 * 60_000);
    expect(turnDueAt({ ...ad, handoffAt: now }, set, now)).toBeNull();
    expect(turnDueAt({ ...ad, assignHops: 3 }, set, now)).toBeNull();
  });

  it('escalation once per wait, only when nobody answered after the customer', () => {
    const t = { status: 'open', lastCustomerAt: ago(12), handoffAt: null, escalatedAt: null };
    expect(escalationDue(t, 10, now)).toBe(true);
    expect(escalationDue(t, 15, now)).toBe(false);
    expect(escalationDue({ ...t, handoffAt: ago(5) }, 10, now)).toBe(false);
    expect(escalationDue({ ...t, escalatedAt: ago(1) }, 10, now)).toBe(false);
    expect(escalationDue({ ...t, escalatedAt: ago(30) }, 10, now)).toBe(true);
  });

  it('the alert says who, where, and how long', () => {
    const s = turnAlert({ customer: 'Chị Ngọc', lastText: 'Gel french bao nhiêu', channel: 'instagram', fromAd: true, hop: false, mins: 2 });
    expect(s).toContain('QUẢNG CÁO');
    expect(s).toContain('Instagram');
    expect(s).toContain('2 phút');
  });
});

/** Two salons, each with a Page; the service against in-memory settings. */
function setup() {
  const settings = new Map<string, unknown>();
  const threads = [{ id: 'tA', tenantId: 'A', assignedUserId: 'uA', senderName: 'Ngọc', status: 'open' }, { id: 'tB', tenantId: 'B', assignedUserId: null, senderName: 'Bảo', status: 'open' }];
  const logs: { tenantId: string; action: string }[] = [];
  const prisma = {
    setting: {
      findUnique: jest.fn(async ({ where }: { where: { tenantId_key: { tenantId: string; key: string } } }) => { const v = settings.get(`${where.tenantId_key.tenantId}|${where.tenantId_key.key}`); return v === undefined ? null : { value: v }; }),
      upsert: jest.fn(async ({ where, create }: { where: { tenantId_key: { tenantId: string; key: string } }; create: { value: unknown } }) => { settings.set(`${where.tenantId_key.tenantId}|${where.tenantId_key.key}`, create.value); return {}; }),
    },
    user: { findFirst: jest.fn(async ({ where }: { where: { id: string; tenantId: string } }) => (where.id === 'uA' && where.tenantId === 'A' ? { id: 'uA', firstName: 'Lan' } : null)) },
    messengerPage: { findMany: jest.fn(async () => [{ pageId: '111', pageName: 'Nail A' }]), findFirst: jest.fn(async () => ({ pageToken: 'tok' })) },
    messengerThread: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; tenantId: string } }) => threads.find((t) => t.id === where.id && t.tenantId === where.tenantId) ?? null),
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; tenantId: string }; data: Record<string, unknown> }) => { const t = threads.find((x) => x.id === where.id && x.tenantId === where.tenantId); if (t) Object.assign(t, data); return { count: t ? 1 : 0 }; }),
    },
    chatAgentPresence: { upsert: jest.fn(async () => ({})) },
    auditLog: { create: jest.fn(async ({ data }: { data: { tenantId: string; action: string } }) => { logs.push(data); return {}; }) },
  };
  const sent: { psid: string; body: string }[] = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_u: string, init: { body: string }) => { const b = JSON.parse(init.body); sent.push({ psid: b.recipient.id, body: b.message.text }); return { ok: true }; });
  return { svc: new StaffAlertsService(prisma as never), settings, threads, logs, sent };
}
const lanA = { userId: 'uA', role: 'STAFF', tenantId: 'A' } as never;

describe('chia turn đợt 1 — one salon at a time', () => {
  it('a code links only on the Page of the salon that issued it', async () => {
    const { svc } = setup();
    const { code } = await svc.newCode(lanA);
    // Salon B's Page receives salon A's code: not a team command there.
    expect(await svc.onPageMessage('B', '999', 'tok', '555', { kind: 'link', code })).toBe(false);
    expect(await svc.onPageMessage('A', '111', 'tok', '555', { kind: 'link', code })).toBe(true);
    expect((await svc.linksOf('A')).uA).toMatchObject({ psid: '555', pageId: '111', on: false });
    expect(await svc.linksOf('B')).toEqual({});
  });

  it('a customer message is never swallowed', async () => {
    const { svc } = setup();
    expect(await svc.onPageMessage('A', '111', 'tok', '777', null)).toBe(false);
    expect(await svc.onPageMessage('A', '111', 'tok', '777', { kind: 'on' })).toBe(false);
  });

  it('vào ca opens alerts; a turn is announced with Nhận / Bỏ qua; ra ca stops it', async () => {
    const { svc, sent, logs } = setup();
    const { code } = await svc.newCode(lanA);
    await svc.onPageMessage('A', '111', 'tok', '555', { kind: 'link', code });
    await svc.onPageMessage('A', '111', 'tok', '555', { kind: 'on' });
    expect(await svc.notifyTurn('A', 'uA', 'tA', { hop: false, fromAd: true, mins: 2 })).toBe(true);
    expect(sent[sent.length - 1].body).toContain('QUẢNG CÁO');
    await svc.onPageMessage('A', '111', 'tok', '555', { kind: 'off' });
    expect(await svc.notifyTurn('A', 'uA', 'tA', { hop: false, fromAd: false, mins: 5 })).toBe(false);
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['messenger.staff_messenger_linked', 'messenger.staff_shift_on', 'messenger.staff_shift_off']));
  });

  it('"Nhận khách" reaches only its own salon conversation', async () => {
    const { svc, threads, sent } = setup();
    const { code } = await svc.newCode(lanA);
    await svc.onPageMessage('A', '111', 'tok', '555', { kind: 'link', code });
    await svc.onPageMessage('A', '111', 'tok', '555', { kind: 'claim', threadId: 'tB' });
    expect(threads.find((t) => t.id === 'tB')!.assignedUserId).toBeNull();
    expect(sent[sent.length - 1].body).toMatch(/Không tìm thấy/);
    await svc.onPageMessage('A', '111', 'tok', '555', { kind: 'claim', threadId: 'tA' });
    expect(sent[sent.length - 1].body).toMatch(/Đã nhận khách/);
  });
});
