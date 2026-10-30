import { AD_HOLD_RETRY_MS, FRESH_RETRY_AFTER_MIN, adGreetingHold, describeRefusal, freshWindowReason, freshWindowRefusal, readSendRefusal, retryableRefusal } from './send-errors';

describe('reading what Meta said when it refused our message', () => {
  it('another app holding the thread is recognised, so we can take it back', () => {
    const r = readSendRefusal(400, { code: 10, error_subcode: 2018300, message: '(#10) This app is not the thread owner' });
    expect(r.threadControl).toBe(true);
    expect(r.reason).toMatch(/ứng dụng khác/);
    expect(readSendRefusal(400, { code: 10, message: 'Cannot send: another app has thread control' }).threadControl).toBe(true);
  });

  it('names the window, the token, the permission and the blocked customer', () => {
    expect(readSendRefusal(400, { code: 10, error_subcode: 2018278, message: '(#10) This message is sent outside of allowed window.' }).reason).toMatch(/24 giờ/);
    expect(readSendRefusal(400, { code: 190, message: 'Error validating access token' }).reason).toMatch(/kết nối lại/);
    expect(readSendRefusal(403, { code: 200, error_subcode: 2018028, message: 'requires pages_messaging' }).reason).toMatch(/pages_messaging/);
    expect(readSendRefusal(400, { code: 551, error_subcode: 1545041, message: "This person isn't available right now." }).reason).toMatch(/không nhận tin/);
    expect(readSendRefusal(400, { code: 100, error_subcode: 2018001, message: 'No matching user found' }).reason).toMatch(/không tìm thấy/);
  });

  it('a brief outage is worth one more try; a policy refusal is not', () => {
    expect(readSendRefusal(500, {}).transient).toBe(true);
    expect(readSendRefusal(400, { code: 613, message: 'Calls to this api have exceeded the rate limit.' }).transient).toBe(true);
    expect(readSendRefusal(400, { code: 10, error_subcode: 2018278 }).transient).toBe(false);
  });

  it('the Lumio Agency case: Meta restricted the whole Page until Oct 30', () => {
    const r = readSendRefusal(400, { code: 2022, error_subcode: 1404078, message: '(#2022) Bạn tạm thời bị hạn chế gửi tin nhắn đến 30 tháng 10 lúc 15:49.' });
    expect(r.pageRestricted).toBe(true);
    expect(r.transient).toBe(false);
    expect(r.reason).toMatch(/hạn chế Page gửi tin nhắn — Bạn tạm thời bị hạn chế gửi tin nhắn đến 30 tháng 10 lúc 15:49/);
    expect(r.reason).toMatch(/kết nối lại/);
    expect(r.reason).toMatch(/Business Suite/);
  });

  it('keeps Meta\'s code for the log and never invents a reason', () => {
    const r = readSendRefusal(400, { code: 9999, error_subcode: 1, message: 'Something new' });
    expect(r.code).toBe('9999/1');
    expect(r.reason).toBe('Meta từ chối: Something new');
    expect(readSendRefusal(400, undefined).reason).toMatch(/HTTP 400/);
  });
});

describe('the ad greeting hold (Zb Nails & Spa, 25 Oct)', () => {
  const windowErr = { code: 10, error_subcode: 2018278, message: '(#10) This message is sent outside of allowed window.' };
  it('a window refusal minutes after the customer wrote is the ad flow, not 24 hours', () => {
    const r = readSendRefusal(400, windowErr);
    expect(r.windowClosed).toBe(true);
    expect(adGreetingHold(r, 10_000)).toBe(true);
    expect(adGreetingHold(r, 25 * 3600 * 1000)).toBe(false);
    expect(adGreetingHold(r, null)).toBe(false);
    expect(AD_HOLD_RETRY_MS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(60_000);
  });
  it('other refusals are not held', () => {
    expect(adGreetingHold(readSendRefusal(400, { code: 190 }), 10_000)).toBe(false);
    expect(adGreetingHold(readSendRefusal(400, { code: 2022, error_subcode: 1404078 }), 10_000)).toBe(false);
  });
});

describe('a refusal seconds after the customer wrote is reported as Meta said it — no guessed cause (Lumio Agency, 30 Oct)', () => {
  const windowErr = { code: 10, error_subcode: 2018278, message: '(#10) This message is sent outside of allowed window.', fbtrace_id: 'AbC123' };
  it('keeps Meta\'s own words and trace id', () => {
    const r = readSendRefusal(400, windowErr);
    expect(r.meta).toBe('This message is sent outside of allowed window.');
    expect(r.trace).toBe('AbC123');
    expect(freshWindowRefusal(r, 70_000)).toBe(true);
  });
  it('the sentence quotes Meta, says when the customer wrote and what the bot will do — and never blames an ad greeting', () => {
    const r = readSendRefusal(400, windowErr);
    const s = freshWindowReason(r, 70_000, { tries: 3, nextAt: new Date('2026-10-30T06:37:55Z'), tz: 'Asia/Ho_Chi_Minh' });
    expect(s).toContain('mã 10/2018278');
    expect(s).toContain('“This message is sent outside of allowed window.”');
    expect(s).toContain('70 giây trước');
    expect(s).toContain('sẽ tự gửi lại lúc 13:37');
    expect(s).not.toMatch(/câu chào/);
    const end = freshWindowReason(r, 3_600_000, { tries: 9 });
    expect(end).toMatch(/thử 9 lần không được — nhân viên trả lời giúp/);
  });
  it('a scheduled resend plan exists beyond the first minute', () => {
    expect(FRESH_RETRY_AFTER_MIN[0]).toBeGreaterThanOrEqual(2);
    expect(FRESH_RETRY_AFTER_MIN[FRESH_RETRY_AFTER_MIN.length - 1]).toBeLessThanOrEqual(23 * 60);
  });
});

describe('which refused replies are kept and sent again later', () => {
  it('Meta busy, a thread held by another tool, a token to reconnect → kept', () => {
    expect(retryableRefusal(readSendRefusal(500, { code: 2 }), 30_000)).toBe(true);
    expect(retryableRefusal(readSendRefusal(400, { code: 10, error_subcode: 2018300, message: 'thread owner' }), 30_000)).toBe(true);
    expect(retryableRefusal(readSendRefusal(400, { code: 190 }), 30_000)).toBe(true);
  });
  it('a customer who blocked the Page, an unknown person, or a window really closed → not kept', () => {
    expect(retryableRefusal(readSendRefusal(400, { code: 551, error_subcode: 1545041 }), 30_000)).toBe(false);
    expect(retryableRefusal(readSendRefusal(400, { code: 100, error_subcode: 2018001 }), 30_000)).toBe(false);
    expect(retryableRefusal(readSendRefusal(400, { code: 10, error_subcode: 2018278 }), 25 * 3600 * 1000)).toBe(false);
  });
  it('every sentence carries Meta’s own words and code, and what happens next', () => {
    const r = readSendRefusal(400, { code: 190, message: '(#190) Error validating access token: Session has expired' });
    const s = describeRefusal(r, 30_000, { tries: 1, nextAt: new Date('2026-10-30T06:40:00Z'), tz: 'Asia/Ho_Chi_Minh' });
    expect(s).toContain('Error validating access token');
    expect(s).toContain('mã 190');
    expect(s).toContain('sẽ tự gửi lại lúc 13:40');
  });
});
