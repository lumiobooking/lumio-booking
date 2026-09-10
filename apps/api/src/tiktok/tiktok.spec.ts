import {
  TIKTOK_DEFAULTS, accessStale, chunkPlan, cleanTikTokOptions, explainTikTokError, initBody, needsReconnect, parseCreatorInfo,
  publicTikTok, readPublishStatus, settingsFromToken, targetOf, tiktokAuthorizeUrl, tiktokPostUrl, tiktokRefusal,
  type TikTokSettings, type TikTokTarget,
} from './tiktok';

const NOW = Date.parse('2026-09-10T10:00:00Z');
const connected: TikTokSettings = {
  ...TIKTOK_DEFAULTS, connected: true, openId: 'o1', displayName: 'Lux Nail Spa', username: 'luxnailspa',
  accessToken: 'at', accessExpiresAt: new Date(NOW + 3600_000).toISOString(),
  refreshToken: 'rt', refreshExpiresAt: new Date(NOW + 300 * 86400_000).toISOString(),
  creator: { privacyOptions: ['PUBLIC_TO_EVERYONE', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'], maxDurationSec: 600, commentDisabled: false, duetDisabled: true, stitchDisabled: false, checkedAt: new Date(NOW).toISOString() },
};
const target = targetOf(connected) as TikTokTarget;
const vid = { url: 'https://cdn.lumio.app/v/1.mp4', kind: 'video' as const };
const img = { url: 'https://cdn.lumio.app/p/1.jpg', kind: 'image' as const };
const ok = cleanTikTokOptions({ privacy: 'PUBLIC_TO_EVERYONE', allowComment: true, allowDuet: false, allowStitch: true })!;

describe('the connection: what the screen sees and when it must be renewed', () => {
  it('never hands a token to the screen', () => {
    const p = publicTikTok(connected) as Record<string, unknown>;
    expect(JSON.stringify(p)).not.toMatch(/"at"|"rt"|accessToken|refreshToken/);
    expect(p.connected).toBe(true);
    expect(p.displayName).toBe('Lux Nail Spa');
  });

  it('knows a refresh token past its year is dead', () => {
    expect(needsReconnect(connected, NOW)).toBe(false);
    expect(needsReconnect({ ...connected, refreshExpiresAt: new Date(NOW - 1000).toISOString() }, NOW)).toBe(true);
    expect(needsReconnect(TIKTOK_DEFAULTS, NOW)).toBe(false);
  });

  it('refreshes an access token a few minutes before TikTok would refuse it', () => {
    expect(accessStale(connected, NOW)).toBe(false);
    expect(accessStale({ ...connected, accessExpiresAt: new Date(NOW + 60_000).toISOString() }, NOW)).toBe(true);
    expect(accessStale({ ...connected, accessToken: '' }, NOW)).toBe(true);
  });

  it('builds the authorize link with the publish scope and the signed state', () => {
    const u = tiktokAuthorizeUrl({ clientKey: 'ck', redirectUri: 'https://api/x/callback', state: 'abc.def' });
    expect(u.startsWith('https://www.tiktok.com/v2/auth/authorize/?')).toBe(true);
    expect(u).toContain('scope=user.info.basic%2Cvideo.publish');
    expect(u).toContain('state=abc.def');
  });

  it('accepts a token answer only when it carries video.publish', () => {
    const t = { access_token: 'a', refresh_token: 'r', open_id: 'o', expires_in: 86400, refresh_expires_in: 31536000, scope: 'user.info.basic,video.publish' };
    const s = settingsFromToken(TIKTOK_DEFAULTS, t, NOW)!;
    expect(s.connected).toBe(true);
    expect(Date.parse(s.accessExpiresAt) - NOW).toBe(86400_000);
    expect(settingsFromToken(TIKTOK_DEFAULTS, { ...t, scope: 'user.info.basic' }, NOW)).toBeNull();
    expect(settingsFromToken(TIKTOK_DEFAULTS, { error: 'invalid_grant' }, NOW)).toBeNull();
  });

  it('reads creator_info and drops privacy levels it does not know', () => {
    const c = parseCreatorInfo({ data: { privacy_level_options: ['SELF_ONLY', 'WEIRD'], max_video_post_duration_sec: 300, duet_disabled: true } })!;
    expect(c.privacyOptions).toEqual(['SELF_ONLY']);
    expect(c.maxDurationSec).toBe(300);
    expect(c.duetDisabled).toBe(true);
    expect(parseCreatorInfo({ error: { code: 'x' } })).toBeNull();
  });
});

describe('what a person must decide for every TikTok post', () => {
  it('has no default privacy level — the guidelines forbid one', () => {
    expect(cleanTikTokOptions({})).toBeNull();
    expect(cleanTikTokOptions({ privacy: 'PUBLIC' })).toBeNull();
    expect(cleanTikTokOptions({ privacy: 'SELF_ONLY' })!.privacy).toBe('SELF_ONLY');
  });

  it('keeps the disclosure choices only when the toggle is on', () => {
    expect(cleanTikTokOptions({ privacy: 'SELF_ONLY', yourBrand: true })!.yourBrand).toBe(false);
    expect(cleanTikTokOptions({ privacy: 'SELF_ONLY', disclose: true, yourBrand: true })!.yourBrand).toBe(true);
  });
});

describe('why a post cannot go to TikTok as it stands', () => {
  it('passes a single video with a chosen privacy level', () => {
    expect(tiktokRefusal({ text: 'New set 💅', media: [vid] }, target, ok)).toBeNull();
  });

  it('sends the salon to connect, and to reconnect after a year', () => {
    expect(tiktokRefusal({ text: 'x', media: [vid] }, null, ok)).toMatch(/Kết nối TikTok/);
    expect(tiktokRefusal({ text: 'x', media: [vid] }, { ...target, needsReconnect: true }, ok)).toMatch(/hết hạn/);
  });

  it('wants exactly one video and nothing else', () => {
    expect(tiktokRefusal({ text: 'x', media: [img] }, target, ok)).toMatch(/cần một video/);
    expect(tiktokRefusal({ text: 'x', media: [] }, target, ok)).toMatch(/cần một video/);
    expect(tiktokRefusal({ text: 'x', media: [vid, vid] }, target, ok)).toMatch(/đúng một video/);
    expect(tiktokRefusal({ text: 'x', media: [vid, img] }, target, ok)).toMatch(/không đăng chung ảnh/);
  });

  it('refuses a post whose privacy level was never chosen', () => {
    expect(tiktokRefusal({ text: 'x', media: [vid] }, target, null)).toMatch(/Chưa chọn quyền riêng tư/);
  });

  it('holds the post to what the account allows today', () => {
    const friends = cleanTikTokOptions({ privacy: 'MUTUAL_FOLLOW_FRIENDS' })!;
    expect(tiktokRefusal({ text: 'x', media: [vid] }, target, friends)).toMatch(/chỉ cho phép/);
    // Duet is off in the app settings: the toggle must not be on.
    expect(tiktokRefusal({ text: 'x', media: [vid] }, target, { ...ok, allowDuet: true })).toMatch(/Duet/);
  });

  it('explains the unaudited case in the same sentence', () => {
    const unaudited: TikTokTarget = { ...target, creator: { ...target.creator!, privacyOptions: ['SELF_ONLY'] } };
    expect(tiktokRefusal({ text: 'x', media: [vid] }, unaudited, ok)).toMatch(/chưa được TikTok duyệt/);
  });

  it('keeps the disclosure rules TikTok enforces', () => {
    expect(tiktokRefusal({ text: 'x', media: [vid] }, target, { ...ok, disclose: true })).toMatch(/Nội dung thương mại/);
    expect(tiktokRefusal({ text: 'x', media: [vid] }, target, { ...ok, privacy: 'SELF_ONLY', disclose: true, brandedContent: true })).toMatch(/Paid partnership/);
  });

  it('caps the caption at 2,200', () => {
    expect(tiktokRefusal({ text: 'x'.repeat(2201), media: [vid] }, target, ok)).toMatch(/2200/);
  });
});

describe('talking to the API', () => {
  it('writes the init body TikTok documents, toggles inverted from "allow" to "disable"', () => {
    const b = initBody('hello', { ...ok, disclose: true, yourBrand: true }, { kind: 'url', url: 'https://cdn/v.mp4' });
    expect(b.post_info).toMatchObject({ title: 'hello', privacy_level: 'PUBLIC_TO_EVERYONE', disable_comment: false, disable_duet: true, disable_stitch: false, brand_organic_toggle: true, brand_content_toggle: false });
    expect(b.source_info).toEqual({ source: 'PULL_FROM_URL', video_url: 'https://cdn/v.mp4' });
    const f = initBody('hi', ok, { kind: 'file', size: 10, chunkSize: 10, chunks: 1 });
    expect(f.source_info).toEqual({ source: 'FILE_UPLOAD', video_size: 10, chunk_size: 10, total_chunk_count: 1 });
  });

  it('cuts a file the way TikTok wants: whole under 64 MB, 64 MB chunks with the remainder on the last', () => {
    const MB = 1024 * 1024;
    expect(chunkPlan(3 * MB)).toEqual({ chunkSize: 3 * MB, chunks: 1, ranges: [[0, 3 * MB - 1]] });
    const p = chunkPlan(100 * MB);
    expect(p.chunkSize).toBe(64 * MB);
    expect(p.chunks).toBe(1);
    expect(p.ranges).toEqual([[0, 100 * MB - 1]]);
    const q = chunkPlan(130 * MB);
    expect(q.chunks).toBe(2);
    expect(q.ranges).toEqual([[0, 64 * MB - 1], [64 * MB, 130 * MB - 1]]);
  });

  it('reads the publish status and the public post id', () => {
    expect(readPublishStatus({ data: { status: 'PROCESSING_UPLOAD' } })).toMatchObject({ done: false, ok: false });
    expect(readPublishStatus({ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [7301234] } })).toMatchObject({ done: true, ok: true, postIds: ['7301234'] });
    expect(readPublishStatus({ data: { status: 'FAILED', fail_reason: 'duration_check_failed' } })).toMatchObject({ done: true, ok: false, failReason: 'duration_check_failed' });
  });

  it('turns TikTok’s codes into the thing the team can do', () => {
    expect(explainTikTokError('unaudited_client_can_only_post_to_private_accounts')).toMatch(/Chỉ mình tôi/);
    expect(explainTikTokError('spam_risk_too_many_posts')).toMatch(/ngày mai/);
    expect(explainTikTokError('access_token_invalid')).toMatch(/Kết nối lại/);
    expect(explainTikTokError('something_new', 'msg')).toMatch(/something_new \(msg\)/);
  });

  it('links to the video by handle once TikTok names it', () => {
    expect(tiktokPostUrl('luxnailspa', '123')).toBe('https://www.tiktok.com/@luxnailspa/video/123');
    expect(tiktokPostUrl(null, null)).toBeNull();
  });
});
