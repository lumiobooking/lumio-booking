import { conversationLanguage, detectLanguage, isGoodbye, keepOpenLine, mayHangUp, nextPendingId, parsePendingId, voiceLangCode } from './brain-rules';

describe('when a call may end', () => {
  it('only when the caller closed it — never because the model wanted to', () => {
    expect(mayHangUp({ wantEnd: true, booked: false, lastUser: 'ok', reply: 'Goodbye!' })).toBe(false);
    expect(mayHangUp({ wantEnd: true, booked: false, lastUser: 'how much is a pedicure?', reply: '' })).toBe(false);
    expect(mayHangUp({ wantEnd: true, booked: false, lastUser: 'Thanks, bye!', reply: '' })).toBe(true);
    expect(mayHangUp({ wantEnd: true, booked: false, lastUser: 'Dạ thôi, cảm ơn em nhé', reply: '' })).toBe(true);
    expect(mayHangUp({ wantEnd: true, booked: false, lastUser: 'That\'s all, thank you', reply: '' })).toBe(true);
    expect(mayHangUp({ wantEnd: false, booked: true, lastUser: 'bye', reply: '' })).toBe(false);
  });

  it('after a booking, a plain "no" to "anything else?" is goodbye enough', () => {
    expect(mayHangUp({ wantEnd: true, booked: true, lastUser: 'No, thanks', reply: '' })).toBe(true);
    expect(mayHangUp({ wantEnd: true, booked: true, lastUser: 'Dạ không ạ', reply: '' })).toBe(true);
    expect(mayHangUp({ wantEnd: true, booked: false, lastUser: 'No', reply: '' })).toBe(false);
  });

  it('a goodbye that carries another question is not a goodbye', () => {
    expect(isGoodbye('Thanks bye — oh wait, actually can I also add a pedicure for my friend?')).toBe(false);
    expect(isGoodbye('cảm ơn em, mà em ơi còn chỗ cho 2 người thứ 7 không em')).toBe(false);
    expect(isGoodbye('')).toBe(false);
  });

  it('has a line to keep the call open in the call\'s language', () => {
    expect(keepOpenLine('vi-VN')).toMatch(/ạ\?$/);
    expect(keepOpenLine('en-US')).toMatch(/anything else/i);
  });

  it('counts filler hops in the pending id', () => {
    expect(parsePendingId('CA123-abc')).toEqual({ base: 'CA123-abc', hop: 0 });
    expect(parsePendingId(nextPendingId('CA123-abc', 2))).toEqual({ base: 'CA123-abc', hop: 2 });
    expect(parsePendingId('')).toBeNull();
  });
});

describe('the language a customer writes in', () => {
  it('reads Vietnamese, English, Spanish, French, Chinese, Korean and Japanese', () => {
    expect(detectLanguage('Chị muốn làm gel pedicure thứ 7')).toBe('vi');
    expect(detectLanguage('Do you have anything Saturday afternoon?')).toBe('en');
    expect(detectLanguage('Hola, ¿tienen hora el sábado para pedicure?')).toBe('es');
    expect(detectLanguage('Bonjour, je voudrais un rendez-vous samedi')).toBe('fr');
    expect(detectLanguage('请问周六有空吗')).toBe('zh');
    expect(detectLanguage('토요일에 예약 가능한가요')).toBe('ko');
    expect(detectLanguage('土曜日に予約できますか')).toBe('ja');
  });

  it('a borrowed word decides nothing', () => {
    expect(detectLanguage('ok')).toBeNull();
    expect(detectLanguage('thank you')).toBeNull();
    expect(detectLanguage('👍')).toBeNull();
    expect(detectLanguage('512-555-0147')).toBeNull();
  });

  it('the conversation votes, and a language the salon does not serve falls back to its primary', () => {
    expect(conversationLanguage(['Hola', 'quiero una cita para el sábado', 'ok'], ['en', 'vi', 'es'], 'en')).toBe('es');
    expect(conversationLanguage(['Hola', 'quiero una cita para el sábado'], ['en', 'vi'], 'en')).toBe('en');
    expect(conversationLanguage(['ok', '👍'], ['en', 'vi'], 'vi')).toBe('vi');
    // A customer who really switches is followed within a message or two.
    expect(conversationLanguage(['Chào em, em làm gel không', 'Actually my friend will book, do you have Saturday at 2 for both of us?', 'Yes please book it for two people'], ['en', 'vi'], 'vi')).toBe('en');
  });

  it('maps a brain language to what the hotline listens in', () => {
    expect(voiceLangCode('vi')).toBe('vi-VN');
    expect(voiceLangCode('en', 'AU')).toBe('en-AU');
    expect(voiceLangCode('es')).toBe('es-US');
  });
});
