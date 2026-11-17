import { repairCandidate } from './quick-repair';

const NEVER = (text: string) => ({ kind: 'never' as const, mode: 'meaning' as const, text });
const SAY = (text: string) => ({ kind: 'answer' as const, mode: 'verbatim' as const, text });
const draft = 'Dạ gói Marketing là 4.500.000đ/tháng ạ. Tiệm mình ở khu nào để em tư vấn kỹ hơn ạ?';

describe('quick repair: when the checker\'s own fix may go out instead of a second writing', () => {
  it('the draft with its one offending phrase reworded is usable', () => {
    const r = repairCandidate({ draft, rewrite: 'Dạ gói Marketing là 4.500.000đ/tháng ạ. Tiệm anh/chị ở khu nào để em tư vấn kỹ hơn ạ?', broken: [NEVER('không gọi khách là "tiệm mình"')], sameLanguage: true });
    expect(r).toEqual({ ok: true, text: 'Dạ gói Marketing là 4.500.000đ/tháng ạ. Tiệm anh/chị ở khu nào để em tư vấn kỹ hơn ạ?' });
  });

  it('a repair that only removes a sentence is usable (a repair is allowed to be shorter)', () => {
    const r = repairCandidate({ draft: 'We open at 9:00 AM. Would you like to book a time today?', rewrite: 'We open at 9:00 AM.', broken: [NEVER('do not invite a booking')], sameLanguage: true });
    expect(r.ok).toBe(true);
  });

  it.each([
    ['nothing came back', '', 'empty'],
    ['it is the "no reply" mark', '[NO_REPLY]', 'no-reply'],
    ['it changed nothing', `  ${draft.toUpperCase()} `, 'unchanged'],
    ['it is not a sentence', 'Dạ.', 'too-short'],
  ])('not usable when %s', (_n, rewrite, why) => {
    expect(repairCandidate({ draft, rewrite, broken: [NEVER('x')], sameLanguage: true })).toEqual({ ok: false, why });
  });

  it('not usable in another language than the conversation', () => {
    expect(repairCandidate({ draft, rewrite: 'The Marketing package is 4,500,000 VND a month. Which area is your shop in?', broken: [NEVER('x')], sameLanguage: false })).toEqual({ ok: false, why: 'language' });
  });

  it('not usable when it GREW: a repair removes or rewords, it never adds', () => {
    const grown = `${draft} Ngoài ra bên em đang tặng 2 tháng miễn phí, thiết kế logo, chạy quảng cáo Google, chăm sóc fanpage và nhiều ưu đãi khác cho khách đăng ký trong tuần này ạ.`;
    expect(repairCandidate({ draft, rewrite: grown, broken: [NEVER('x')], sameLanguage: true })).toEqual({ ok: false, why: 'grew' });
  });

  it('not usable when it lost the owner\'s word-for-word answer the draft was blocked for', () => {
    const exact = 'Tiệm mở cửa 9 giờ sáng đến 7 giờ tối, từ thứ Hai đến thứ Bảy.';
    const lost = repairCandidate({ draft: 'Dạ tiệm mở cả tuần ạ. Chị muốn đặt lịch không ạ?', rewrite: 'Dạ tiệm mở cả tuần ạ.', broken: [SAY(exact), NEVER('không mời đặt lịch')], sameLanguage: true });
    expect(lost).toEqual({ ok: false, why: 'lost-answer' });
    const kept = repairCandidate({ draft: 'Dạ tiệm mở cả tuần ạ. Chị muốn đặt lịch không ạ?', rewrite: `Dạ ${exact}`, broken: [SAY(exact), NEVER('không mời đặt lịch')], sameLanguage: true });
    expect(kept.ok).toBe(true);
  });
});
