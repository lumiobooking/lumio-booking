/**
 * Phase 2: how the bot is doing, per salon — conversations, bookings, where
 * the rest stopped, and the next steps that follow from it.
 */
import { botReport, tipsFor, type ReportThread } from './bot-report';
import { BotReportService } from './bot-report.service';

const FROM = new Date('2026-09-06T00:00:00Z');
const TO = new Date('2026-10-06T00:00:00Z');
const at = (d: string) => new Date(d).toISOString();
const th = (id: string, turns: [string, string, string, boolean?][], o: Partial<ReportThread> = {}): ReportThread => ({
  id, channel: 'messenger', handoff: false, customerId: null, lastMessageAt: new Date(turns[turns.length - 1]?.[2] ?? TO),
  history: turns.map(([role, content, when, nudge]) => ({ role: role as 'user' | 'assistant', content, at: at(when), ...(nudge ? { nudge: true } : {}) })),
  ...o,
});

describe('the bot report', () => {
  const threads: ReportThread[] = [
    th('booked', [['user', 'gel full set sat?', '2026-10-01T10:00:00Z'], ['assistant', 'Booked ✓', '2026-10-01T10:20:00Z']], { customerId: 'c1', channel: 'instagram' }),
    th('stopContact', [['user', 'pedicure tmr?', '2026-10-02T10:00:00Z'], ['assistant', 'Great — what is your first name and phone number?', '2026-10-02T10:01:00Z']]),
    th('stopConfirm', [['user', 'ok 3pm', '2026-10-02T11:00:00Z'], ['assistant', 'Sat 3:00 PM, gel manicure, Anna, 512…  Shall I book it?', '2026-10-02T11:01:00Z'], ['assistant', 'Still want me to book?', '2026-10-02T12:00:00Z', true]]),
    th('stopTime', [['user', 'tomorrow?', '2026-10-03T10:00:00Z'], ['assistant', 'Tomorrow I have 10:00, 1:30 or 4:00 — which works for you?', '2026-10-03T10:01:00Z']]),
    th('noReply', [['assistant', 'Hi!', '2026-10-03T09:00:00Z'], ['user', 'hello??', '2026-10-03T10:00:00Z']]),
    th('human', [['user', 'complaint', '2026-10-04T10:00:00Z']], { handoff: true }),
    th('lastMonth', [['user', 'old', '2026-08-01T10:00:00Z']]),
  ];
  const r = botReport({ threads, bookings: [{ customerId: 'c1', createdAt: new Date('2026-10-01T10:19:00Z') }], gapsOpen: 3, gapsNew: 2, from: FROM, to: TO });

  it('counts conversations of the period and the ones that booked', () => {
    expect(r.conversations).toBe(6);
    expect(r.booked).toBe(1);
    expect(r.bookingRate).toBeCloseTo(1 / 6);
    expect(r.medianMinutesToBook).toBe(19);
    expect(r.byChannel).toEqual({ instagram: { conversations: 1, booked: 1 }, messenger: { conversations: 5, booked: 0 } });
  });

  it('says where everyone else stopped (a follow-up nudge does not count as the bot’s last word)', () => {
    expect(r.stoppedAt).toEqual({ time: 1, contact: 1, confirm: 1, general: 0, noReply: 1, human: 1 });
    expect(r.unanswered).toEqual({ open: 3, newInPeriod: 2 });
  });

  it('turns the biggest leaks into next steps, open questions first', () => {
    expect(r.tips[0].vi).toMatch(/Trả lời 3 câu bot chưa biết/);
    const t = tipsFor({ conversations: 40, rate: 0.1, stoppedAt: { time: 0, contact: 6, confirm: 0, general: 0, noReply: 0, human: 0 }, gapsOpen: 0 });
    expect(t[0].en).toMatch(/6 customers stopped when asked for name \+ phone/);
    expect(t.length).toBeLessThanOrEqual(3);
  });
});

describe('the report reads ONE salon', () => {
  it('every query is scoped to the caller’s tenant', async () => {
    const calls: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const rec = (name: string, out: unknown) => jest.fn(async (a: any) => { calls.push([name, a.where]); return out; }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const prisma: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
      messengerThread: { findMany: rec('threads', []) },
      appointment: { findMany: rec('appts', []) },
      botKnowledgeGap: { count: rec('gaps', 0) },
    };
    const svc = new BotReportService(prisma);
    const out = await svc.report({ userId: 'u', role: 'SALON_ADMIN', tenantId: 'A' } as never, 7);
    expect(out.days).toBe(7);
    expect(calls.every(([, w]) => w.tenantId === 'A')).toBe(true);
    await expect(svc.report({ userId: 's', role: 'SUPER_ADMIN', tenantId: null } as never)).rejects.toThrow();
  });
});
