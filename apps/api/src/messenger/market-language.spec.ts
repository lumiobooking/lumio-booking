import { conversationLang, defaultLangForMarket } from '../common/reply-language';
import { fallbackText } from './agent-fallback';

/**
 * Which language a customer is answered in when they have not said enough
 * to tell. An American salon's "hi" is answered in English; only a salon in
 * Vietnam starts in Vietnamese. A real sentence from the customer always
 * wins over the market.
 */
describe('the language a silent conversation starts in', () => {
  it('follows the salon market: Vietnam → Vietnamese, everywhere else → English', () => {
    expect(defaultLangForMarket('VN')).toBe('vi');
    expect(defaultLangForMarket('vn')).toBe('vi');
    expect(defaultLangForMarket('US')).toBe('en');
    expect(defaultLangForMarket('CA')).toBe('en');
    expect(defaultLangForMarket('AU')).toBe('en');
    expect(defaultLangForMarket(null)).toBe('en');
    expect(defaultLangForMarket(undefined)).toBe('en');
  });

  it('"hi" alone tells the detector nothing, so the market decides', () => {
    expect(conversationLang(['hi'])).toBeNull();
    expect(conversationLang(['hi']) ?? defaultLangForMarket('US')).toBe('en');
    expect(conversationLang(['hi']) ?? defaultLangForMarket('VN')).toBe('vi');
  });

  it('a real sentence from the customer beats the market in both directions', () => {
    expect(conversationLang(['How long is the 20% off promotion valid for?']) ?? defaultLangForMarket('VN')).toBe('en');
    expect(conversationLang(['cho em hỏi giá làm móng gel bao nhiêu ạ']) ?? defaultLangForMarket('US')).toBe('vi');
  });

  it('the holding line, when the bot cannot think, speaks the market language for a silent customer', () => {
    expect(fallbackText('hi', 'en')).toMatch(/^So sorry/);
    expect(fallbackText('hi', 'vi')).toMatch(/^Dạ em xin lỗi/);
    // …and the customer's own words still win over the market.
    expect(fallbackText('Are you open on Sunday?', 'vi')).toMatch(/^So sorry/);
    expect(fallbackText('cho em hỏi giá bao nhiêu', 'en')).toMatch(/^Dạ em xin lỗi/);
  });
});
