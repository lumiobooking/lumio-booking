/**
 * The agency board puts the salon that needs a person first, and reads each
 * salon through tenant-pinned calls only.
 */
import { ReportsBoardService, boardOrder, type BoardRow } from './reports-board.service';

const row = (over: Partial<BoardRow>): BoardRow => ({
  tenantId: 't', name: 'Z', slug: 'z', market: null, state: 'draft', nextAction: 'review', autoSend: false, autoSendDue: false,
  report: null, health: { worst: 'ok', counts: { ok: 1, warn: 0, bad: 0, off: 0 }, bad: [] }, posts: 0, measuredAt: null, queued: 0, guardStray: 0,
  ...over,
});

describe('board order', () => {
  it('red channels, stray figures and waiting drafts come before sent reports', () => {
    const rows = [
      row({ name: 'Sent', state: 'sent', nextAction: 'done' }),
      row({ name: 'Draft', state: 'draft', nextAction: 'review' }),
      row({ name: 'Broken', state: 'collecting', nextAction: 'wait', health: { worst: 'bad', counts: { ok: 0, warn: 0, bad: 1, off: 0 }, bad: ['meta_social: permission'] } }),
      row({ name: 'Stray', state: 'approved', nextAction: 'send', guardStray: 2 }),
      row({ name: 'Quiet', state: 'collecting', nextAction: 'wait' }),
    ].sort(boardOrder);
    expect(rows.map((r) => r.name)).toEqual(['Broken', 'Stray', 'Draft', 'Quiet', 'Sent']);
  });
});

describe('board rows', () => {
  it('one row per active salon, each read as that salon only', async () => {
    const healthCalls: string[] = [];
    const prisma: any = {
      tenant: { findMany: async () => [{ id: 't1', name: 'A', slug: 'a', market: 'US', timezone: 'America/Chicago' }, { id: 't2', name: 'B', slug: 'b', market: 'VN', timezone: 'Asia/Ho_Chi_Minh' }] },
      marketingReport: { findMany: async () => [{ tenantId: 't2', status: 'review', approvedAt: null, sentAt: null, updatedAt: new Date(), content: { _guard: { stray: [{ path: 'tldr.vi', figure: '15000' }] } } }] },
    };
    const marketing: any = { getReportPolicy: async (id: string) => ({ autoSend: id === 't2', sendDay: 5, extraRecipients: [] }) };
    const queue: any = {
      health: async (_u: unknown, _m: string, tenantId: string) => {
        healthCalls.push(tenantId);
        return { channels: [{ platform: 'meta_social', level: tenantId === 't1' ? 'bad' : 'ok', key: tenantId === 't1' ? 'permission' : 'fresh', detail: tenantId === 't1' ? 'pages_read_engagement' : null }], posts: { total: 4, measuredAt: null }, queued: 0 };
      },
    };
    const svc = new ReportsBoardService(prisma, marketing, queue);
    const b = await svc.board('2026-09');
    expect(healthCalls.sort()).toEqual(['t1', 't2']);
    expect(b.rows.map((r) => r.name)).toEqual(['A', 'B']); // A: red channel first
    expect(b.rows[0].health.bad).toEqual(['meta_social: permission (pages_read_engagement)']);
    expect(b.rows[1]).toMatchObject({ state: 'draft', nextAction: 'auto-send', autoSend: true, guardStray: 1, posts: 4 });
    expect(b.totals).toMatchObject({ draft: 1 });
  });
});
