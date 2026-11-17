import { readiness, aiTiles, aiFunnel, type AiNumbers } from './ai-readiness';

const N = (o: Partial<AiNumbers> = {}): AiNumbers => ({ days: 7, conversations: 326, selfHandled: 50, selfHandledRate: 50 / 326, humanTook: 233, booked: 0, leads: 31, botReplies: 59, medianSec: 14, p90Sec: 48, blockRate: 0.37, waitingNow: 9, stoppedAt: { general: 52, contact: 30, confirm: 2, human: 233, time: 0, noReply: 4 }, gapsOpen: 82, ...o });
const ready = (o: Partial<Parameters<typeof readiness>[0]> = {}) => readiness({ connected: true, knowledge: 14, conflicts: 0, blockRate: 0.02, gaps: 0, medianSec: 3.4, sim: { passed: 24, total: 25 }, ...o });

describe('is the AI ready — six checks an owner can read', () => {
  it('the agency page on 17/11/2026: 2 of 6, and every failure says what and where', () => {
    const r = ready({ conflicts: 12, blockRate: 0.37, gaps: 82, medianSec: 14, sim: null });
    expect(r.filter((x) => x.ok).map((x) => x.k)).toEqual(['channel', 'knowledge']);
    expect(r.find((x) => x.k === 'rules')).toMatchObject({ vi: '12 ghi chú cũ đang mâu thuẫn với tài liệu — 37% câu trả lời bị chặn và phải viết lại', go: 'learn' });
    expect(r.find((x) => x.k === 'gaps')).toMatchObject({ vi: '82 câu hỏi AI chưa biết trả lời', go: 'learn', goVi: 'Dạy' });
    expect(r.find((x) => x.k === 'speed')).toMatchObject({ ok: false, vi: 'Khách chờ 14 giây mỗi câu (mục tiêu dưới 5 giây)' });
    expect(r.find((x) => x.k === 'speed')?.go).toBeUndefined(); // speed is the platform's to fix, not the owner's
    expect(r.find((x) => x.k === 'sim')).toMatchObject({ vi: 'Bộ khách mẫu chưa chạy lần nào', go: 'sim' });
  });

  it('a salon in good shape is 6 of 6', () => {
    expect(ready().every((x) => x.ok)).toBe(true);
    expect(ready().find((x) => x.k === 'speed')?.vi).toBe('Khách chờ 3.4 giây mỗi câu');
  });

  it('no channel, no knowledge: said plainly, with the way out', () => {
    const r = ready({ connected: false, knowledge: 0 });
    expect(r[0]).toMatchObject({ ok: false, go: 'channels' });
    expect(r[1]).toMatchObject({ ok: false, go: 'knowledge' });
  });

  it('instructions that block many replies without any conflicting note point at the instructions', () => {
    expect(ready({ blockRate: 0.3 }).find((x) => x.k === 'rules')).toMatchObject({ ok: false, go: 'teach', vi: '30% câu trả lời bị dặn dò chặn và phải viết lại (nên dưới 5%)' });
    // Too few checks to say (null) is not held against the salon.
    expect(ready({ blockRate: null }).find((x) => x.k === 'rules')?.ok).toBe(true);
  });

  it('speed with nothing to measure is not called ready, and not called slow', () => {
    expect(ready({ medianSec: null }).find((x) => x.k === 'speed')).toMatchObject({ ok: false, vi: 'Chưa đủ câu trả lời để đo tốc độ' });
  });

  it('a sample run that is stale or below the bar is not ready', () => {
    expect(ready({ sim: { passed: 24, total: 25, stale: true } }).find((x) => x.k === 'sim')).toMatchObject({ ok: false, goVi: 'Chạy lại' });
    expect(ready({ sim: { passed: 14, total: 20 } }).find((x) => x.k === 'sim')).toMatchObject({ ok: false, vi: 'Bộ khách mẫu mới đạt 14/20' });
    expect(ready({ sim: { passed: 17, total: 20 } }).find((x) => x.k === 'sim')?.ok).toBe(true);
  });
});

describe('the numbers follow the kind of page', () => {
  it('a page that sells shows leads, never "bookings 0"', () => {
    const t = aiTiles(N(), 'sales');
    expect(t.map((x) => x.k)).toEqual(['conv', 'self', 'human', 'leads', 'speed', 'block']);
    expect(t.find((x) => x.k === 'leads')?.value).toBe('31');
    expect(t.find((x) => x.k === 'self')).toMatchObject({ value: '15%', subVi: '50 cuộc không cần người' });
    expect(t.find((x) => x.k === 'speed')).toMatchObject({ value: '14 giây', tone: 'warn' });
    expect(t.find((x) => x.k === 'block')).toMatchObject({ value: '37%', tone: 'warn' });
  });

  it('a salon shows bookings', () => {
    const t = aiTiles(N({ booked: 4, medianSec: 3.4, blockRate: null, selfHandledRate: null }), 'booking');
    expect(t.map((x) => x.k)).toContain('booked');
    expect(t.map((x) => x.k)).not.toContain('leads');
    expect(t.find((x) => x.k === 'speed')).toMatchObject({ value: '3.4 giây', tone: 'good' });
    expect(t.find((x) => x.k === 'block')?.value).toBe('—');
    expect(t.find((x) => x.k === 'self')?.value).toBe('—');
  });

  it('where the conversations went: largest first, empty lines left out, booking steps only for a salon', () => {
    expect(aiFunnel(N(), 'sales').map((x) => [x.k, x.n])).toEqual([['human', 233], ['general', 52], ['self', 50], ['contact', 30], ['noReply', 9]]);
    expect(aiFunnel(N({ stoppedAt: { time: 7, confirm: 2 }, humanTook: 0, selfHandled: 0, waitingNow: 0 }), 'booking').map((x) => x.k)).toEqual(['time', 'confirm']);
    expect(aiFunnel(N({ stoppedAt: {}, humanTook: 0, selfHandled: 0, waitingNow: 0 }), 'sales')).toEqual([]);
  });
});
