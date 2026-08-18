/**
 * Every example below is a sentence a real customer received on the Lumio
 * Agency page, or the reply that should have been sent instead.
 *
 * This file exists because the same failure kept returning in a new set of
 * words — "chưa có dịch vụ", then "chưa có kinh nghiệm", then "không được bán
 * riêng", then "không phải lựa chọn tốt nhất". Each was fixed by hand and
 * proven once, in a scratch file that was then thrown away, so the fifth
 * wording was free to arrive. Written down, they cannot come back unnoticed.
 */
import {
  killsTheLead,
  dodgesTheQuestion,
  guessesGender,
  disclosesBeforeQualifying,
  claimsFreshStart,
  safeHandoffReply,
  looksVietnamese,
} from './sales-guards';

describe('killsTheLead — replies that end a live conversation', () => {
  // All verbatim from production.
  it.each([
    ['refuses a trade', 'Dạ, bên em chuyên nail, spa và nhà hàng thôi ạ — chưa có dịch vụ riêng cho quán net/billiard/karaoke.'],
    ['pleads inexperience', 'Dạ, Lumio chuyên Marketing cho nail, spa, nhà hàng ạ. Quán net chúng em chưa có kinh nghiệm ạ.'],
    ['not our strong suit', 'Tuy nhiên shop đồ chơi có thể không phải diện mạnh của Lumio ạ.'],
    ['not the best choice', 'Bên em chuyên nail, spa — vì vậy có thể không phải lựa chọn tốt nhất cho PMU của anh/chị.'],
    ['sends them to a rival', 'Cứ tìm những đơn vị chuyên beauty riêng sẽ phù hợp hơn ạ.'],
    ['farewell to a live lead', 'Chúc anh/chị tìm được đối tác phù hợp nhé!'],
    ['no separate price', 'AI Messenger của Lumio không bán riêng ạ.'],
    // One word between the negation and the verb once let this whole class through.
    ['no separate price, one word apart', 'Dạ, AI Messenger không được bán riêng — nó tặng kèm theo các gói marketing ạ.'],
    ['not sold retail', 'AI Messenger của Lumio không bán lẻ, chỉ tặng kèm miễn phí theo gói ạ.'],
    ['bundle only', 'Dạ cái này chỉ có kèm theo gói thôi ạ.'],
    ['scolds the customer', 'Dạ, em xin lỗi — anh hỏi lần thứ 5 rồi ạ.'],
    ['as I already said', 'Dạ như em đã nói ở trên ạ.'],
    ['English refusal', 'We only serve nail salons and spas.'],
    ['English no separate price', 'That feature is not sold separately.'],
    ['English inexperience', 'We have no experience with that industry.'],
    ['English referral', 'Another agency might suit you better.'],
  ])('blocks: %s', (_name, reply) => {
    expect(killsTheLead(reply)).toBe(true);
  });

  it.each([
    ['quotes the right plan', 'Dạ gói Pro $69/tháng đã có sẵn bot AI Messenger ạ. Anh/chị cho em xin tên tiệm nhé?'],
    ['says yes to a trade', 'Dạ bên em có làm cho quán karaoke ạ, để em xin thông tin cho team tư vấn nhé.'],
    ['claims multi-industry work', 'Dạ có ạ — bên em làm marketing đa ngành và đã triển khai cho nhiều mô hình rồi ạ.'],
    ['hands to a human', 'Dạ phần này để team em tư vấn trực tiếp cho đúng với tiệm mình ạ.'],
    // The RIGHT way to say what the blocked sentences said wrongly.
    ['bundle framed as a bonus', 'Dạ gói Boost $179/tháng đã bao gồm sẵn phần mềm nên anh/chị không phải trả riêng ạ.'],
    ['regional phone number', 'Dạ tiệm mình ở Úc thì anh/chị gọi số +61 485 857 256 giúp em ạ.'],
    // "chưa rõ ý anh" must survive: it is a clarifying question, not a refusal.
    ['asks for clarification', 'Dạ em chưa rõ ý anh/chị, anh/chị nói rõ hơn giúp em được không ạ?'],
    // A goodbye AFTER capture is the polite ending the gate exists to protect.
    ['farewell after capture', 'Dạ chúc anh/chị một ngày tốt lành ạ, team sẽ gọi lại anh/chị sớm nhé.'],
    ['English hand-off', 'The team will advise you on that directly. May I take your shop name?'],
  ])('allows: %s', (_name, reply) => {
    expect(killsTheLead(reply)).toBe(false);
  });

  it('never trips its own safety net', () => {
    expect(killsTheLead(safeHandoffReply('quán net'))).toBe(false);
    expect(killsTheLead(safeHandoffReply('do you work with gyms?'))).toBe(false);
  });
});

describe('safeHandoffReply — what is sent when the model will not stop refusing', () => {
  it('answers in the language of the conversation', () => {
    expect(safeHandoffReply('Bên em có làm cho quán net không')).toContain('team');
    expect(looksVietnamese('Bên em có làm cho quán net không')).toBe(true);
    expect(looksVietnamese('Do you work with gyms?')).toBe(false);
    expect(safeHandoffReply('Do you work with gyms?')).toMatch(/team will advise/i);
  });
});

describe('dodgesTheQuestion — a catalogue in answer to a question', () => {
  it('blocks a brochure opening when something was asked', () => {
    expect(dodgesTheQuestion(
      'Lumio AI Messenger có tự động trả lời trên Instagram không?',
      'Dạ Lumio chuyên hỗ trợ các tiệm Nail & Spa xây dựng hệ thống Marketing và Booking. Hiện bên em có: • Marketing…',
    )).toBe(true);
    expect(dodgesTheQuestion('Do you support Instagram?', 'Lumio is a full-service marketing agency.')).toBe(true);
  });

  it('allows a direct answer', () => {
    expect(dodgesTheQuestion(
      'Lumio AI Messenger có tự động trả lời trên Instagram không?',
      'Dạ có ạ — AI trả lời cả Messenger và Instagram của tiệm mình.',
    )).toBe(false);
  });

  it('leaves a brochure alone when nobody asked a question', () => {
    expect(dodgesTheQuestion('ok', 'Dạ Lumio chuyên hỗ trợ các tiệm xây dựng hệ thống Marketing ạ.')).toBe(false);
  });

  it('does not treat a clarifying question as a dodge', () => {
    expect(dodgesTheQuestion('Giá bao nhiêu?', 'Dạ tiệm mình ở khu nào ạ?')).toBe(false);
  });
});

describe('guessesGender — deciding anh or chị without being told', () => {
  it('blocks a guess', () => {
    expect(guessesGender('Bên em làm cho tiệm nail không', 'Tiệm chị ở đâu vậy ạ?')).toBe(true);
    expect(guessesGender('giá dịch vụ AI như thế nào', 'Dạ anh cho em xin số điện thoại nhé ạ?')).toBe(true);
  });

  it('allows the form that is never wrong', () => {
    expect(guessesGender('Bên em làm cho tiệm nail không', 'Anh/chị cho em xin tên tiệm nhé?')).toBe(false);
  });

  it('respects what the customer called themselves', () => {
    expect(guessesGender('chị cần tư vấn gói booking', 'Dạ chị cho em xin số điện thoại nhé ạ?')).toBe(false);
    expect(guessesGender('anh muốn xem bảng giá', 'Dạ anh cho em xin tên tiệm ạ?')).toBe(false);
  });

  // \b is ASCII-only, so \bchị\b never matches. The first version of this
  // check silently passed every "chị" in the language.
  it('matches Vietnamese words despite their tone marks', () => {
    expect(guessesGender('cho em hỏi', 'Dạ chị quan tâm gói nào ạ?')).toBe(true);
  });

  it('does not mistake "nhanh" for "anh"', () => {
    expect(guessesGender('cho em hỏi giá', 'Dạ để em gửi nhanh bảng giá cho mình ạ.')).toBe(false);
  });
});

describe('disclosesBeforeQualifying — prices handed to someone unidentified', () => {
  it.each([
    'Dạ gói Pro $69/tháng đã có AI Messenger ạ.',
    'Dạ gói Boost $179/tháng gồm hệ Booking ạ.',
    'Dạ phần mềm từ $29/tháng ạ.',
  ])('blocks a price when nobody has said which shop: %s', (reply) => {
    expect(disclosesBeforeQualifying('giá bao nhiêu', reply)).toBe(true);
  });

  it.each([
    ['a shop and a city', 'tiệm mình là Lotus Nails ở Houston'],
    ['a Maps link', 'https://maps.app.goo.gl/abc123'],
    ['a phone number', 'sdt em la 512-886-8189'],
  ])('allows a price once identified by %s', (_name, words) => {
    expect(disclosesBeforeQualifying(words, 'Dạ gói Pro $69/tháng đã có AI Messenger ạ.')).toBe(false);
  });

  it('allows a reply that quotes nothing', () => {
    expect(disclosesBeforeQualifying(
      'giá bao nhiêu',
      'Dạ tuỳ quy mô tiệm mình ạ. Anh/chị cho em xin tên tiệm và thành phố nhé?',
    )).toBe(false);
  });

  it('never reveals whether an area is taken', () => {
    expect(disclosesBeforeQualifying(
      'khu vực tôi còn nhận không',
      'Dạ team em kiểm tra từng khu vực rồi báo lại ạ. Anh/chị cho em xin tên tiệm nhé?',
    )).toBe(false);
  });
});

describe('claimsFreshStart — telling a long conversation it has just begun', () => {
  it('blocks the contradiction a customer actually received', () => {
    expect(claimsFreshStart(true,
      'Dạ được ạ, em đã ghi nhận email của anh/chị. Anh/chị vừa mở chat nên em chưa biết tiệm anh/chị ở đâu và làm ngành gì.',
    )).toBe(true);
  });

  it('blocks claiming ignorance of what was already given', () => {
    expect(claimsFreshStart(true, 'Dạ em chưa biết tiệm mình ở đâu ạ.')).toBe(true);
    expect(claimsFreshStart(true, 'You just opened the chat so I do not have your details yet.')).toBe(true);
  });

  it('allows a genuine greeting on a genuinely new chat', () => {
    expect(claimsFreshStart(false, 'Dạ anh/chị vừa mở chat, em có thể giúp gì ạ?')).toBe(false);
  });

  it('allows asking for the one thing still missing', () => {
    expect(claimsFreshStart(true, 'Dạ em còn thiếu mỗi số điện thoại thôi ạ, anh/chị cho em xin nhé?')).toBe(false);
  });

  it('allows using what they already gave', () => {
    expect(claimsFreshStart(true, 'Dạ em ghi nhận tiệm Elegantnails ở Houston rồi ạ, team sẽ gọi lại trong 24h nhé.')).toBe(false);
  });
});
