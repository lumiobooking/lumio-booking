import {
  forbiddenPhrases, saysForbidden, readsInternal, outboundVerdict, isCloser, silentOnCloser,
  isNoReply, looksLikeNote, SILENT, HELD, NO_REPLY_TOKEN, withoutBadSentences,
} from './outbound-guard';
import { checkingLine, lastResort, type Instruction } from '../ai-brain/instructions';
import { mayDropReply } from './burst';
import { rescueVerdict } from './rescue-stuck';

const ins = (o: Partial<Instruction>): Instruction => ({ id: o.id ?? 'x', kind: o.kind ?? 'never', text: o.text ?? '', triggers: o.triggers ?? [], mode: o.mode ?? 'meaning', channels: [], on: true, meaning: o.meaning ?? null });

// Amy's Lash and Brows, 6–7 Nov 2026 — the owner's own words.
const banDoubleCheck = ins({ id: 'n1', kind: 'never', text: 'Không được nói “Let me double-check with the salon”' });
const silentOnNo = ins({ id: 'a1', kind: 'answer', text: 'When the customer says no thanks, do not reply to the customer.', triggers: ['no thx', 'no thanks'] });

describe('the owner forbade a sentence — no path sends it', () => {
  it('reads the quoted sentence out of a NEVER instruction', () => {
    expect(forbiddenPhrases([banDoubleCheck])).toEqual(['let me double check with the salon']);
    // Two-word quotes are words, not sentences: not banned.
    expect(forbiddenPhrases([ins({ text: 'never say "ok dear"' })])).toEqual([]);
    // Off, or not a NEVER: nothing.
    expect(forbiddenPhrases([{ ...banDoubleCheck, on: false }])).toEqual([]);
  });

  it('catches the sentence, with punctuation, case and a few words in between', () => {
    const p = forbiddenPhrases([banDoubleCheck]);
    expect(saysForbidden('Let me double-check with the salon!', p)).toBeTruthy();
    expect(saysForbidden("Let me double-check that with the salon so I give you the right answer — I'll get back to you shortly.", p)).toBeTruthy();
    expect(saysForbidden('Yes, we have 2pm on Friday. Shall I book it?', p)).toBeNull();
  });

  it('the built-in "checking" fallback never says it once the owner forbade it', () => {
    expect(checkingLine('en')).toMatch(/double-check/);
    const line = checkingLine('en', [banDoubleCheck]);
    expect(line).not.toMatch(/double-check/i);
    expect(saysForbidden(line, forbiddenPhrases([banDoubleCheck]))).toBeNull();
  });

  it('the last door holds it back whatever produced it', () => {
    const v = outboundVerdict("Let me double-check with the salon and I'll get back to you.", [banDoubleCheck]);
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/forbidden/);
  });
});

describe('internal notes never reach a customer', () => {
  it('an instruction-like answer is not sent as the last resort', () => {
    expect(looksLikeNote(silentOnNo.text)).toBe(true);
    expect(lastResort([silentOnNo], '', true)).toBe('');
    // A real customer-facing answer still is.
    const fact = ins({ kind: 'answer', text: 'Hiện tiệm không có giảm giá cho khách lần đầu.' });
    expect(lastResort([fact], '', true)).toBe(fact.text);
  });

  it('the door holds back the owner’s note, or anything addressed to the bot', () => {
    expect(outboundVerdict(silentOnNo.text, [silentOnNo]).ok).toBe(false);
    expect(readsInternal('SYSTEM CORRECTION — that reply was blocked.')).toBeTruthy();
    expect(readsInternal('NEVER: promise a discount')).toBeTruthy();
    expect(readsInternal('The AI should stay silent here.')).toBeTruthy();
    expect(readsInternal('Khi khách nói không cần thì AI phải im lặng.')).toBeTruthy();
  });

  it('ordinary replies pass — including ones that repeat an answer’s facts', () => {
    const fact = ins({ kind: 'answer', text: 'Hair stroke brows last 1 to 3 years and the consultation is free.' });
    const always = ins({ kind: 'always', text: 'Always mention parking is free behind the building.' });
    for (const reply of [
      'Hi Maryann! 😊 Yes, HairStroke Brows is a form of permanent makeup. Have you had your eyebrows done before?',
      'Hair stroke brows last 1 to 3 years, and the consultation is free. Would you like to book one?',
      'Parking is free behind the building. See you Friday at 2pm!',
      'Dạ bên em còn 2h chiều thứ Sáu ạ. Em đặt lịch cho anh/chị luôn nhé?',
      'We will reply to your email shortly.',
    ]) {
      expect(outboundVerdict(reply, [fact, always, banDoubleCheck]).ok).toBe(true);
    }
  });

  it('silence and held replies are never sent', () => {
    expect(outboundVerdict(SILENT).ok).toBe(false);
    expect(outboundVerdict(SILENT).why).toBe('silent');
    expect(outboundVerdict(HELD).ok).toBe(false);
    expect(outboundVerdict(HELD).why).not.toBe('silent');
    expect(outboundVerdict(NO_REPLY_TOKEN).why).toBe('silent');
    expect(isNoReply(' [NO_REPLY] ')).toBe(true);
    expect(isNoReply('no reply needed, see you!')).toBe(false);
  });
});

describe('“No thx” gets no answer', () => {
  it('a decline is always the end', () => {
    for (const t of ['No thx', 'no thanks', 'No thank you!', "I'm good", 'không cần đâu ạ', 'thôi em', 'dạ thôi ạ']) {
      expect(silentOnCloser(t, 'Would you like to book a consultation?')).toBe(true);
    }
  });

  it('a thanks/ok closes only when the bot was not waiting for an answer', () => {
    expect(silentOnCloser('ok thanks', 'See you Friday at 2pm!')).toBe(true);
    expect(silentOnCloser('👍', 'See you Friday at 2pm!')).toBe(true);
    expect(silentOnCloser('cảm ơn em', 'Dạ lịch của chị đã xong ạ.')).toBe(true);
    // "ok" to "Shall I book 2pm?" is a yes.
    expect(silentOnCloser('ok', 'Shall I book 2pm Friday for you?')).toBe(false);
    // A bare "no" can answer a question.
    expect(silentOnCloser('no', 'Do you have a time in mind?')).toBe(false);
  });

  it('a question or a longer message is never a closer', () => {
    expect(isCloser('no thanks, but what about Sunday?')).toBe(false);
    expect(isCloser('Thanks! Is the consultation free?')).toBe(false);
    expect(isCloser('I can’t afford to do anything with them right now, maybe next month')).toBe(false);
  });
});

describe('one reply per customer turn', () => {
  it('a reply is dropped for a newer message only when its run did nothing', () => {
    expect(mayDropReply([])).toBe(true);
    expect(mayDropReply(['check_availability', 'get_services'])).toBe(true);
    expect(mayDropReply(['check_availability', 'create_booking'])).toBe(false);
    expect(mayDropReply(['send_photos'])).toBe(false);
  });
});

describe('the bot does not rescue a chat a person is in', () => {
  const NOW = Date.parse('2026-11-07T03:00:00Z');
  const base = { channel: 'messenger', status: 'open', lastRole: 'user' as const, handoff: true, handoffMode: 'auto', assignedUserId: null };
  const rules = { botOn: true, botFirst: false, graceMins: 0, activeMins: 120 };
  it('staff wrote 20 min ago, customer 10 min ago: stays quiet (Y = 0)', () => {
    const t = { ...base, handoffAt: new Date(NOW - 20 * 60_000), lastCustomerAt: new Date(NOW - 10 * 60_000) };
    expect(rescueVerdict(t as never, rules, NOW)).toEqual({ rescue: false, why: 'human-grace' });
  });
  it('a salon that set Y = 5 gets the safety net', () => {
    const t = { ...base, handoffAt: new Date(NOW - 20 * 60_000), lastCustomerAt: new Date(NOW - 10 * 60_000) };
    expect(rescueVerdict(t as never, { ...rules, graceMins: 5 }, NOW)).toEqual({ rescue: true, release: true });
  });
  it('the person left hours ago: the bot answers', () => {
    const t = { ...base, handoffAt: new Date(NOW - 5 * 3600_000), lastCustomerAt: new Date(NOW - 10 * 60_000) };
    expect(rescueVerdict(t as never, rules, NOW)).toEqual({ rescue: true, release: true });
  });
});

describe('no false alarms on everyday salon replies', () => {
  it('aftercare, quiet rooms and policies pass', () => {
    for (const reply of [
      'Dạ đây là lời dặn chăm sóc sau khi phun mày: tránh nước 7 ngày ạ.',
      'Phòng spa bên em rất yên tĩnh, anh/chị có thể thư giãn hoàn toàn ạ.',
      'If you need to cancel, just let us know 24 hours before.',
      'Our AI-free studio uses only hand tools 😊',
    ]) expect(outboundVerdict(reply).ok).toBe(true);
  });
});

describe('one bad sentence does not sink a good reply', () => {
  it('drops only the forbidden sentence', () => {
    const r = withoutBadSentences('Yes, the consultation is free and takes about 20 minutes. Let me double-check with the salon about Saturday.', [banDoubleCheck]);
    expect(r).toBe('Yes, the consultation is free and takes about 20 minutes.');
  });
  it('nothing worth sending left: held', () => {
    expect(withoutBadSentences("Let me double-check with the salon. I'll be back!", [banDoubleCheck])).toBeNull();
    expect(withoutBadSentences(SILENT, [banDoubleCheck])).toBeNull();
  });
  it('a clean reply is untouched', () => {
    expect(withoutBadSentences('See you Friday at 2pm! 😊', [banDoubleCheck])).toBe('See you Friday at 2pm! 😊');
  });
});

import { describeMedia, localizeStage } from './inbound-media';

describe('an English salon never reads our Vietnamese stage directions', () => {
  it('translates what we stored, for the inbox and the model', () => {
    expect(localizeStage('[Khách gửi 1 ảnh]', 'en')).toBe('[Customer sent a photo]');
    expect(localizeStage('[Khách gửi tệp đính kèm]', 'en')).toBe('[Customer sent an attachment]');
    expect(localizeStage(describeMedia([{ kind: 'image', url: 'a' }, { kind: 'image', url: 'b' }, { kind: 'video', url: null }]), 'en')).toBe('[Customer sent 2 photos, sent a video]');
    expect(localizeStage('[Đã gửi 2 ảnh: Ombre brows]', 'en')).toBe('[Sent 2 photos: Ombre brows]');
  });
  it('leaves everything else — and Vietnamese salons — alone', () => {
    expect(localizeStage('[Khách gửi 1 ảnh]', 'vi')).toBe('[Khách gửi 1 ảnh]');
    expect(localizeStage('Thank you Love. Hơ you doing?', 'en')).toBe('Thank you Love. Hơ you doing?');
    expect(localizeStage('[Khách gửi gì đó lạ]', 'en')).toBe('[Khách gửi gì đó lạ]');
  });
});
