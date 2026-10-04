/**
 * "Google không kết nối nhưng lại kéo thông tin từ tài khoản khác."
 *
 * The reviews belong to the LOCATION that was connected, not to the salon.
 * Disconnecting now takes them with it, and a salon left with reviews but no
 * connection can clear them in one press — its own tenant only.
 */
import { GoogleReviewsService } from './google-reviews.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function make(settingsByTenant: Record<string, Row>, reviews: Row[]) {
  const deletes: Row[] = [];
  const writes: Row[] = [];
  const prisma: Row = {
    setting: {
      findUnique: async ({ where }: Row) => { const v = settingsByTenant[where.tenantId_key.tenantId]; return v ? { value: v } : null; },
      upsert: async ({ where, update }: Row) => { writes.push(where.tenantId_key.tenantId); settingsByTenant[where.tenantId_key.tenantId] = update.value; return { value: update.value }; },
    },
    googleReview: {
      deleteMany: async ({ where }: Row) => { deletes.push(where); const n = reviews.filter((r) => r.tenantId === where.tenantId).length; for (let i = reviews.length - 1; i >= 0; i--) if (reviews[i].tenantId === where.tenantId) reviews.splice(i, 1); return { count: n }; },
      groupBy: async ({ where }: Row) => { const m: Record<string, number> = {}; for (const r of reviews) if (r.tenantId === where.tenantId) m[r.status] = (m[r.status] ?? 0) + 1; return Object.entries(m).map(([status, n]) => ({ status, _count: n })); },
      count: async ({ where }: Row) => reviews.filter((r) => r.tenantId === where.tenantId && r.replyText).length,
    },
    auditLog: { create: async () => undefined },
  };
  const svc = new GoogleReviewsService(prisma as never, {} as never, {} as never);
  return { svc, deletes, writes, reviews, settingsByTenant };
}
const glow = { userId: 'u', tenantId: 'glow', role: 'SALON_ADMIN' } as never;

describe('reviews never outlive the connection they came from', () => {
  it('disconnecting drops the mirrored reviews, the totals and the review link — of this salon only', async () => {
    const f = make(
      { glow: { connected: true, refreshToken: 'r', accountId: 'a', locationId: 'l', locationTitle: 'Linda Nails', googleTotal: 132, googleRating: 4.5, placeId: 'p1', newReviewUri: 'https://g/x' }, lily: { connected: true, refreshToken: 'r2', googleTotal: 9 } },
      [{ id: '1', tenantId: 'glow', status: 'DRAFTED' }, { id: '2', tenantId: 'glow', status: 'REPLIED', replyText: 'thanks' }, { id: '3', tenantId: 'lily', status: 'DRAFTED' }],
    );
    const out: Row = await f.svc.disconnect(glow);
    expect(out.connected).toBe(false);
    expect(out.google.mirrored).toBe(0);
    expect(out.google.total).toBeNull();
    expect(out.reviewLink).toBe('');
    expect(f.reviews.map((r) => r.tenantId)).toEqual(['lily']);
    for (const d of f.deletes) expect(d.tenantId).toBe('glow');
    expect(f.settingsByTenant.lily.googleTotal).toBe(9);
  });

  it('a salon with reviews on file and no connection is told so, and can clear them', async () => {
    const f = make(
      { glow: { connected: false, refreshToken: '', googleTotal: 132, googleRating: 4.5 } },
      [{ id: '1', tenantId: 'glow', status: 'DRAFTED' }, { id: '2', tenantId: 'other', status: 'DRAFTED' }],
    );
    const before: Row = await f.svc.get(glow);
    expect(before.stale).toBe(true);
    const out: Row = await f.svc.purgeStale(glow);
    expect(out.removed).toBe(1);
    expect(out.stale).toBe(false);
    expect(out.google.total).toBeNull();
    expect(f.reviews.map((r) => r.tenantId)).toEqual(['other']);
  });

  it('while connected the clean-up is refused — "reset & re-sync" is the right button there', async () => {
    const f = make({ glow: { connected: true, refreshToken: 'r' } }, [{ id: '1', tenantId: 'glow', status: 'DRAFTED' }]);
    expect((await f.svc.get(glow)).stale).toBe(false);
    await expect(f.svc.purgeStale(glow)).rejects.toThrow(/connected/);
    expect(f.reviews).toHaveLength(1);
  });
});
