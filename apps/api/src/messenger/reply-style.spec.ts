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
