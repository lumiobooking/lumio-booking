/**
 * A SCHEDULED GOOGLE POST THAT FAILS IS A POST NOBODY IS WATCHING.
 *
 * Facebook and Instagram failures have had explainMetaError since the day the
 * queue existed. Google had nothing: toGoogle() stored Google's own sentence
 * ("Google 403: The caller does not have permission") and the screen showed
 * that, in English, to a salon owner in Roseville. The calendar went red at
 * 16:50, the reason sat unreadable inside a modal, and the post was simply
 * never made.
 *
 * These tests fix the mapping, not the wording: each one pins a real failure
 * string to the action that actually resolves it, because getting the WRONG
 * instruction is worse than getting none — it sends somebody to reconnect an
 * account when the real problem is a Cloud project setting they cannot see.
 */

import { explainGbpError, explainMetaError } from './social-publish';

describe('explainGbpError', () => {
  it('says nothing when there is no error', () => {
    expect(explainGbpError(null)).toBeNull();
    expect(explainGbpError(undefined)).toBeNull();
    expect(explainGbpError('')).toBeNull();
  });

  it('leaves Meta errors to explainMetaError', () => {
    // The two explainers run one after the other on the same string, so an
    // error that is not Google's must fall straight through this one.
    const meta = '(#200) If posting to a group, requires app being installed in the group';
    expect(explainGbpError(meta)).toBeNull();
    expect(explainMetaError(meta)).not.toBeNull();
  });

  it('names Lumio, not the shop, when the API is not switched on', () => {
    const msg = explainGbpError('Google 403: Google My Business API has not been used in project 12345 before or it is disabled.');
    expect(msg).toContain('team Lumio');
    // The shop must not be sent to reconnect anything — nothing on their side is wrong.
    expect(msg).not.toContain('kết nối lại');
  });

  it('separates a quota ceiling from a content problem', () => {
    const msg = explainGbpError('Google 429: Quota exceeded for quota metric ...');
    expect(msg).toContain('giới hạn');
    expect(msg).toContain('Không phải lỗi nội dung');
  });

  it('sends a permission failure to the OWNER account, not just "reconnect"', () => {
    const msg = explainGbpError('Google 403: The caller does not have permission');
    expect(msg).toMatch(/CHỦ|QUẢN LÝ/);
  });

  it('tells an expired connection apart from a missing permission', () => {
    const expired = explainGbpError('Google 401: Invalid Credentials');
    const denied = explainGbpError('Google 403: The caller does not have permission');
    expect(expired).not.toEqual(denied);
    expect(expired).toContain('hết hạn');
  });

  it('points a stale location at re-picking the location', () => {
    expect(explainGbpError('Google 404: Requested entity was not found.')).toContain('chọn lại địa điểm');
  });

  it('explains an unfetchable photo as a photo problem', () => {
    const msg = explainGbpError('Google 400: Invalid media sourceUrl');
    expect(msg).toContain('ảnh');
    expect(msg).toContain('JPG');
  });

  it('tells an unverified or suspended listing that nothing will post', () => {
    expect(explainGbpError('Google 400: The location is not verified')).toContain('xác minh');
    expect(explainGbpError('Google 403: This location is suspended')).toContain('tạm khoá');
  });

  it('admits it does not know, rather than guessing, on an unknown Google error', () => {
    const msg = explainGbpError('Google 500: Internal error encountered.');
    expect(msg).toContain('team Lumio');
    // No confident instruction that might be wrong.
    expect(msg).not.toContain('Kết nối lại bằng tài khoản');
  });

  it('never returns an empty or whitespace-only sentence', () => {
    const cases = [
      'Google 403: Google My Business API has not been used in project 1',
      'Google 429: Quota exceeded',
      'Google 401: invalid_grant',
      'Google 403: PERMISSION_DENIED',
      'Google 404: NOT_FOUND',
      'Google 400: photo could not be downloaded',
      'Google 400: callToAction url is invalid',
      'Google 400: summary too long',
      'Google 503: backend unavailable',
    ];
    for (const c of cases) {
      const msg = explainGbpError(c);
      expect(typeof msg).toBe('string');
      expect((msg ?? '').trim().length).toBeGreaterThan(20);
    }
  });
});
