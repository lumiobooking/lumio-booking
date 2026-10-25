import { isMetaAdGreeting, isMetaSystemLine } from './meta-system-lines';
import { conversationLang, detectLang, requestedLang, replyLangRule } from '../common/reply-language';
import { conversationLanguage, detectLanguage } from '../ai-brain/brain-rules';

describe('Meta\'s own lines are not the salon talking', () => {
  it('knows the ad-reply notice in English and Vietnamese', () => {
    for (const t of ['Allison Quinn replied to an ad.', 'Customer replied to an ad', 'Allison Quinn đã trả lời một quảng cáo.', 'Khánh đã trả lời quảng cáo của bạn', '(opened chat)', '👋 (opened chat)']) {
      expect(isMetaSystemLine(t)).toBe(true);
    }
    for (const t of ['I replied to an ad yesterday, do you still have the $49 pedi?', 'Chào Allison! Chúng tôi có thể giúp gì cho bạn?', '']) {
      expect(isMetaSystemLine(t)).toBe(false);
    }
  });
});

describe('a customer who names a language gets that language', () => {
  it('reads the request, bare or in a short sentence, in either language', () => {
    for (const t of ['English', 'english please', 'English?', 'Can you speak English?', 'in English pls', 'Tiếng Anh', 'nói tiếng anh được không']) expect(requestedLang(t)).toBe('en');
    for (const t of ['Tiếng Việt', 'tieng viet', 'Vietnamese please', 'nhắn tiếng Việt nha']) expect(requestedLang(t)).toBe('vi');
    expect(requestedLang('Español')).toBe('es');
  });

  it('a refusal or a choice is not a request', () => {
    expect(requestedLang('tôi không biết tiếng Anh')).toBeNull();
    expect(requestedLang("I don't speak Vietnamese")).toBeNull();
    expect(requestedLang('English or Vietnamese?')).toBeNull();
    expect(requestedLang('My english teacher recommended your salon for the gel manicure last week and I loved it')).toBeNull();
  });

  it('the screenshot case: a Vietnamese ad greeting, then "English" → English, both brains', () => {
    // Only the customer's lines vote; the Page's Vietnamese greeting never does.
    expect(detectLang('English')).toBe('en');
    expect(conversationLang(['English'])).toBe('en');
    expect(detectLanguage('English')).toBe('en');
    expect(conversationLanguage(['English'], ['en', 'vi'], 'vi')).toBe('en');
  });

  it('the request outweighs the lines before it, until they ask again', () => {
    expect(conversationLang(['chị muốn làm móng gel', 'giá bao nhiêu vậy', 'English please'])).toBe('en');
    expect(conversationLanguage(['chị muốn làm móng gel', 'giá bao nhiêu vậy', 'English please'], ['en', 'vi'], 'vi')).toBe('en');
    expect(conversationLang(['English please', 'thôi nói tiếng Việt đi'])).toBe('vi');
  });

  it('a Vietnamese customer saying "ok" or "thank you" stays Vietnamese', () => {
    expect(conversationLang(['chị muốn đặt lịch thứ 7', 'ok', 'thank you'])).toBe('vi');
  });

  it('the English rule tells the model not to copy the salon\'s earlier Vietnamese', () => {
    expect(replyLangRule('en')).toMatch(/EARLIER MESSAGES THE SALON SENT/);
  });
});

describe("Meta's ad greeting is not a person", () => {
  it('knows the default greeting in both languages', () => {
    expect(isMetaAdGreeting('Hi Stephany! Please let us know how we can help you.')).toBe(true);
    expect(isMetaAdGreeting('Hi Linda! Please let us know how we can help you.')).toBe(true);
    expect(isMetaAdGreeting('Chào Allison! Chúng tôi có thể giúp gì cho bạn?')).toBe(true);
    expect(isMetaAdGreeting('Hi! We have openings at 3pm today, want one?')).toBe(false);
  });
});
