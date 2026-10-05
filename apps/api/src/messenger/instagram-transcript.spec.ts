/**
 * The Instagram inbox showed every bot reply TWICE — once as a grey "Customer"
 * bubble, once as the bot — because Meta's transcript tags a business message
 * in an Instagram conversation as `from` the IG account, not the Facebook
 * Page, and the role test was `from.id === pageId`. The merge keys on
 * role + text, so Meta's mis-tagged copy and our own copy both stayed.
 *
 * Also guarded here: the booking prompt's wording rules that the same
 * screenshots exposed — "Monday 11:00 is booked in" before a name or phone
 * existed, and "plenty of slots" instead of times a customer can pick from.
 */
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  AppointmentStatus: { CANCELLED: 'CANCELLED' },
}));
import { readFileSync } from 'fs';
import { join } from 'path';
import { metaRole, mergeHistory, HistoryTurn } from './history-merge';
import { MessengerService } from './messenger.service';

const PAGE = '1111'; const IG = '2222'; const PSID = '383843';

describe('who wrote a message in Meta’s transcript', () => {
  it('Messenger: the Page’s messages are the salon’s, the PSID’s are the customer’s', () => {
    expect(metaRole(PAGE, PSID, [PAGE])).toBe('assistant');
    expect(metaRole(PSID, PSID, [PAGE])).toBe('user');
  });

  it('Instagram: the IG account’s messages are the salon’s — not the customer’s', () => {
    expect(metaRole(IG, PSID, [PAGE, IG])).toBe('assistant');
    // Even when the IG id was never stored: in a conversation fetched for ONE
    // customer, anyone who is not that customer is the business.
    expect(metaRole(IG, PSID, [PAGE])).toBe('assistant');
    expect(metaRole(PSID, PSID, [PAGE, IG])).toBe('user');
  });

  it('a message with no author is shown as inbound (the old, conservative default)', () => {
    expect(metaRole('', PSID, [PAGE, IG])).toBe('user');
    expect(metaRole(undefined, PSID, [PAGE, IG])).toBe('user');
  });

  it('merging Meta’s IG transcript with our buffer draws each bot reply ONCE', () => {
    const say = (from: string, content: string, at: string): HistoryTurn => ({ role: metaRole(from, PSID, [PAGE, IG]), content, at });
    const meta = [
      say(PSID, 'hi, pedicure tomorrow?', '2026-10-05T07:50:00Z'),
      say(IG, 'Perfect! When would you like to come in?', '2026-10-05T07:58:00Z'),
    ];
    const local: HistoryTurn[] = [
      { role: 'user', content: 'hi, pedicure tomorrow?', at: '2026-10-05T07:50:00Z' },
      { role: 'assistant', content: 'Perfect! When would you like to come in?', at: '2026-10-05T07:58:00Z' },
    ];
    const out = mergeHistory(meta, local);
    expect(out).toHaveLength(2);
    expect(out.map((t) => t.role)).toEqual(['user', 'assistant']);
  });
});

describe('fetchMetaHistory on an Instagram thread', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('tags the IG account’s messages as the salon and the customer’s as the customer', async () => {
    global.fetch = (async () => ({
      json: async () => ({
        data: [{ messages: { data: [
          { id: 'm3', message: 'Great — 11:00 AM works 👍 What’s your first name?', from: { id: IG }, created_time: '2026-10-05T08:46:00+0000' },
          { id: 'm2', message: 'Monday 11', from: { id: PSID }, created_time: '2026-10-05T08:45:00+0000' },
          { id: 'm1', message: 'Perfect! When would you like to come in?', from: { id: IG }, created_time: '2026-10-05T07:58:00+0000' },
        ] } }],
      }),
    })) as unknown as typeof fetch;
    const svc = new MessengerService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const turns = await (svc as unknown as {
      fetchMetaHistory: (p: string, t: string, s: string, pl: string, own: string[]) => Promise<HistoryTurn[] | null>;
    }).fetchMetaHistory(PAGE, 'tok', PSID, 'INSTAGRAM', [IG]);
    expect(turns?.map((t) => t.role)).toEqual(['assistant', 'user', 'assistant']);
    expect(turns?.[0].content).toBe('Perfect! When would you like to come in?');
  });

  it('still classifies the salon correctly when the IG id was never stored', async () => {
    global.fetch = (async () => ({
      json: async () => ({ data: [{ messages: { data: [
        { id: 'm1', message: 'Hi there!', from: { id: IG }, created_time: '2026-10-05T07:58:00+0000' },
        { id: 'm0', message: 'hello', from: { id: PSID }, created_time: '2026-10-05T07:57:00+0000' },
      ] } }] }),
    })) as unknown as typeof fetch;
    const svc = new MessengerService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const turns = await (svc as unknown as {
      fetchMetaHistory: (p: string, t: string, s: string, pl: string, own: (string | null)[]) => Promise<HistoryTurn[] | null>;
    }).fetchMetaHistory(PAGE, 'tok', PSID, 'INSTAGRAM', [null]);
    expect(turns?.map((t) => t.role)).toEqual(['user', 'assistant']);
  });
});

describe('the booking prompt’s wording rules', () => {
  const src = readFileSync(join(__dirname, 'messenger.service.ts'), 'utf8');

  it('an agreed time is never called "booked" before create_booking succeeded', () => {
    expect(src).toContain('AN AGREED TIME IS NOT A BOOKING');
    expect(src).toMatch(/never say "booked", "booked in", "reserved"/);
  });

  it('a day without a time gets 2–3 concrete times, never "plenty of slots"', () => {
    expect(src).toMatch(/offer 2–3 concrete open times from the tool/);
    expect(src).toMatch(/never say "plenty of slots"/);
  });

  it('name and phone are asked together, in one message', () => {
    expect(src).toMatch(/3\. NAME \+ PHONE, in ONE message/);
    expect(src).not.toMatch(/^3\. NAMES: their first name/m);
    expect(src).not.toMatch(/^4\. PHONE:/m);
  });

  it('confirms ONCE with a full recap before booking — the owner wants this step kept', () => {
    expect(src).toContain('CONFIRM BEFORE BOOKING — always, exactly once.');
    expect(src).toMatch(/do not call create_booking yet/);
    expect(src).toMatch(/Always the weekday AND the date, every service, every person's name for a group, and the phone/);
    expect(src).toMatch(/Any agreement[^\n]*means call create_booking NOW/);
    expect(src).toMatch(/Never recap a second time/);
    expect(src).not.toContain('NO "SHALL I BOOK IT?"');
  });

  it('the shared availability text tells both assistants to read it back and confirm', () => {
    const shared = readFileSync(join(__dirname, '..', 'bookings', 'party-availability.service.ts'), 'utf8');
    expect(shared).toContain('then read it all back and confirm');
  });

  it('the IG account id reaches the transcript reader', () => {
    expect(src).toMatch(/select: \{ pageToken: true, igId: true \}/);
    expect(src).toMatch(/\[pgTok\?\.igId, \(conn as \{ igId\?: string \| null \} \| null\)\?\.igId\]/);
  });
});
