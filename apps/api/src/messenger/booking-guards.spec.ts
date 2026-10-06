/**
 * "Great — Monday at 11:00 AM is booked in. What's your first name?" reached a
 * real customer before any booking existed. These tests hold the gate that
 * now stops that sentence, both as pure string rules and inside the real
 * agent loop with a scripted model.
 */
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  AppointmentStatus: { CANCELLED: 'CANCELLED' },
}));
jest.mock('../common/llm', () => ({
  ...jest.requireActual('../common/llm'),
  chat: jest.fn(),
}));
import { chat } from '../common/llm';
import { claimsBooked, vagueAvailability, mayTalkAsBooked, notBookedYetLine, notRepeatLine, asksQuestion, aboutTheBooking, isBookingRecap, answersBeforeRecap, endsOnFiller, customerWrappingUp } from './booking-guards';
import { MessengerService } from './messenger.service';

describe('claimsBooked — a reply that says the booking exists', () => {
  it.each([
    "Great — Monday at 11:00 AM is booked in. What's your first name?",
    "You're booked for Friday at 2!",
    "I've booked you in for 10:30 tomorrow.",
    "You're all set for Saturday 👍",
    'That slot is reserved for you.',
    'Your appointment is confirmed.',
    'See you then!',
    'See you on Monday!',
    'Dạ em đã đặt lịch cho chị lúc 11h thứ Hai ạ.',
    'Dạ lịch của anh/chị đã được xác nhận ạ.',
    'Dạ đặt lịch thành công rồi ạ!',
    'Hẹn gặp chị vào thứ Hai nhé!',
  ])('blocks: %s', (s) => expect(claimsBooked(s)).toBe(true));

  it.each([
    '11:00 AM works 👍 What’s your first name?',
    'Tomorrow I have 10:00, 11:30 or 2:00 — which suits you?',
    'Once you’re booked you’ll get a text confirmation.',
    'Shall I book it?',
    'Gel manicure, Friday 2:00 PM, for Anna — shall I book it?',
    'Dạ giờ đó còn trống ạ, chị cho em xin tên nhé?',
    'Dạ anh/chị đã đặt lịch bên em trước đây chưa ạ?',
    'Sau khi em đặt xong, chị sẽ nhận tin nhắn xác nhận ạ.',
    '',
  ])('lets through: %s', (s) => expect(claimsBooked(s)).toBe(false));
});

describe('questions first', () => {
  it.each([
    'Delois Jones 3343904874 when is your grand opening',
    'how much is a gel fill',
    'Do you take walk-ins?',
    'chị ơi có làm gel không',
    'bên em mấy giờ đóng cửa',
  ])('hears a question in: %s', (t) => expect(asksQuestion(t)).toBe(true));

  it.each(['yes', 'Grand opening day', 'Kim 512-555-0147', 'ok em', ''])('no question in: %s', (t) => expect(asksQuestion(t)).toBe(false));

  it('a question about the booking itself is answered by the recap, so it is not held back', () => {
    expect(aboutTheBooking('can I come at 3pm?')).toBe(true);
    expect(aboutTheBooking('is Saturday available?')).toBe(true);
    expect(aboutTheBooking('ngày mai còn chỗ không')).toBe(true);
    expect(aboutTheBooking('when is your grand opening')).toBe(false);
    expect(aboutTheBooking('how much is a gel fill')).toBe(false);
  });

  it('tells a recap that answered first from one that skipped the answer', () => {
    expect(answersBeforeRecap('Just to confirm: basic pedicure, Friday October 9 at 1:00 PM for Delois · 334-390-4874 — shall I book it?')).toBe(false);
    expect(answersBeforeRecap('Great! Just to confirm: pedicure Friday 1 PM — shall I book it?')).toBe(false);
    expect(answersBeforeRecap('Our grand opening is Friday, October 9 🎉 Just to confirm: pedicure, Friday October 9 at 1:00 PM for Delois · 334-390-4874 — shall I book it?')).toBe(true);
    expect(answersBeforeRecap('Gel manicure is $44 💅 What day would you like to come in?')).toBe(true);
  });

  it('spots a dead-end closing line, and lets a polite goodbye through', () => {
    expect(endsOnFiller('Our grand opening is October 9 🎉 Any other questions?')).toBe(true);
    expect(endsOnFiller('Gel is $44. Let me know if you have any questions!')).toBe(true);
    expect(endsOnFiller('Dạ gel là $44 ạ. Anh/chị còn câu hỏi nào nữa không ạ?')).toBe(true);
    expect(endsOnFiller('Gel manicure is $44 💅 What day would you like to come in?')).toBe(false);
    expect(customerWrappingUp('not sure yet, I will let you know')).toBe(true);
    expect(customerWrappingUp('Dạ để chị suy nghĩ thêm')).toBe(true);
    expect(customerWrappingUp('how much is a gel fill')).toBe(false);
  });

  it('recognises the recap', () => {
    expect(isBookingRecap('Just to confirm: basic pedicure, Friday October 9 at 1:00 PM for Delois · 334-390-4874 — shall I book it?')).toBe(true);
    expect(isBookingRecap('Dạ em xác nhận lại: … em đặt lịch luôn nhé?')).toBe(true);
    expect(isBookingRecap('Our grand opening is October 9 🎉 Any other questions?')).toBe(false);
  });
});

describe('vagueAvailability', () => {
  it('blocks "plenty of slots" with no time named', () => {
    expect(vagueAvailability('Tomorrow (Monday) and Wednesday both have plenty of slots. Which works?')).toBe(true);
    expect(vagueAvailability("We're pretty open on Monday!")).toBe(true);
    expect(vagueAvailability('Dạ thứ Hai còn nhiều giờ trống lắm ạ')).toBe(true);
  });
  it('lets through a reply that offers concrete times', () => {
    expect(vagueAvailability('Plenty of room tomorrow — 10:00 AM, 11:30 or 2 PM?')).toBe(false);
    expect(vagueAvailability('Dạ thứ Hai còn nhiều giờ trống, 10h hoặc 14h ạ?')).toBe(false);
    expect(vagueAvailability('What day works for you?')).toBe(false);
  });
});

describe('mayTalkAsBooked', () => {
  const none = new Set<string>();
  it('only after a real booking, an existing appointment, or a lookup', () => {
    expect(mayTalkAsBooked({ bookedNow: false, upcoming: 0, toolsUsed: none })).toBe(false);
    expect(mayTalkAsBooked({ bookedNow: true, upcoming: 0, toolsUsed: none })).toBe(true);
    expect(mayTalkAsBooked({ bookedNow: false, upcoming: 1, toolsUsed: none })).toBe(true);
    expect(mayTalkAsBooked({ bookedNow: false, upcoming: 0, toolsUsed: new Set(['find_appointment']) })).toBe(true);
    // Checking availability is NOT a booking.
    expect(mayTalkAsBooked({ bookedNow: false, upcoming: 0, toolsUsed: new Set(['check_availability', 'get_services']) })).toBe(false);
  });
  it('the safe line asks for name and phone, in the customer’s language', () => {
    expect(notBookedYetLine('en')).toMatch(/name and phone/);
    expect(notBookedYetLine('vi')).toMatch(/tên và số điện thoại/);
    expect(claimsBooked(notBookedYetLine('en'))).toBe(false);
    expect(claimsBooked(notBookedYetLine('vi'))).toBe(false);
  });
});

describe('inside the agent loop', () => {
  const mocked = chat as unknown as jest.Mock;
  const reply = (text: string) => ({ ok: true, reply: { stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: {} } });
  let prevKey: string | undefined;
  beforeAll(() => { prevKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'test-placeholder'; });
  afterAll(() => { if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey; });
  beforeEach(() => mocked.mockReset());

  function svc() {
    const prisma = {
      tenant: { findUnique: async () => ({ name: 'Zb Nails & Spa', timezone: 'America/Chicago', contactPhone: null, contactEmail: null, businessType: 'nail_salon', market: 'US' }) },
      setting: { findFirst: async () => null },
    };
    const settings = { getAiNotes: async () => ({ text: '' }) };
    const s = new MessengerService(prisma as never, {} as never, settings as never, {} as never, {} as never, {} as never);
    (s as unknown as { systemKnowledge: unknown }).systemKnowledge = async () => '';
    return s as unknown as { runAgent: (...a: unknown[]) => Promise<string> };
  }
  const hist = [
    { role: 'user', content: 'Hi, can I get a pedicure?' },
    { role: 'assistant', content: 'Perfect! When would you like to come in?' },
  ];

  it('a premature "booked in" is rewritten before the customer sees it', async () => {
    mocked
      .mockResolvedValueOnce(reply("Great — Monday at 11:00 AM is booked in. What's your first name?"))
      .mockResolvedValueOnce(reply("11:00 AM Monday works 👍 What's your first name?"));
    const out = await svc().runAgent('t1', '', hist, 'Monday 11am', { mode: 'booking', leadEmail: null, channel: 'instagram' });
    expect(out).toBe("11:00 AM Monday works 👍 What's your first name?");
    expect(mocked).toHaveBeenCalledTimes(2);
    const second = mocked.mock.calls[1][0] as { messages: { content: unknown }[] };
    expect(JSON.stringify(second.messages[second.messages.length - 1].content)).toContain('SYSTEM CORRECTION');
  });

  it('claiming it twice sends our own line asking for name and phone', async () => {
    mocked
      .mockResolvedValueOnce(reply("You're booked for Monday at 11!"))
      .mockResolvedValueOnce(reply("You're all set for Monday at 11!"));
    const out = await svc().runAgent('t1', '', hist, 'Monday 11am', { mode: 'booking', leadEmail: null, channel: 'instagram' });
    expect(out).toBe(notBookedYetLine('en'));
  });

  it('a customer with an appointment already on the calendar may hear "you’re all set"', async () => {
    mocked.mockResolvedValueOnce(reply("You're all set — see you Monday at 11!"));
    const out = await svc().runAgent('t1', '', hist, 'thanks!', {
      mode: 'booking', leadEmail: null, channel: 'instagram',
      known: { firstName: 'Lan', upcoming: [{ service: 'Pedicure', when: 'Mon 11:00 AM' }] },
    });
    expect(out).toContain("You're all set");
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('"plenty of slots" is sent back for concrete times', async () => {
    mocked
      .mockResolvedValueOnce(reply('Tomorrow (Monday) and Wednesday both have plenty of slots. What time works?'))
      .mockResolvedValueOnce(reply('Tomorrow I have 10:00 AM, 11:00 AM or 2:00 PM — which suits you?'));
    const out = await svc().runAgent('t1', '', hist, 'tomorrow or wednesday', { mode: 'booking', leadEmail: null, channel: 'instagram' });
    expect(out).toContain('10:00 AM');
  });

  // "Grand opening day" — the customer's answer to the recap — got the same
  // recap back, which the old duplicate filter then dropped: total silence.
  const recap = 'Just to confirm: basic pedicure and eyebrows, Friday October 9 at 1:00 PM for Delois Jones · 334-390-4874 — shall I book it?';
  const recapHist = [
    { role: 'user', content: 'Delois Jones 3343904874 when is your grand opening' },
    { role: 'assistant', content: recap, at: new Date().toISOString() },
  ];

  it('a word-for-word repeat goes back for a rewrite that answers the customer', async () => {
    mocked
      .mockResolvedValueOnce(reply(recap))
      .mockResolvedValueOnce(reply('Friday October 9 is our grand opening 🎉 — shall I book you in at 1:00 PM that day?'));
    const out = await svc().runAgent('t1', '', recapHist, 'Grand opening day', { mode: 'booking', leadEmail: null, channel: 'messenger' });
    expect(out).toMatch(/grand opening/);
    const second = mocked.mock.calls[1][0] as { messages: { content: unknown }[] };
    const correction = JSON.stringify(second.messages[second.messages.length - 1].content);
    expect(correction).toContain('word for word your previous message');
    expect(correction).toContain('Grand opening day');
  });

  it('repeating twice gets a clarifying question from us — never silence', async () => {
    mocked.mockResolvedValueOnce(reply(recap)).mockResolvedValueOnce(reply(recap));
    const out = await svc().runAgent('t1', '', recapHist, 'Grand opening day', { mode: 'booking', leadEmail: null, channel: 'messenger' });
    expect(out).toBe(notRepeatLine('en', recap));
    expect(out).not.toBe(recap);
    expect(out).toMatch(/book it/);
  });

  it('the clarifying line fits what was asked, in the customer’s language', () => {
    expect(notRepeatLine('vi', 'Dạ em xác nhận lại: … em đặt lịch luôn nhé?')).toMatch(/đặt lịch/);
    expect(notRepeatLine('en', 'What day works for you?')).toMatch(/tell me a little more/);
    expect(claimsBooked(notRepeatLine('en', recap))).toBe(false);
  });

  it('a recap that skips the customer’s question is rewritten: answer first, then the recap, in one message', async () => {
    mocked
      .mockResolvedValueOnce(reply('Just to confirm: basic pedicure and eyebrows, Friday October 9 at 1:00 PM for Delois Jones · 334-390-4874 — shall I book it?'))
      .mockResolvedValueOnce(reply('Our grand opening is Friday, October 9 🎉 Just to confirm: basic pedicure and eyebrows, Friday October 9 at 1:00 PM for Delois Jones · 334-390-4874 — shall I book it?'));
    const out = await svc().runAgent('t1', '', hist, 'Delois Jones 3343904874 when is your grand opening', { mode: 'booking', leadEmail: null, channel: 'messenger' });
    expect(out).toMatch(/^Our grand opening is/);
    expect(out).toMatch(/shall I book it\?$/);
    const second = mocked.mock.calls[1][0] as { messages: { content: unknown }[] };
    expect(JSON.stringify(second.messages[second.messages.length - 1].content)).toContain('when is your grand opening');
  });

  it('an answer followed by the recap goes straight through — no extra round-trip', async () => {
    mocked.mockResolvedValueOnce(reply('Our grand opening is Friday, October 9 🎉 Just to confirm: pedicure, Friday October 9 at 1:00 PM for Delois · 334-390-4874 — shall I book it?'));
    const out = await svc().runAgent('t1', '', hist, 'Delois 3343904874 when is your grand opening', { mode: 'booking', leadEmail: null, channel: 'messenger' });
    expect(out).toMatch(/shall I book it/);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('"any other questions?" is replaced by a step towards the booking', async () => {
    mocked
      .mockResolvedValueOnce(reply('Gel manicure is $44 💅 Any other questions?'))
      .mockResolvedValueOnce(reply('Gel manicure is $44 💅 What day would you like to come in?'));
    const out = await svc().runAgent('t1', '', hist, 'how much is a gel manicure', { mode: 'booking', leadEmail: null, channel: 'messenger' });
    expect(out).toBe('Gel manicure is $44 💅 What day would you like to come in?');
    const second = mocked.mock.calls[1][0] as { messages: { content: unknown }[] };
    expect(JSON.stringify(second.messages[second.messages.length - 1].content)).toContain('leads nowhere');
  });

  it('a customer who is not ready may still be told "message us any time" — no pushing', async () => {
    mocked.mockResolvedValueOnce(reply('No problem at all! Feel free to reach out whenever you are ready 😊'));
    const out = await svc().runAgent('t1', '', hist, 'not sure yet, I will let you know', { mode: 'booking', leadEmail: null, channel: 'messenger' });
    expect(out).toMatch(/whenever you are ready/);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('"can I come at 3pm?" may be answered with the recap — that IS the answer', async () => {
    mocked.mockResolvedValueOnce(reply('3:00 PM works 👍 Pedicure, Tuesday October 6 at 3:00 PM for Kim · 512-555-0147 — shall I book it?'));
    const out = await svc().runAgent('t1', '', hist, 'can I come at 3pm?', { mode: 'booking', leadEmail: null, channel: 'messenger' });
    expect(out).toMatch(/shall I book it/);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('the sales bot is untouched by the booking gates', async () => {
    mocked.mockResolvedValueOnce(reply("You're all set — our team will call you today."));
    const out = await svc().runAgent('t1', '', hist, 'ok', { mode: 'sales', leadEmail: null, channel: 'messenger' });
    expect(out).toContain("You're all set");
  });
});
