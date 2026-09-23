import { conversationLang, detectLang, localeForLang, replyLangRule } from './reply-language';

describe('one message', () => {
  it('reads accented and unaccented Vietnamese as Vietnamese', () => {
    expect(detectLang('Dạ cho em hỏi làm nail bao nhiêu tiền ạ?')).toBe('vi');
    expect(detectLang('gia bao nhieu vay shop')).toBe('vi');
    expect(detectLang('minh muon dat lich ngay mai')).toBe('vi');
  });

  it('reads a real English booking message as English — the case that was answered in Vietnamese', () => {
    expect(detectLang('Are you open Sunday?')).toBe('en');
    expect(detectLang('book me tomorrow 3pm')).toBe('en');
    expect(detectLang('how much for a gel manicure')).toBe('en');
    expect(detectLang('Hi, can I make an appointment for two people?')).toBe('en');
  });

  it('ignores the stage directions the system writes into a customer turn', () => {
    expect(detectLang('[Khách gửi 1 ảnh]')).toBeNull();
    expect(conversationLang(['Can I book a fill tomorrow?', '[Khách gửi 1 ảnh]'])).toBe('en');
  });

  it('decides nothing on a word both languages use, or on no words at all', () => {
    for (const s of ['ok', 'Thanks!', '👍', '', '  ', '8052808824']) expect(detectLang(s)).toBeNull();
  });
});

describe('the conversation, not the last message', () => {
  it('stays Vietnamese when a Vietnamese customer drops in English words', () => {
    expect(conversationLang(['Dạ em muốn đặt lịch ạ', 'ok', 'thank you'])).toBe('vi');
  });

  it('stays English when an English customer types ok', () => {
    expect(conversationLang(['Hi, do you have any openings tomorrow?', 'ok'])).toBe('en');
  });

  it('follows a customer who really does switch', () => {
    expect(conversationLang(['Dạ cho em hỏi giá', 'Sorry, can we do this in English please?', 'I would like a pedicure on Friday'])).toBe('en');
  });

  it('says nothing when there is nothing to go on', () => {
    expect(conversationLang([])).toBeNull();
    expect(conversationLang(['ok', '👍'])).toBeNull();
  });
});

describe('the rule handed to the model', () => {
  it('forbids the other language in both directions, and stays open when unknown', () => {
    expect(replyLangRule('en')).toMatch(/ENGLISH/);
    expect(replyLangRule('en')).toMatch(/Do not send Vietnamese/);
    expect(replyLangRule('vi')).toMatch(/tiếng Việt/);
    expect(replyLangRule(null)).toMatch(/language the customer is using/i);
  });

  it('picks the date locale to match', () => {
    expect(localeForLang('vi')).toBe('vi-VN');
    expect(localeForLang('en')).toBe('en-US');
    expect(localeForLang(null, 'vi-VN')).toBe('vi-VN');
  });
});
