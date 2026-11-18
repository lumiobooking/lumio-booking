import { cardElement, cardTapLine, cleanCards, cleanChoice, cleanChoices, choicesAsText, quickRepliesFor, splitBubbles, tidyReply } from './reply-style';

describe('reply style (approved mockup)', () => {
  it('strips markdown and turns list marks into ▸', () => {
    expect(tidyReply('**Boost** — $179\n- 12 bài\n* 4 video\n1. FB, IG\n\n\n\nHỏi?')).toBe('Boost — $179\n▸ 12 bài\n▸ 4 video\n▸ FB, IG\n\nHỏi?');
  });
  it('splits into at most two bubbles, the question last', () => {
    const t = 'Dạ cho Google Maps bên em có 3 gói ạ:\n\n▸ Map Foundation — $179/th\n▸ Map Growth — $279/th\n\nTiệm mình ở khu vực nào ạ?';
    expect(splitBubbles(t)).toEqual(['Dạ cho Google Maps bên em có 3 gói ạ:\n\n▸ Map Foundation — $179/th\n▸ Map Growth — $279/th', 'Tiệm mình ở khu vực nào ạ?']);
    expect(splitBubbles('Dạ em chào anh/chị ạ.\n\nAnh/chị cần gì ạ?')).toHaveLength(1);
  });
  it('never makes the customer call themselves "em"', () => {
    expect(cleanChoice('Để em suy nghĩ thêm')).toBe('Suy nghĩ thêm');
    expect(cleanChoice('Em muốn xem giá')).toBe('Xem giá');
    expect(cleanChoice('Tôi cần tư vấn.')).toBe('Tư vấn');
    expect(cleanChoice('Nhân viên gọi tư vấn')).toBe('Nhân viên gọi tư vấn');
  });
  it('keeps choices within 20 characters, unique, max 5', () => {
    const c = cleanChoices(['Lên top Google Maps ngay hôm nay', 'a1', 'A1', 'b', 'c', 'd', 'e']);
    expect(c[0].length).toBeLessThanOrEqual(20);
    expect(c).toHaveLength(5);
    expect(quickRepliesFor(['Suy nghĩ thêm'])[0]).toEqual({ content_type: 'text', title: 'Suy nghĩ thêm', payload: 'CHOICE:Suy nghĩ thêm' });
    expect(choicesAsText(['A', 'B'])).toBe('▸ A   ▸ B');
  });
  it('builds a package card within Messenger limits', () => {
    const [c] = cleanCards([{ name: 'Map Growth', price: '$279/tháng', tag: 'Hợp đa số tiệm', points: ['Top 3–5 quanh tiệm', 'Phí khởi tạo $99', 'Cam kết 3–4 tháng'] }]);
    const el = cardElement(c, []);
    expect(el.title).toBe('Map Growth · $279/tháng');
    expect(el.subtitle.length).toBeLessThanOrEqual(80);
    expect(el.subtitle.startsWith('Hợp đa số tiệm · Top 3–5 quanh tiệm')).toBe(true);
  });
  it('reads card taps as the customer\'s line, no pronoun', () => {
    expect(cardTapLine('PKG_INFO:Map Growth')).toBe('Xem đủ quyền lợi gói Map Growth');
    expect(cardTapLine('PKG_CMP:Map Growth')).toBe('So sánh gói Map Growth với các gói khác');
    expect(cardTapLine('ASK_PKG:x')).toBeNull();
  });
});

import { REPLY_STYLE_RULE as STYLE_R, SALES_FLOW_RULE as FLOW_R } from './reply-style';
import { judgePrompt as jp, correctionFor as cf } from '../ai-brain/instructions';
describe('the approved layout survives an owner-instruction correction (Lumio Agency, 16/11/2026)', () => {
  it('our own example never uses the word an owner bans ("tiệm mình")', () => {
    expect(`${STYLE_R}\n${FLOW_R}`).not.toMatch(/tiệm mình|bên mình/);
  });
  it('the judge and the correction both keep the layout, and the rewrite is not squeezed into 1–3 sentences', () => {
    const rule = { id: 'r', tenantId: 't', kind: 'always', text: 'Không được xưng hô mình', triggers: [], mode: 'meaning', channels: [], on: true } as never;
    const j = jp({ all: [rule], check: [rule], customer: 'giá gói', draft: 'x', langName: 'Vietnamese', voice: false }).user;
    expect(j).toContain('LAYOUT');
    expect(j).toContain('Never merge a tidy reply into one paragraph');
    expect(j).not.toContain('1–3 short sentences');
    expect(cf([rule], [rule])).toContain('in the same layout');
  });
});

describe('the cards already said it — the text under them does not repeat the list (17/11/2026)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { afterCardsText } = require('./reply-style') as typeof import('./reply-style');
  const WALL = [
    "Hi, I'm Trang from Lumio. Here are our packages, quoted from our current price list.",
    'Monthly marketing packages:',
    '▸ Social Care: $45/month, 10 posts + 1 short video a month on Facebook and Instagram, plus a free audit',
    '▸ Boost: $179/month, 12 posts + 4 videos a month on Facebook, Instagram and TikTok, with the Lumio Booking system included',
    '▸ Growth: $279/month, adds Google Maps posts, 20 new Google photos a month, and AI Messenger',
    '▸ Scale: $379/month, adds a website, email marketing and a monthly strategy call',
    'Which of these matters most to your salon right now?',
  ].join('\n');

  it('the golden-run case: 100+ words of packages become the hello and the one question', () => {
    const out = afterCardsText(WALL, 'en');
    expect(out).toBe("Hi, I'm Trang from Lumio. Here are our packages, quoted from our current price list. Which of these matters most to your salon right now?");
    expect(out).not.toContain('▸');
    expect(out).not.toContain('$');
  });

  it('the same reply typed as one paragraph (bullets inline) is handled too', () => {
    const out = afterCardsText(WALL.replace(/\n/g, ' '), 'en');
    expect(out).not.toContain('▸');
    expect(out.endsWith('Which of these matters most to your salon right now?')).toBe(true);
  });

  it('asks our own question when the model left none, in the customer\'s language', () => {
    expect(afterCardsText('Dạ đây là các gói bên em:\n▸ Boost: $179/tháng\n▸ Growth: $279/tháng', 'vi')).toBe('Anh/chị thấy gói nào hợp với tiệm anh/chị nhất ạ?');
    expect(afterCardsText('Our packages:\n▸ Boost: $179\n▸ Growth: $279', 'en')).toBe('Which of these fits your shop best?');
  });

  it('a reply that is already short is the model\'s own and is not touched', () => {
    const short = 'Em gửi anh/chị các gói ở trên ạ. Anh/chị quan tâm gói nào nhất ạ?';
    expect(afterCardsText(short, 'vi')).toBe(short);
    expect(afterCardsText('', 'en')).toBe('');
  });
});

describe('an English reply does not open with "Dạ," (17/11/2026)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { dropStrayParticle } = require('./reply-style') as typeof import('./reply-style');
  it('the golden-run case', () => {
    expect(dropStrayParticle("Dạ, we're at 5900 Balcones Drive 🙂 We're open every day.", 'en')).toBe("We're at 5900 Balcones Drive 🙂 We're open every day.");
    expect(dropStrayParticle('Dạ vâng, sure — what time works?', 'en')).toBe('Sure — what time works?');
  });
  it('a Vietnamese customer keeps it, and so does a Vietnamese reply to a customer whose language was guessed wrong', () => {
    expect(dropStrayParticle('Dạ, tiệm mở cửa từ 9 giờ ạ.', 'vi')).toBe('Dạ, tiệm mở cửa từ 9 giờ ạ.');
    expect(dropStrayParticle('Dạ, tiệm mở cửa từ 9 giờ ạ.', 'en')).toBe('Dạ, tiệm mở cửa từ 9 giờ ạ.');
  });
  it('leaves everything else alone', () => {
    expect(dropStrayParticle('Hi! We open at 9.', 'en')).toBe('Hi! We open at 9.');
    expect(dropStrayParticle('', 'en')).toBe('');
    expect(dropStrayParticle('Dạ', 'en')).toBe('Dạ');
  });
});
