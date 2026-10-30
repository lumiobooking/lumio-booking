/**
 * Only a PERSON holds the chat. Lines the Page sends that Lumio did not — Meta's
 * notices, the Page's own automation, Meta's AI — used to put the bot aside
 * as if staff were answering. Cases read off live transcripts (30 Oct 2026).
 */
import { echoKind, lastStampOf, META_AI_HOLD_MS, ownEcho } from './automation-echo';
import { isMetaAiLine, isMetaSystemLine } from './meta-system-lines';
import { repeatWasAnswered } from './burst';

describe('Meta notices seen live are recognised (they never hold the chat)', () => {
  const lines = [
    'Roy Alex replied to your automated welcome message. To change or remove this greeting, visit Messaging settings.',
    'Roy Alex đã trả lời tin nhắn chào mừng tự động của bạn. Để thay đổi hoặc gỡ lời chào này, hãy truy cập phần Cài đặt tin nhắn.',
    'Ngân Lâm replied to a post. View post(https://www.facebook.com/123456789/posts/987654321)',
    'Ngân Lâm replied to a post.',
    'Ngân Lâm đã trả lời về một bài viết. Xem bài viết(https://www.facebook.com/123/posts/456)',
    'Bạn đã trả lời Mercedes chưa? Họ đang chờ bạn đấy.',
    'Your AI agent will respond.',
    'Your AI Agent transferred this chat to you because this contact went against our Community Standards.',
    'Kathy Kieu replied to an ad.',
    'Demy Nguyen đã trả lời một quảng cáo.',
  ];
  it.each(lines)('%s', (l) => expect(isMetaSystemLine(l)).toBe(true));
  it("Meta's AI announcing itself is told apart", () => {
    expect(isMetaAiLine('Your AI agent will respond.')).toBe(true);
    expect(isMetaAiLine('Kathy Kieu replied to an ad.')).toBe(false);
  });
  it('a person typing is never a notice', () => {
    for (const l of ['Em đã trả lời tin của chị.', 'Dạ em chào anh,', 'Our address is 1927 E Belt Line', 'I replied to your email yesterday.']) {
      expect(isMetaSystemLine(l)).toBe(false);
    }
  });
});

describe('who wrote the echo', () => {
  const now = Date.parse('2026-10-04T21:36:00Z');
  it("Meta's notice → notice (no yield)", () => {
    expect(echoKind({ notice: true, metaAi: false, nowMs: now })).toBe('notice');
  });
  it("the Page's welcome message 2 s after Meta's notice → automation (Kin's Restaurant)", () => {
    expect(echoKind({ notice: false, metaAi: false, nowMs: now, lastNoticeMs: now - 2000, lastCustomerMs: now - 60_000 })).toBe('automation');
  });
  it('an instant answer 3 s after the customer wrote → automation', () => {
    expect(echoKind({ notice: false, metaAi: false, nowMs: now, lastCustomerMs: now - 3000 })).toBe('automation');
  });
  it("after \"Your AI agent will respond.\" → Meta's AI (the bot yields, the salon is told)", () => {
    expect(echoKind({ notice: false, metaAi: false, nowMs: now, metaAiMs: now - 20_000, lastCustomerMs: now - 20_000 })).toBe('meta-ai');
    expect(echoKind({ notice: false, metaAi: false, nowMs: now, metaAiMs: now - META_AI_HOLD_MS - 1, lastCustomerMs: now - 60_000 })).toBe('person');
  });
  it('a person answering half a minute later → person (the bot steps aside as before)', () => {
    expect(echoKind({ notice: false, metaAi: false, nowMs: now, lastCustomerMs: now - 30_000, lastNoticeMs: now - 120_000 })).toBe('person');
  });
});

describe('a customer repeating because the bot never reached them is answered', () => {
  const q = 'Chi phí lắp đặt hệ thống POS là bao nhiêu?';
  it('earlier copies only got refused replies → not a repeat', () => {
    expect(repeatWasAnswered([{ role: 'user', content: q }, { role: 'assistant', content: 'x', failed: true }, { role: 'user', content: q }], q)).toBe(false);
  });
  it('a delivered answer after an earlier copy → a true repeat', () => {
    expect(repeatWasAnswered([{ role: 'user', content: q }, { role: 'assistant', content: 'Dạ…' }], q)).toBe(true);
  });
});



describe('works across API processes (the stored history decides, not one process memory)', () => {
  const now = Date.parse('2026-10-30T06:35:00Z');
  it("our own reply echoing back is recognised from the history — the bot does not yield to itself", () => {
    const h = [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Dạ em chào anh ạ', at: '2026-10-30T06:34:50Z' }];
    expect(ownEcho(h, 'Dạ em chào anh ạ', now)).toBe(true);
    expect(ownEcho(h, 'Một câu khác', now)).toBe(false);
    // A person's manual line with the same words is not "ours".
    expect(ownEcho([{ role: 'assistant', content: 'Dạ', manual: true, at: '2026-10-30T06:34:50Z' }], 'Dạ', now)).toBe(false);
  });
  it('a notice stored by another process a second ago still marks the next echo as automation', () => {
    const h = [{ role: 'assistant', content: 'Roy Alex replied to your automated welcome message. To change or remove this greeting, visit Messaging settings.', at: '2026-10-30T06:34:58Z', manual: true }];
    const at = lastStampOf(h, (t) => /welcome message/.test(t.content));
    expect(at).toBe(Date.parse('2026-10-30T06:34:58Z'));
  });
});
