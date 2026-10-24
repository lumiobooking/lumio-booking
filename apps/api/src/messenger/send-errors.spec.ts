import { readSendRefusal } from './send-errors';

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
