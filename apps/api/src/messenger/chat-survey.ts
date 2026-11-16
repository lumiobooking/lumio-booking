/**
 * KHẢO SÁT MỘT CHẠM — one question after the AI books a visit in chat.
 *
 * The bot report could count bookings, but not whether the customer liked
 * being served by the AI. Right after a booking made in the conversation the
 * salon may now ask ONE question with three tap answers:
 *
 *   "Trải nghiệm đặt lịch thế nào ạ?"   Hài lòng · Bình thường · Chưa ổn
 *
 * Rules that keep it from becoming a nuisance:
 *   - OFF until the salon switches it on (setting `chat_survey`, per salon);
 *   - only after a booking the AI made in this chat, never after a question;
 *   - at most once per conversation every 30 days;
 *   - the tap is answered with one thank-you line and no model call; "Chưa ổn"
 *     also wakes the salon's phones, and the customer is asked what went wrong
 *     (their answer goes to the AI / staff like any other message);
 *   - an answer only counts within 24 hours of the question, and only when it
 *     is exactly one of the three buttons — "bình thường thôi, mà mai mấy giờ
 *     mở cửa?" is a message, not a rating.
 *
 * Stored on the turns of the salon's own thread (`survey: 'ask'` on the
 * question, the rating on the customer's answer) — no new table, and the
 * report reads the same rows it already reads. The buttons are in the
 * customer's words: nobody is made to call themselves "em".
 *
 * Pure: no database, no clock (chat-survey.spec.ts).
 */

export const SURVEY_KEY = 'chat_survey';
export type SurveyRating = 'good' | 'ok' | 'bad';
export interface SurveyTurn { role: 'user' | 'assistant'; content?: unknown; at?: string | null; survey?: 'ask' | SurveyRating; nudge?: boolean; manual?: boolean }

const ASK_AGAIN_MS = 30 * 86_400_000;
const ANSWER_WITHIN_MS = 24 * 3_600_000;

export function surveySettingFrom(raw: unknown): { on: boolean } {
  let v: unknown = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  return { on: Boolean((v as { on?: unknown } | null)?.on === true) };
}

const CHOICES: Record<'vi' | 'en', [string, string, string]> = {
  vi: ['Hài lòng', 'Bình thường', 'Chưa ổn'],
  en: ['Great', 'Okay', 'Not good'],
};

export function surveyAsk(vi: boolean): { text: string; choices: string[] } {
  return vi
    ? { text: 'Trải nghiệm đặt lịch thế nào ạ?', choices: [...CHOICES.vi] }
    : { text: 'How was booking with us?', choices: [...CHOICES.en] };
}

const fold = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Exactly one of the buttons (either language), nothing more. */
export function surveyAnswer(text: string): SurveyRating | null {
  const t = fold(text);
  if (!t) return null;
  const order: SurveyRating[] = ['good', 'ok', 'bad'];
  for (const l of ['vi', 'en'] as const) {
    const i = CHOICES[l].findIndex((c) => fold(c) === t);
    if (i >= 0) return order[i];
  }
  return null;
}

const ms = (t: SurveyTurn) => (t.at ? new Date(t.at).getTime() : NaN);

/** Is the question still open: asked last by us, within a day, not yet rated? `prior` = the thread before the incoming message. */
export function surveyPending(prior: SurveyTurn[], nowMs: number): boolean {
  for (let i = prior.length - 1; i >= 0; i--) {
    const t = prior[i];
    if (t.role === 'user') return false; // they wrote something else since: the moment has passed
    if (t.role === 'assistant' && t.survey === 'ask') return Number.isFinite(ms(t)) && nowMs - ms(t) <= ANSWER_WITHIN_MS;
    if (t.role === 'assistant' && !t.nudge) return false;
  }
  return false;
}

/** May we ask now? Only when switched on, a booking was just made here, and not asked in the last 30 days. */
export function shouldAskSurvey(o: { on: boolean; booked: boolean; history: SurveyTurn[]; nowMs: number }): boolean {
  if (!o.on || !o.booked) return false;
  return !o.history.some((t) => t.role === 'assistant' && t.survey === 'ask' && Number.isFinite(ms(t)) && o.nowMs - ms(t) < ASK_AGAIN_MS);
}

export function surveyThanks(r: SurveyRating, vi: boolean): string {
  if (r === 'bad') return vi
    ? 'Dạ em xin lỗi anh/chị ạ. Anh/chị cho em biết điều gì chưa ổn để tiệm khắc phục ngay nhé?'
    : 'I am sorry about that. Could you tell us what went wrong so we can fix it?';
  return vi ? 'Dạ em cảm ơn anh/chị ạ. Hẹn gặp anh/chị tại tiệm!' : 'Thank you! See you at the salon.';
}

export function surveyBadPush(name: string | null | undefined, vi: boolean): { title: string; body: string; url: string; tag: string } {
  const who = String(name ?? '').trim() || (vi ? 'Khách' : 'A customer');
  return {
    title: vi ? `${who} chọn “Chưa ổn” sau khi đặt lịch` : `${who} answered “Not good” after booking`,
    body: vi ? 'AI đã hỏi lại khách điều gì chưa ổn. Vào Hộp thư xem và trả lời khách nhé.' : 'The AI asked what went wrong. Open the Inbox and reply.',
    url: '/staff/inbox',
    tag: 'lumio-inbox-survey',
  };
}

export interface SurveyStats { asked: number; answered: number; good: number; ok: number; bad: number; /** good / answered */ happyRate: number | null }

/** One salon's threads, one period: the questions asked in it and the ratings given in it. */
export function surveyStats(threads: { history: SurveyTurn[] }[], fromMs: number, toMs: number): SurveyStats {
  const s: SurveyStats = { asked: 0, answered: 0, good: 0, ok: 0, bad: 0, happyRate: null };
  for (const th of threads) {
    for (const t of Array.isArray(th.history) ? th.history : []) {
      const at = ms(t);
      if (!t.survey || !(at >= fromMs && at < toMs)) continue;
      if (t.role === 'assistant' && t.survey === 'ask') s.asked++;
      else if (t.role === 'user' && (t.survey === 'good' || t.survey === 'ok' || t.survey === 'bad')) { s.answered++; s[t.survey]++; }
    }
  }
  s.happyRate = s.answered ? s.good / s.answered : null;
  return s;
}
