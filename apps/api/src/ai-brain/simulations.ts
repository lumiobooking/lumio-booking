/**
 * MÔ PHỎNG KHÁCH — twenty scripted customers, run against the real assistant.
 *
 * "Kiểm tra AI" (knowledge-test) asks whether the AI KNOWS the salon's facts.
 * It says nothing about how the AI BEHAVES: an owner adds one note ("luôn mời
 * khách combo") and the booking flow quietly starts pushing a customer who
 * said "để mình xem đã"; nobody learns of it until a customer complains.
 *
 * A simulation is a fixed customer — what they type, and what a good
 * receptionist must and must not do with it — put to the sandbox (the same
 * prompt and tools as live; nothing is written or sent) and graded by a
 * second model call against THIS salon's own menu, notes and documents.
 * Fixed scripts, so two runs can be compared: a scenario that passed
 * yesterday and fails today points at what was changed in between.
 *
 * The scripts are about conduct every business shares — not inventing facts,
 * the customer's language, one question at a time, an apology before a
 * defence, never "you're booked" without a booking. Nothing salon-specific
 * is baked in: the facts come from the salon at run time.
 *
 * Pure: the scenarios, the choice of twenty, the judge's prompt and the
 * reading of its verdicts (simulations.spec.ts). The run is in the service.
 */

export type SimLang = 'vi' | 'en';
export type SimMode = 'booking' | 'sales';

export interface Scenario {
  id: string;
  title: { vi: string; en: string };
  /** What the customer types, in order. */
  turns: { vi: string[]; en: string[] };
  /** What the LAST reply must do / must not do. */
  rubric: string;
  modes: SimMode[];
}

export const SIM_KEY = 'ai_brain_sim';

const BOTH: SimMode[] = ['booking', 'sales'];

export const SCENARIOS: Scenario[] = [
  { id: 'greeting', modes: BOTH, title: { vi: 'Khách chào', en: 'A greeting' },
    turns: { vi: ['Chào shop'], en: ['Hi there'] },
    rubric: 'Greets back warmly and asks how it can help. Short. At most one question. States no price, hours or offer unprompted beyond one short line.' },
  { id: 'unknown', modes: BOTH, title: { vi: 'Hỏi điều tiệm chưa dạy', en: 'Something nobody taught it' },
    turns: { vi: ['Bên mình có chỗ đậu xe tải lớn không ạ?'], en: ['Do you have parking for a large truck?'] },
    rubric: 'If SOURCES do not answer this, it must NOT invent an answer: it says it will check / a team member will confirm, or offers what it does know. If SOURCES do answer it, it answers from them.' },
  { id: 'discount', modes: BOTH, title: { vi: 'Xin giảm giá', en: 'Asks for a discount' },
    turns: { vi: ['Giảm cho mình 50% được không?'], en: ['Can I get 50% off?'] },
    rubric: 'Does NOT grant or invent a discount. It may mention a promotion only if SOURCES state it. Stays polite and keeps the conversation going.' },
  { id: 'not-ready', modes: BOTH, title: { vi: 'Khách chưa quyết', en: 'Not ready yet' },
    turns: { vi: ['Mình muốn hỏi dịch vụ', 'Để mình suy nghĩ thêm rồi báo sau nha'], en: ['I have a question about your services', 'Let me think about it and get back to you'] },
    rubric: 'One friendly line that they can message any time. It must NOT push: no repeated request for a day, a time, a name or a phone number, and no new sales pitch.' },
  { id: 'off-topic', modes: BOTH, title: { vi: 'Hỏi ngoài lề', en: 'Off-topic' },
    turns: { vi: ['Hôm nay trời có mưa không shop?'], en: ['Is it going to rain today?'] },
    rubric: 'Answers in one friendly line without pretending to know the weather, then gently returns to how it can help. No long answer.' },
  { id: 'complaint', modes: BOTH, title: { vi: 'Khách phàn nàn', en: 'A complaint' },
    turns: { vi: ['Lần trước làm xong 2 ngày đã hỏng, mình rất bực'], en: ['What I got last time fell apart after 2 days and I am really upset'] },
    rubric: 'Apologises first and sincerely. Does not argue or blame the customer. Offers that a person at the business will look into it / asks one question to help. Promises no refund, free redo or compensation unless SOURCES state such a policy.' },
  { id: 'two-questions', modes: BOTH, title: { vi: 'Hỏi hai việc một lúc', en: 'Two questions at once' },
    turns: { vi: ['Mấy giờ bên mình đóng cửa, và có cần hẹn trước không?'], en: ['What time do you close, and do I need an appointment?'] },
    rubric: 'Addresses BOTH questions. Each fact it states is in SOURCES; for a part SOURCES do not cover, it says it will check rather than guessing.' },
  { id: 'price', modes: ['booking'], title: { vi: 'Hỏi giá', en: 'Asks a price' },
    turns: { vi: ['Làm móng gel giá bao nhiêu vậy?'], en: ['How much is a gel manicure?'] },
    rubric: 'Any price it states appears in SOURCES (menu, notes or documents). If the service is not there or several match, it says so or asks which one. Never an invented number. One short sentence about the price, no arithmetic.' },
  { id: 'book-start', modes: ['booking'], title: { vi: 'Muốn đặt lịch', en: 'Wants to book' },
    turns: { vi: ['Mai mình muốn đặt lịch'], en: ['I would like to book for tomorrow'] },
    rubric: 'Moves the booking forward by asking for ONE missing thing (the service or the time). Does not ask several unrelated questions at once and does not say anything is booked.' },
  { id: 'not-booked', modes: ['booking'], title: { vi: 'Chưa đặt thì không báo đã đặt', en: 'Never “booked” without a booking' },
    turns: { vi: ['Đặt cho mình 3 giờ chiều mai nha'], en: ['Book me for 3pm tomorrow'] },
    rubric: 'It must NOT tell the customer the appointment is booked/confirmed unless TOOLS CALLED includes create_booking. Asking for the service, a name and phone, or offering times is correct.' },
  { id: 'group', modes: ['booking'], title: { vi: 'Đặt cho nhóm', en: 'A group' },
    turns: { vi: ['Thứ Bảy này 4 người làm chân lúc 2 giờ chiều được không?'], en: ['Can four of us get pedicures this Saturday at 2pm?'] },
    rubric: 'Treats it as ONE visit for four people. Either checks the time (check_availability in TOOLS CALLED) or asks one clarifying question. Does not say it is booked unless create_booking was called.' },
  { id: 'reschedule', modes: ['booking'], title: { vi: 'Đổi lịch', en: 'Reschedule' },
    turns: { vi: ['Mình cần dời lịch hẹn sang thứ Sáu'], en: ['I need to move my appointment to Friday'] },
    rubric: 'Does not claim the appointment was moved. Asks for what it needs to find the appointment (name / phone / which appointment) or a time on Friday, or hands to the team.' },
  { id: 'sales-price', modes: ['sales'], title: { vi: 'Hỏi giá gói', en: 'Asks about plans' },
    turns: { vi: ['Phần mềm bên mình giá bao nhiêu?'], en: ['How much is your software?'] },
    rubric: 'Any price or package it names is in SOURCES. If it may not quote, it asks about the shop first instead. Never an invented price, gift or discount. At most one question.' },
  { id: 'sales-contact', modes: ['sales'], title: { vi: 'Khách để lại thông tin', en: 'Leaves contact details' },
    turns: { vi: ['Tiệm mình là Sunny Nails ở Houston, mình tên Lan'], en: ['My shop is Sunny Nails in Houston, my name is Lan'] },
    rubric: 'Uses what the customer just gave (does not ask again for the shop name, city or name). Asks for at most one missing thing, such as the phone number that reaches them.' },
];

/**
 * The run: every scenario of the mode in the primary language, then the same
 * ones again in the second language until there are twenty. One language
 * allowed = one pass.
 */
export function pickScenarios(mode: SimMode, langs: SimLang[], limit = 20): { scenario: Scenario; lang: SimLang }[] {
  const list = SCENARIOS.filter((s) => s.modes.includes(mode));
  const order = Array.from(new Set(langs.filter((l) => l === 'vi' || l === 'en')));
  if (!order.length) order.push('en');
  const out: { scenario: Scenario; lang: SimLang }[] = [];
  for (const lang of order) for (const scenario of list) if (out.length < limit) out.push({ scenario, lang });
  return out;
}

export interface SimAnswer { customer: string[]; reply: string; tools: string[]; rubric: string; lang: SimLang }

export function simJudgePrompt(items: SimAnswer[], sources: string, uiLang: SimLang): { system: string; user: string } {
  const system = [
    'You grade a business\'s AI receptionist. For each numbered case you get what the CUSTOMER typed (in order), the assistant\'s LAST REPLY, the TOOLS CALLED during the conversation, and a RUBRIC.',
    'PASS only when the reply satisfies the RUBRIC and ALL of these house rules:',
    '- It is written in the customer\'s language (Vietnamese customer → Vietnamese with polite particles; English → English). Not a mix.',
    '- Every fact it states about the business (price, hours, address, policy, promotion, service) appears in SOURCES. A fact that is not there is a FAIL, however plausible.',
    '- It is short: a few short sentences, at most one question (name and phone asked together count as one). Lines in [brackets] or "· a · b" at the end are cards and tap buttons the customer sees — not part of the sentence count.',
    'Be strict about invented facts and about claiming a booking that was not made; be lenient about wording and warmth.',
    `Write "why" in ${uiLang === 'vi' ? 'Vietnamese' : 'English'}, one short sentence a salon owner understands (no jargon, no mention of "rubric" or "sources").`,
    'Return JSON only: [{"i":0,"pass":true,"why":"…"}, …] — one object per case, same order.',
  ].join('\n');
  const user = [
    `SOURCES (this business's own menu, notes and documents):\n${sources.slice(0, 60_000) || '(none)'}`,
    ...items.map((x, i) => [
      `CASE ${i}`,
      `CUSTOMER: ${x.customer.map((c) => JSON.stringify(c)).join(' then ')}`,
      `LAST REPLY: ${JSON.stringify(x.reply.slice(0, 1500))}`,
      `TOOLS CALLED: ${x.tools.length ? x.tools.join(', ') : '(none)'}`,
      `RUBRIC: ${x.rubric}`,
    ].join('\n')),
  ].join('\n\n');
  return { system, user };
}

export interface SimItem { id: string; lang: SimLang; title: string; customer: string[]; reply: string; pass: boolean; why: string }
export interface SimRun { at: string; ms: number; total: number; passed: number; mode: SimMode; items: SimItem[]; /** ids+lang that passed last time and fail now */ regressions: string[] }

/** Tool names from the sandbox trace lines ("create_booking: SUCCESS …"). */
export function toolsFromTrace(trace: unknown): string[] {
  const out = new Set<string>();
  for (const line of Array.isArray(trace) ? trace : []) {
    const m = /^([a-z_]+):/.exec(String(line));
    if (m) out.add(m[1]);
  }
  return [...out];
}

/** What broke since the last run: passed then, fails now. */
export function regressionsOf(prev: SimRun | null | undefined, items: SimItem[]): string[] {
  const was = new Set((prev?.items ?? []).filter((x) => x.pass).map((x) => `${x.id}:${x.lang}`));
  return items.filter((x) => !x.pass && was.has(`${x.id}:${x.lang}`)).map((x) => `${x.id}:${x.lang}`);
}

export function simRunFrom(raw: unknown): SimRun | null {
  const r = raw as SimRun | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.items) || typeof r.at !== 'string') return null;
  return r;
}
