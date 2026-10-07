/**
 * "Hỏi nhưng chưa đặt": people who asked on chat or the hotline and never
 * booked. A list for the desk, and an opt-in message for KNOWN customers only.
 */
import { UserRole } from '@prisma/client';
import { askedFromTranscript, askedNotBooked, dueForMessage, phoneKey, type AskCall, type AskThread, type BookingLike } from './asked-not-booked';
import { CampaignsService } from './campaigns.service';

const NOW = new Date(); // the service reads the real clock
const h = (n: number) => new Date(NOW.getTime() - n * 3600_000);
const thread = (o: Partial<AskThread> & { id: string; at: Date }): AskThread => ({
  name: 'Linh', channel: 'messenger', lastText: 'How much is a gel full set?', status: 'open', customerId: null, customer: null, ...o, lastCustomerAt: o.at,
});

describe('who asked and did not book', () => {
  it('lists a chat with no booking, and says whether it can still be answered', () => {
    const rows = askedNotBooked({ threads: [thread({ id: 't1', at: h(2) }), thread({ id: 't2', at: h(30) })], calls: [], bookings: [], handled: {}, now: NOW, days: 14 });
    expect(rows.map((r) => [r.key, r.canMessage])).toEqual([['chat:t1', true], ['chat:t2', false]]);
    expect(rows[0].asked).toBe('How much is a gel full set?');
  });

  it('drops anyone who booked since (or has a visit to come), closed chats, and ones the desk ticked off', () => {
    const bookings: BookingLike[] = [
      { customerId: 'c1', createdAt: h(1), startTime: new Date(NOW.getTime() + 86400_000), phone: '+1 (512) 555-0100' },
    ];
    const rows = askedNotBooked({
      threads: [
        thread({ id: 'booked', at: h(3), customerId: 'c1' }),
        thread({ id: 'done', at: h(3), status: 'done' }),
        thread({ id: 'ticked', at: h(5) }),
        thread({ id: 'askedAgain', at: h(1) }),
        thread({ id: 'old', at: h(24 * 20) }),
      ],
      calls: [],
      bookings,
      handled: { 'chat:ticked': h(4).toISOString(), 'chat:askedAgain': h(3).toISOString() },
      now: NOW, days: 14,
    });
    // Ticked off before their latest message = back on the list.
    expect(rows.map((r) => r.refId)).toEqual(['askedAgain']);
  });

  it('a hotline caller is listed once (latest call), unless their number booked since', () => {
    const calls: AskCall[] = [
      { id: 'k1', fromNumber: '+15125550199', outcome: 'info', createdAt: h(6), lastText: 'Do you do pedicures on Sunday?' },
      { id: 'k2', fromNumber: '5125550199', outcome: 'no_action', createdAt: h(2), lastText: 'Price for kids?' },
      { id: 'k3', fromNumber: '+15125550100', outcome: 'info', createdAt: h(2), lastText: 'hours?' },
      { id: 'k4', fromNumber: '+15125550111', outcome: 'booked', createdAt: h(2), lastText: 'book me' },
    ];
    const bookings: BookingLike[] = [{ customerId: 'c9', createdAt: h(1), startTime: h(-48), phone: '(512) 555-0100' }];
    const rows = askedNotBooked({ threads: [], calls, bookings, handled: {}, now: NOW, days: 14 });
    expect(rows.map((r) => [r.key, r.asked])).toEqual([['call:k2', 'Price for kids?']]);
    expect(rows[0].canMessage).toBe(false);
  });

  it('helpers: phone keys, what a caller asked, and the 1-day send band', () => {
    expect(phoneKey('+1 (512) 555-0199')).toBe(phoneKey('512.555.0199'));
    expect(phoneKey('12')).toBe('');
    expect(askedFromTranscript([{ role: 'assistant', content: 'Hi!' }, { role: 'user', content: 'hi' }, { role: 'user', content: 'how much is a pedicure' }])).toBe('how much is a pedicure');
    const rows = askedNotBooked({ threads: [thread({ id: 'a', at: h(50) }), thread({ id: 'b', at: h(20) })], calls: [], bookings: [], handled: {}, now: NOW, days: 14 });
    expect(dueForMessage(rows, NOW, 2).map((r) => r.refId)).toEqual(['a']);
  });
});

describe('the desk list and the automatic message, per salon', () => {
  function make() {
    const settings = new Map<string, unknown>();
    const k = (w: any) => `${w.tenantId_key.tenantId}::${w.tenantId_key.key}`; // eslint-disable-line @typescript-eslint/no-explicit-any
    const threads = [
      { id: 'tA', tenantId: 'A', senderName: 'Linh', channel: 'instagram', lastText: 'gel price?', lastCustomerAt: h(50), status: 'open', customerId: 'cA', customer: { firstName: 'Linh', phone: null, email: 'linh@x.test' } },
      { id: 'tA2', tenantId: 'A', senderName: 'Stranger', channel: 'messenger', lastText: 'open sunday?', lastCustomerAt: h(50), status: 'open', customerId: null, customer: null },
      { id: 'tB', tenantId: 'B', senderName: 'Other', channel: 'messenger', lastText: 'hi', lastCustomerAt: h(50), status: 'open', customerId: 'cB', customer: { firstName: 'Bo', phone: null, email: 'bo@x.test' } },
    ];
    const sent: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const prisma: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
      setting: {
        findUnique: jest.fn(async ({ where }: any) => (settings.has(k(where)) ? { value: settings.get(k(where)) } : null)), // eslint-disable-line @typescript-eslint/no-explicit-any
        upsert: jest.fn(async ({ where, create, update }: any) => { settings.set(k(where), settings.has(k(where)) ? update.value : create.value); return {}; }), // eslint-disable-line @typescript-eslint/no-explicit-any
      },
      messengerThread: { findMany: jest.fn(async ({ where }: any) => threads.filter((t) => t.tenantId === where.tenantId)) }, // eslint-disable-line @typescript-eslint/no-explicit-any
      voiceCall: { findMany: jest.fn(async () => []) },
      appointment: { findMany: jest.fn(async () => []) },
      customer: { findMany: jest.fn(async ({ where }: any) => [{ id: 'cA', tenantId: 'A', firstName: 'Linh', email: 'linh@x.test', phone: null, smsConsent: false }, { id: 'cB', tenantId: 'B', firstName: 'Bo', email: 'bo@x.test', phone: null, smsConsent: false }].filter((c) => c.tenantId === where.tenantId && (!where.id?.in || where.id.in.includes(c.id)))) }, // eslint-disable-line @typescript-eslint/no-explicit-any
      notification: { findFirst: jest.fn(async () => null) },
      tenant: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, name: `Salon ${where.id}`, slug: where.id.toLowerCase(), contactEmail: null, contactPhone: null, timezone: 'UTC', branding: null })) }, // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const notifications = { send: jest.fn(async (m: any) => { sent.push(m); return { status: 'SENT' }; }) }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const sets = { getNotificationSettings: jest.fn(async () => ({ twilio: {}, smtp: {}, brevo: {}, gmail: {} })), brandingFrom: () => ({ accentColor: '#6366f1' }), getCompanyExtra: jest.fn(async () => ({})) };
    const referral = { getForTenant: jest.fn(async () => ({ enabled: false })), ensureLinkForCustomer: jest.fn(async () => null) };
    const svc = new CampaignsService(prisma, notifications as never, sets as never, referral as never);
    return { svc, prisma, sent };
  }
  const user = (t: string) => ({ userId: `u-${t}`, role: UserRole.SALON_ADMIN, tenantId: t }) as never;

  it('the list is THIS salon’s askers only', async () => {
    const { svc } = make();
    const r = await svc.askedNotBookedList(user('A'));
    expect(r.rows.map((x) => x.refId).sort()).toEqual(['tA', 'tA2']);
  });

  it('"Đã xử lý" takes one person off THIS salon’s list only', async () => {
    const { svc } = make();
    await svc.markAskedHandled(user('A'), 'chat:tA2');
    expect((await svc.askedNotBookedList(user('A'))).rows.map((x) => x.refId)).toEqual(['tA']);
    expect((await svc.askedNotBookedList(user('B'))).rows.map((x) => x.refId)).toEqual(['tB']);
    await expect(svc.markAskedHandled(user('A'), 'drop table')).rejects.toThrow();
  });

  it('the automatic message goes to the KNOWN customer only — never a stranger — and is off by default', async () => {
    const { svc, sent } = make();
    expect((await svc.runNow(user('A'))).askedNotBooked).toBe(0); // off by default
    await svc.updateSettings(user('A'), { askedNotBooked: { enabled: true, email: true, sms: true, daysSince: 2 } });
    const r = await svc.runNow(user('A'));
    expect(r.askedNotBooked).toBe(1);
    expect(sent.map((m) => m.recipient)).toEqual(['linh@x.test']); // no SMS: no consent; no stranger; nobody from salon B
    expect(sent[0].relatedType).toBe('campaign:askedNotBooked');
  });
});
