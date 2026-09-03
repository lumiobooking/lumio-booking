import { createHash } from 'crypto';
import { parseZaloEvent, verifyZaloSignature } from './zalo-oa';

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
