/**
 * Dental recall, and reminder wording per trade. A nail salon's message is
 * untouched; a clinic never hears about its patients' nails.
 */
import { rebookCopy, recallDue, recallMonthsOf } from './recall';
import { readFileSync } from 'fs';
import { join } from 'path';

const NOW = new Date('2026-10-07T12:00:00Z');
const monthsAgo = (m: number) => new Date(NOW.getTime() - Math.round(m * 30.44) * 86_400_000);

describe('when a recall is due', () => {
  it('N months after the last visit, once, never with a visit booked', () => {
    expect(recallDue({ lastVisitEnd: monthsAgo(6.1), months: 6, remindedAt: null, hasUpcoming: false, now: NOW })).toBe(true);
    expect(recallDue({ lastVisitEnd: monthsAgo(5.5), months: 6, remindedAt: null, hasUpcoming: false, now: NOW })).toBe(false);
    expect(recallDue({ lastVisitEnd: monthsAgo(7), months: 6, remindedAt: null, hasUpcoming: true, now: NOW })).toBe(false);
    expect(recallDue({ lastVisitEnd: monthsAgo(7), months: 6, remindedAt: monthsAgo(0.5), hasUpcoming: false, now: NOW })).toBe(false); // already reminded
    expect(recallDue({ lastVisitEnd: monthsAgo(7), months: 0, remindedAt: null, hasUpcoming: false, now: NOW })).toBe(false);
  });
  it('reads the months off the patient record', () => {
    expect(recallMonthsOf({ recallMonths: 6 })).toBe(6);
    expect(recallMonthsOf({ recallMonths: '12' })).toBe(12);
    expect(recallMonthsOf({})).toBeNull();
    expect(recallMonthsOf({ recallMonths: 999 })).toBeNull();
  });
});

describe('the words, per trade', () => {
  const o = { salon: 'Smile Dental', cust: 'Anna', service: 'Cleaning', months: 6, url: 'https://x/smile' };
  it('a nail salon keeps its own message', () => {
    expect(rebookCopy('NAIL', o)).toBeNull();
  });
  it('a clinic: check-up, never nails', () => {
    const c = rebookCopy('DENTAL', o)!;
    expect(c.subject).toMatch(/check-up/);
    expect(`${c.subject} ${c.body} ${c.text} ${c.sms}`).not.toMatch(/nail|💅/i);
    expect(c.text).toMatch(/6 months/);
    expect(c.sms).toMatch(/STOP/);
  });
  it('every other trade: neutral next-visit wording', () => {
    for (const k of ['LASH', 'HAIR', 'SPA', 'MASSAGE', 'RESTAURANT', 'REAL_ESTATE', 'SERVICE']) {
      const c = rebookCopy(k, o)!;
      expect(`${c.subject} ${c.body} ${c.sms}`).not.toMatch(/nail|💅|refill/i);
    }
  });
  it('wired: the reminder tick runs the recall pass, per clinic, same opt-in switch', () => {
    const svc = readFileSync(join(__dirname, 'bookings.service.ts'), 'utf8');
    expect(svc).toMatch(/async processDueRecalls\(/);
    expect(svc).toMatch(/if \(!rb\.enabled \|\| \(!rb\.email && !rb\.sms\)\) continue;/);
    expect(svc).toMatch(/where: \{ tenantId, customerId: c\.id, status: AppointmentStatus\.COMPLETED \}/);
    expect(readFileSync(join(__dirname, 'reminder.service.ts'), 'utf8')).toMatch(/processDueRecalls\(\)/);
  });
});

describe('the recall pass, clinic by clinic', () => {
  it('reminds a due patient of THIS clinic only, and stamps her record in that clinic', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BookingsService } = require('./bookings.service');
    const updates: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const prisma: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
      setting: {
        findMany: jest.fn(async () => [{ tenantId: 'A', value: { key: 'DENTAL' } }, { tenantId: 'B', value: { key: 'NAIL' } }]),
        findUnique: jest.fn(async ({ where }: any) => ({ value: { key: where.tenantId_key.tenantId === 'A' ? 'DENTAL' : 'NAIL' } })), // eslint-disable-line @typescript-eslint/no-explicit-any
      },
      tenant: { findUnique: jest.fn(async ({ where }: any) => ({ businessType: where.id === 'A' ? 'SERVICE' : 'SALON' })) }, // eslint-disable-line @typescript-eslint/no-explicit-any
      customer: {
        findMany: jest.fn(async ({ where }: any) => (where.tenantId === 'A' // eslint-disable-line @typescript-eslint/no-explicit-any
          ? [{ id: 'p1', firstName: 'Anna', email: 'a@x.test', phone: null, rebookRemindedAt: null, industryFields: { recallMonths: 6 } },
            { id: 'p2', firstName: 'Bo', email: 'b@x.test', phone: null, rebookRemindedAt: null, industryFields: {} }]
          : [{ id: 'n1', firstName: 'Nail', email: 'n@x.test', phone: null, rebookRemindedAt: null, industryFields: { recallMonths: 6 } }])),
        updateMany: jest.fn(async (a: any) => { updates.push(a.where); return { count: 1 }; }), // eslint-disable-line @typescript-eslint/no-explicit-any
      },
      appointment: {
        findFirst: jest.fn(async ({ where }: any) => (where.status && where.status === 'COMPLETED' ? { id: 'v1', endTime: monthsAgo(6.5), service: { name: 'Cleaning' } } : null)), // eslint-disable-line @typescript-eslint/no-explicit-any
      },
    };
    const settings = { getRebookingSettings: jest.fn(async () => ({ enabled: true, daysAfter: 21, email: true, sms: false })) };
    const svc = new BookingsService(prisma, {} as never, {} as never, {} as never, settings as never, {} as never, {} as never, {} as never, {} as never);
    (svc as any).messagedWithin = jest.fn(async () => false); // eslint-disable-line @typescript-eslint/no-explicit-any
    const send = jest.fn(async () => true);
    (svc as any).sendRebookingFor = send; // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await svc.processDueRecalls(NOW);
    expect(r.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown[])[0]).toBe('A');
    expect((send.mock.calls[0] as unknown[])[3]).toEqual({ industry: 'DENTAL', months: 6 });
    expect(updates).toEqual([{ id: 'p1', tenantId: 'A' }]);
  });
});
