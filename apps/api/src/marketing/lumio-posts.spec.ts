import { lumioPostsOn, monthBounds } from './lumio-posts';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The TikTok "posts this month" line, counted from Lumio's own publish log —
 * TikTok gives no count without the video.list permission the owner chose not
 * to apply for.
 */
describe('TikTok posts counted from what Lumio published', () => {
  const { from, to } = monthBounds('2026-10');
  const rows = [
    { postedAt: '2026-10-03T10:00:00Z', results: [{ channel: 'tiktok', id: 'v1', url: 'https://tiktok.com/@x/video/1', error: null }, { channel: 'facebook', id: 'f1', url: null, error: null }] },
    { postedAt: '2026-10-20T10:00:00Z', results: [{ channel: 'tiktok', id: null, url: null, error: 'quota' }] },          // failed
    { postedAt: '2026-10-21T10:00:00Z', results: [{ channel: 'tiktok', id: null, url: null, error: null, unsure: true }] }, // network did not answer
    { postedAt: '2026-09-30T23:00:00Z', results: [{ channel: 'tiktok', id: 'v0', url: null, error: null }] },             // last month
    { postedAt: null, results: [{ channel: 'tiktok', id: 'v9', url: null, error: null }] },
  ];
  it('counts only the posts that went up, on TikTok, this month', () => {
    const out = lumioPostsOn(rows, 'tiktok', from, to);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'v1', url: 'https://tiktok.com/@x/video/1' });
  });
  it('month bounds are [1st, next 1st)', () => {
    expect(monthBounds('2026-12')).toEqual({ from: new Date('2026-12-01T00:00:00Z'), to: new Date('2027-01-01T00:00:00Z') });
  });
  it('the report reads THIS salon’s published posts only and labels the source', () => {
    const src = readFileSync(join(__dirname, 'marketing.service.ts'), 'utf8');
    expect(src).toMatch(/scheduledPost\.findMany\(\{\s*where: \{ tenantId, status: 'posted', postedAt: \{ gte: from, lt: to \} \}/);
    expect(src).toMatch(/postsSource = 'lumio'/);
  });
});
