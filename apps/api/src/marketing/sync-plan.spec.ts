/**
 * The sync plan: which months a day reads, how a failure comes back, which
 * claimed jobs are dead, and how a channel's state reads in plain words.
 */
import { monthsToSync, backoffMinutes, afterFailure, isStaleRunning, channelHealth, permissionIn, prevMonthOf } from './sync-plan';
import { isPagePostChange, onChannelSyncRequest, requestChannelSync } from './sync-signals';

describe('months a daily run reads', () => {
  it('this month always; last month daily for a week, then every third day until its posts are ~35 days old', () => {
    expect(monthsToSync('2026-10-01')).toEqual(['2026-10', '2026-09']);
    expect(monthsToSync('2026-10-07')).toEqual(['2026-10', '2026-09']);
    expect(monthsToSync('2026-10-08')).toEqual(['2026-10']);
    expect(monthsToSync('2026-10-09')).toEqual(['2026-10', '2026-09']); // day 9 → 9 % 3 === 0
    expect(monthsToSync('2026-10-30')).toEqual(['2026-10', '2026-09']);
    expect(monthsToSync('2026-11-05')).toEqual(['2026-11', '2026-10']);
    expect(monthsToSync('2026-11-09')).toEqual(['2026-11', '2026-10']);
    expect(monthsToSync('2026-11-20')).toEqual(['2026-11']);
    expect(monthsToSync('2027-01-03')).toEqual(['2027-01', '2026-12']);
    expect(prevMonthOf('2026-01')).toBe('2025-12');
  });
});

describe('retries and dead jobs', () => {
  it('15 → 60 → 240 minutes, then failed', () => {
    const now = new Date('2026-10-08T10:00:00Z');
    expect(backoffMinutes(1)).toBe(15);
    expect(backoffMinutes(2)).toBe(60);
    expect(backoffMinutes(3)).toBe(240);
    expect(afterFailure(1, now)).toEqual({ status: 'queued', runAt: new Date('2026-10-08T10:15:00Z') });
    expect(afterFailure(2, now)).toEqual({ status: 'queued', runAt: new Date('2026-10-08T11:00:00Z') });
    expect(afterFailure(3, now)).toEqual({ status: 'failed', runAt: now });
  });
  it('a job running for 45+ minutes was lost with its process', () => {
    const now = new Date('2026-10-08T10:00:00Z');
    expect(isStaleRunning({ status: 'running', attempts: 1, startedAt: new Date('2026-10-08T09:00:00Z') }, now)).toBe(true);
    expect(isStaleRunning({ status: 'running', attempts: 1, startedAt: new Date('2026-10-08T09:40:00Z') }, now)).toBe(false);
    expect(isStaleRunning({ status: 'queued', attempts: 0, startedAt: null }, now)).toBe(false);
  });
});

describe('a channel’s state in plain words', () => {
  const now = new Date('2026-10-08T10:00:00Z');
  it('green when read in the last 36 h, amber when waiting or stale, grey when not connected', () => {
    expect(channelHealth({ platform: 'meta_social', connected: true, lastSyncedAt: new Date('2026-10-08T03:00:00Z') }, now)).toMatchObject({ level: 'ok', key: 'fresh' });
    expect(channelHealth({ platform: 'meta_social', connected: true, lastSyncedAt: new Date('2026-10-05T03:00:00Z') }, now)).toMatchObject({ level: 'warn', key: 'stale' });
    expect(channelHealth({ platform: 'meta_social', connected: true, lastSyncedAt: new Date('2026-10-05T03:00:00Z'), queued: true }, now)).toMatchObject({ level: 'warn', key: 'queued' });
    expect(channelHealth({ platform: 'meta_social', connected: true, lastSyncedAt: null }, now)).toMatchObject({ level: 'warn', key: 'never' });
    expect(channelHealth({ platform: 'tiktok', connected: false }, now)).toMatchObject({ level: 'off', key: 'not-connected' });
  });
  it('red with the permission named when Meta refused, red when the last read failed', () => {
    const h = channelHealth({ platform: 'meta_social', connected: true, lastError: '(#200) Requires pages_read_engagement permission' }, now);
    expect(h).toMatchObject({ level: 'bad', key: 'permission', detail: 'pages_read_engagement' });
    expect(channelHealth({ platform: 'gbp', connected: true, lastSyncedAt: new Date('2026-10-08T03:00:00Z'), lastJob: { status: 'failed', error: 'HTTP 500' } }, now)).toMatchObject({ level: 'bad', key: 'failed', detail: 'HTTP 500' });
    // A fresh read with an old error on the row is still green (the error is shown as detail).
    expect(channelHealth({ platform: 'gbp', connected: true, lastSyncedAt: new Date('2026-10-08T03:00:00Z'), lastError: 'HTTP 500' }, now)).toMatchObject({ level: 'ok', key: 'fresh', detail: 'HTTP 500' });
    expect(permissionIn('needs instagram_manage_insights')).toBe('instagram_manage_insights');
    expect(permissionIn('timeout')).toBeNull();
  });
});

describe('the Page posted → the queue hears it', () => {
  it('only the Page’s own new posts count; reactions, comments and visitors do not', () => {
    expect(isPagePostChange({ item: 'post', verb: 'add', from: { id: 'p1' } }, 'p1')).toBe(true);
    expect(isPagePostChange({ item: 'photo', verb: 'add' }, 'p1')).toBe(true);
    expect(isPagePostChange({ item: 'post', verb: 'add', from: { id: 'visitor' } }, 'p1')).toBe(false);
    expect(isPagePostChange({ item: 'reaction', verb: 'add', from: { id: 'p1' } }, 'p1')).toBe(false);
    expect(isPagePostChange({ item: 'post', verb: 'remove', from: { id: 'p1' } }, 'p1')).toBe(false);
    expect(isPagePostChange(null, 'p1')).toBe(false);
  });
  it('listeners are called and can unsubscribe', () => {
    const got: string[] = [];
    const off = onChannelSyncRequest((pageId) => got.push(pageId));
    requestChannelSync('p9');
    off();
    requestChannelSync('p10');
    expect(got).toEqual(['p9']);
  });
});
