import { createHash } from 'crypto';
import { parseZaloEvent, verifyZaloSignature, explainZaloSendError } from './zalo-oa';

describe('verifyZaloSignature', () => {
  const appId = '1234567890';
  const secret = 'oa-webhook-secret';
  const rawBody = '{"app_id":"1234567890","event_name":"user_send_text","timestamp":"1700000000000"}';
  const ts = '1700000000000';
  const good = 'mac=' + createHash('sha256').update(`${appId}${rawBody}${ts}${secret}`).digest('hex');

  it('accepts the documented mac= header', () => {
    expect(verifyZaloSignature({ appId, rawBody, timestamp: ts, oaSecretKey: secret, header: good })).toBe(true);
  });

  it('accepts the bare hash too (some senders drop the prefix)', () => {
    expect(verifyZaloSignature({ appId, rawBody, timestamp: ts, oaSecretKey: secret, header: good.slice(4) })).toBe(true);
  });

  it('rejects a wrong signature, a missing header, and a missing secret', () => {
    expect(verifyZaloSignature({ appId, rawBody, timestamp: ts, oaSecretKey: secret, header: 'mac=' + '0'.repeat(64) })).toBe(false);
    expect(verifyZaloSignature({ appId, rawBody, timestamp: ts, oaSecretKey: secret, header: undefined })).toBe(false);
    expect(verifyZaloSignature({ appId, rawBody, timestamp: ts, oaSecretKey: '', header: good })).toBe(false);
  });

  it('rejects when the body was altered', () => {
    expect(verifyZaloSignature({ appId, rawBody: rawBody + ' ', timestamp: ts, oaSecretKey: secret, header: good })).toBe(false);
  });
});

describe('parseZaloEvent', () => {
  it('reads a user_send_text event', () => {
    const e = parseZaloEvent({
      app_id: '111', event_name: 'user_send_text', timestamp: '1700000000123',
      sender: { id: 'user-9' }, recipient: { id: 'oa-7' }, message: { text: 'Dạ em muốn đặt lịch' },
    });
    expect(e).toEqual({
      appId: '111', oaId: 'oa-7', senderId: 'user-9',
      text: 'Dạ em muốn đặt lịch', tsMs: 1700000000123, eventName: 'user_send_text',
    });
  });

  it('ignores every other event kind without throwing', () => {
    expect(parseZaloEvent({ event_name: 'follow', follower: { id: 'x' } })).toBeNull();
    expect(parseZaloEvent({ event_name: 'user_send_sticker', sender: { id: 'a' }, recipient: { id: 'b' } })).toBeNull();
    expect(parseZaloEvent(null)).toBeNull();
    expect(parseZaloEvent('garbage')).toBeNull();
  });

  it('refuses a text event missing its parties', () => {
    expect(parseZaloEvent({ event_name: 'user_send_text', sender: {}, recipient: { id: 'oa' }, message: { text: 'hi' } })).toBeNull();
  });
});

describe('one-click connect', () => {
  const { pkcePair, zaloPermissionUrl } = require('./zalo-oa');
  const crypto = require('crypto');

  it('builds a challenge that is the S256 of a verifier that never appears in the link', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expect256 = crypto.createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(challenge).toBe(expect256);
    const url = zaloPermissionUrl({ appId: '1', redirectUri: 'https://x/cb', challenge, state: 's' });
    expect(url).toContain(`code_challenge=${challenge}`);
    expect(url).not.toContain(verifier);
  });

  it('puts every field Zalo reads on the permission link', () => {
    const url = new URL(zaloPermissionUrl({ appId: '4162', redirectUri: 'https://api/cb?x=1', challenge: 'c', state: 'st' }));
    expect(url.origin + url.pathname).toBe('https://oauth.zaloapp.com/v4/oa/permission');
    expect(url.searchParams.get('app_id')).toBe('4162');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api/cb?x=1');
    expect(url.searchParams.get('state')).toBe('st');
  });

  it('makes a different verifier every time — a reused one is a replayable one', () => {
    expect(pkcePair().verifier).not.toBe(pkcePair().verifier);
  });
});

describe('explainZaloSendError', () => {
  it('names the reconnect for a dead token', () => {
    expect(explainZaloSendError('Zalo -216: Access token is invalid')).toMatch(/Kết nối lại/);
  });
  it('names the 48-hour window when the customer has not written first', () => {
    expect(explainZaloSendError('Zalo -213: User has not interacted with OA')).toMatch(/48 giờ/);
  });
  it('points at the OA package for quota refusals', () => {
    expect(explainZaloSendError('Zalo -224: OA has run out of quota')).toMatch(/gói/);
  });
  it('points at OA verification / app permission for policy refusals', () => {
    expect(explainZaloSendError('Zalo -230: OA is not verified')).toMatch(/Xác thực OA/);
  });
  it('still gives one instruction for a code it has never seen, and nothing for no error', () => {
    expect(explainZaloSendError('Zalo -999: something new')).toMatch(/Lumio/);
    expect(explainZaloSendError('')).toBe('');
    expect(explainZaloSendError(undefined)).toBe('');
  });
});
