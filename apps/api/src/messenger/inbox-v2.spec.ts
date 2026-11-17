/**
 * The new Inbox (17/11/2026), server side: which salon sees it, what the
 * customer panel is given, and that a lead is only ever read or changed
 * inside the caller's own salon.
 */
import { MessengerService } from './messenger.service';
import { MessengerController } from './messenger.controller';

type Row = Record<string, unknown>;
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // a page that sells (test account)
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // a paying salon
const user = (tenantId: string, role = 'SALON_ADMIN') => ({ userId: `u-${tenantId.slice(0, 1)}`, tenantId, role }) as never;

function build() {
  const threads: Row[] = [
    { id: 't-a', tenantId: A, senderName: 'Chị Lan', pageId: 'pg-a', senderId: 'p1' },
    { id: 't-b', tenantId: B, senderName: 'Kim', pageId: 'pg-b', senderId: 'p2' },
  ];
  const leads: Row[] = [{ id: 'l-b', tenantId: B, threadId: 't-b', name: 'Kim', phone: '111', salonName: 'Kim Nails', city: null, interest: null, note: null, status: 'NEW', createdAt: new Date() }];
  const audits: Row[] = [];
  const match = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => row[k] === v);
  const prisma = {
    messengerThread: { findFirst: async (q: { where: Row }) => threads.find((t) => match(t, q.where)) ?? null },
    messengerConnection: { findUnique: async (q: { where: { tenantId: string } }) => (q.where.tenantId === A ? { tenantId: A, enabled: true, botMode: 'sales' } : { tenantId: B, enabled: false, botMode: 'booking' }) },
    messengerPage: { count: async (q: { where: { tenantId: string } }) => (q.where.tenantId === A ? 2 : 1) },
    salesLead: {
      findFirst: async (q: { where: Row }) => leads.find((l) => match(l, q.where)) ?? null,
      updateMany: async (q: { where: Row; data: Row }) => { const hit = leads.filter((l) => match(l, q.where)); hit.forEach((l) => Object.assign(l, q.data)); return { count: hit.length }; },
      create: async (q: { data: Row }) => { const row = { id: `l-${leads.length + 1}`, createdAt: new Date(), salonName: null, city: null, interest: null, note: null, status: 'NEW', ...q.data }; leads.push(row); return row; },
    },
    auditLog: { create: async (q: { data: Row }) => { audits.push(q.data); return {}; } },
  };
  const release = { isOn: (f: string, id: string) => f === 'inboxV2' && id === A, isTestAccount: (id: string) => id === A, testAccountIds: () => [A] };
  const s = new MessengerService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    undefined, undefined, undefined, undefined, undefined, undefined, release as never);
  return { s, leads, audits };
}

describe('the new Inbox — who sees it', () => {
  it('is answered per salon from the release channel, with the kind of page and the AI switch', async () => {
    const { s } = build();
    expect(await s.inboxUi(user(A))).toEqual({ v2: true, pageKind: 'sales', aiOn: true, channels: 2 });
    expect(await s.inboxUi(user(B))).toEqual({ v2: false, pageKind: 'booking', aiOn: false, channels: 1 });
  });

  it('a build with no release channel wired keeps every salon on the inbox it had', async () => {
    const { s } = build();
    (s as unknown as { release?: unknown }).release = undefined;
    expect((await s.inboxUi(user(A))).v2).toBe(false);
  });

  it('is for the people who work the inbox — owner and staff — and takes no tenant from the request', () => {
    const roles = (m: string) => Reflect.getMetadata('roles', (MessengerController.prototype as unknown as Record<string, object>)[m]) as string[];
    expect(roles('inboxUi').sort()).toEqual(['SALON_ADMIN', 'STAFF']);
    expect(roles('threadLead').sort()).toEqual(['SALON_ADMIN', 'STAFF']);
    expect(MessengerController.prototype.inboxUi.length).toBe(1); // the signed-in user, nothing else
  });
});

describe('the lead beside a conversation — one salon only', () => {
  it('writes the lead down when the AI noted nothing, under the caller\'s salon and this thread', async () => {
    const { s, leads, audits } = build();
    const lead = await s.saveThreadLead(user(A), 't-a', { phone: '(713) 555-0142', salonName: '  Sunny   Nails ' });
    expect(lead).toMatchObject({ name: 'Chị Lan', phone: '(713) 555-0142', salonName: 'Sunny Nails', status: 'NEW' });
    expect(leads.find((l) => l.threadId === 't-a')).toMatchObject({ tenantId: A });
    expect(audits).toEqual([expect.objectContaining({ tenantId: A, userId: 'u-a', action: 'messenger.lead_created', resourceId: 't-a' })]);
  });

  it('corrects the one that exists, moves it along the sale, and logs who did', async () => {
    const { s, leads, audits } = build();
    await s.saveThreadLead(user(B), 't-b', { city: 'Houston, TX', status: 'QUOTED' });
    expect(leads[0]).toMatchObject({ city: 'Houston, TX', status: 'QUOTED', salonName: 'Kim Nails' });
    expect(audits[0]).toMatchObject({ tenantId: B, action: 'messenger.lead_updated' });
    await s.saveThreadLead(user(B), 't-b', { status: 'CLOSING' });
    expect(leads[0].status).toBe('CLOSING');
  });

  it('CROSS-TENANT: another salon\'s thread is "not found" — nothing is read, written or logged', async () => {
    const { s, leads, audits } = build();
    await expect(s.saveThreadLead(user(A), 't-b', { salonName: 'Stolen' })).rejects.toThrow('Thread not found');
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ tenantId: B, salonName: 'Kim Nails' });
    expect(audits).toHaveLength(0);
  });

  it('refuses a stage that does not exist and an empty save', async () => {
    const { s } = build();
    await expect(s.saveThreadLead(user(B), 't-b', { status: 'HACKED' })).rejects.toThrow('Unknown status');
    await expect(s.saveThreadLead(user(B), 't-b', {})).rejects.toThrow('Nothing to save');
  });

  it('keeps only what a phone number is made of', async () => {
    const { s, leads } = build();
    await s.saveThreadLead(user(B), 't-b', { phone: '+1 (713) 555-0142 <script>' });
    expect(leads[0].phone).toBe('+1 (713) 555-0142');
  });
});
