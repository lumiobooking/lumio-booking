import { isGsmChar, smsSegments, toGsm7 } from './sms-text';

describe('toGsm7 — the cheap SMS alphabet without changing what a text says', () => {
  it("turns the real Amy's confirmation from UCS-2 into GSM-7", () => {
    const before = 'Hi Rhonda! This is Amy’s Lash and Brows 💕 your appointment for Refill 3 Weeks on Thu, Oct 30 at 2:30 PM – 4:00 PM is all set see you then✨';
    const after = toGsm7(before);
    expect(after).toBe("Hi Rhonda! This is Amy's Lash and Brows your appointment for Refill 3 Weeks on Thu, Oct 30 at 2:30 PM - 4:00 PM is all set see you then");
    expect(smsSegments(before).encoding).toBe('UCS-2');
    expect(smsSegments(after)).toEqual({ encoding: 'GSM-7', units: after.length, segments: 1 });
  });

  it('swaps punctuation for its plain twin', () => {
    expect(toGsm7('“Hello” — it’s… done · ok → next')).toBe('"Hello" - it\'s... done - ok -> next');
  });

  it('keeps accents that GSM already has, folds the rest to the plain letter', () => {
    expect(toGsm7('José, Renée, Müller, Peña')).toBe('José, Renée, Müller, Peña');
    expect(toGsm7('Nguyễn Thị Ánh, François, Łucja')).toBe('Nguyen Thi Anh, Francois, Lucja');
    expect(smsSegments(toGsm7('Nguyễn Thị Ánh')).encoding).toBe('GSM-7');
  });

  it('keeps a name in a non-Latin script — correctness beats cost', () => {
    expect(toGsm7('Hi 王小明, see you')).toBe('Hi 王小明, see you');
  });

  it('removes emoji cleanly, including flags, skin tones and keycaps', () => {
    expect(toGsm7('See you soon! 💅🏽')).toBe('See you soon!');
    expect(toGsm7('Booked ✅ 🇺🇸 thanks 👍')).toBe('Booked thanks');
    expect(toGsm7('Reply 1️⃣ to confirm')).toBe('Reply 1 to confirm');
    expect(toGsm7('Brand™ Salon®')).toBe('Brand Salon');
  });

  it('keeps line breaks and the link untouched', () => {
    const s = 'Line one\nManage/cancel: https://lumiobooking.com/a/AbC-_123';
    expect(toGsm7(s)).toBe(s);
  });

  it('is idempotent', () => {
    const once = toGsm7('A ’b’ — c 💕 d…');
    expect(toGsm7(once)).toBe(once);
  });

  it('leaves the default templates exactly as written', () => {
    const t = "Amy's Nails: Gel Manicure on Mon, Jun 22 at 5:30 PM. Tech: Tina. Total: $45.00. Reply STOP to opt out.";
    expect(toGsm7(t)).toBe(t);
  });
});

describe('smsSegments', () => {
  it('counts 160 / 153 on GSM-7 and 70 / 67 on UCS-2', () => {
    expect(smsSegments('a'.repeat(160)).segments).toBe(1);
    expect(smsSegments('a'.repeat(161)).segments).toBe(2);
    expect(smsSegments('a'.repeat(306)).segments).toBe(2);
    expect(smsSegments('a'.repeat(307)).segments).toBe(3);
    expect(smsSegments('é'.repeat(70) + '’').segments).toBe(2);
    expect(smsSegments('’'.repeat(70)).segments).toBe(1);
  });

  it('counts an extended GSM character as two', () => {
    expect(smsSegments('€'.repeat(80)).units).toBe(160);
    expect(smsSegments('€'.repeat(81)).segments).toBe(2);
    expect(isGsmChar('€')).toBe(true);
    expect(isGsmChar('’')).toBe(false);
  });
});
