/**
 * HOW THE BOT IS DOING — phase 2 of "the bot learns over time".
 *
 * The owner cannot improve what nobody measures. Per salon, per period:
 *   - conversations, and how many ended in a booking;
 *   - WHERE the others stopped: after the bot offered times, after it asked
 *     for name + phone, after the recap ("shall I book it?"), or the bot never
 *     answered at all — each points at a different fix;
 *   - how long a booking took from the first message;
 *   - questions the bot could not answer (phase 1);
 *   - per channel.
 * And two or three plain-language next steps drawn from those numbers.
 *
 * Pure: the service feeds this one salon's rows in.
 */
import { nudgeKindFor, type StoredTurn } from './followup';

export interface ReportThread {
  id: string; channel: string; handoff: boolean; customerId: string | null;
  lastMessageAt: Date | null; history: StoredTurn[];
}
export interface ReportBooking { customerId: string; createdAt: Date }

export type Stop = 'time' | 'contact' | 'confirm' | 'general' | 'noReply' | 'human';

export interface BotReport {
  from: string; to: string;
  conversations: number;
  booked: number;
  bookingRate: number | null;
  medianMinutesToBook: number | null;
  stoppedAt: Record<Stop, number>;
  byChannel: Record<string, { conversations: number; booked: number }>;
  unanswered: { open: number; newInPeriod: number };
  tips: { vi: string; en: string }[];
}

const MIN = 60_000;
const at = (t: StoredTurn) => (t.at ? new Date(t.at).getTime() : NaN);
const text = (t: StoredTurn) => (typeof t.content === 'string' ? t.content : '');

export function botReport(o: {
  threads: ReportThread[]; bookings: ReportBooking[];
  gapsOpen: number; gapsNew: number; from: Date; to: Date;
}): BotReport {
  const f = o.from.getTime(); const t = o.to.getTime();
  const byCustomer = new Map<string, number[]>();
  for (const b of o.bookings) byCustomer.set(b.customerId, [...(byCustomer.get(b.customerId) ?? []), b.createdAt.getTime()]);

  const stoppedAt: Record<Stop, number> = { time: 0, contact: 0, confirm: 0, general: 0, noReply: 0, human: 0 };
  const byChannel: Record<string, { conversations: number; booked: number }> = {};
  const minutes: number[] = [];
  let conversations = 0; let booked = 0;

  for (const th of o.threads) {
    const turns = Array.isArray(th.history) ? th.history : [];
    // The customer wrote in the period — that is a conversation of this period.
    const mine = turns.filter((x) => x.role === 'user' && at(x) >= f && at(x) < t);
    if (!mine.length) continue;
    conversations++;
    const ch = th.channel || 'messenger';
    byChannel[ch] = byChannel[ch] ?? { conversations: 0, booked: 0 };
    byChannel[ch].conversations++;
    const firstAsk = Math.min(...mine.map(at));
    const end = Math.max(t, (th.lastMessageAt?.getTime() ?? t)) + 24 * 60 * MIN;
    const made = th.customerId ? (byCustomer.get(th.customerId) ?? []).filter((x) => x >= firstAsk - 5 * MIN && x <= end) : [];
    if (made.length) {
      booked++; byChannel[ch].booked++;
      minutes.push(Math.max(0, Math.round((Math.min(...made) - firstAsk) / MIN)));
      continue;
    }
    if (th.handoff) { stoppedAt.human++; continue; }
    const lastBot = [...turns].reverse().find((x) => x.role === 'assistant' && !x.nudge && !x.manual);
    const lastUser = [...turns].reverse().find((x) => x.role === 'user');
    if (!lastBot || (lastUser && at(lastUser) > at(lastBot))) { stoppedAt.noReply++; continue; }
    stoppedAt[nudgeKindFor(text(lastBot))]++;
  }

  minutes.sort((a, b) => a - b);
  const median = minutes.length ? minutes[Math.floor((minutes.length - 1) / 2)] : null;
  const rate = conversations ? booked / conversations : null;
  return {
    from: o.from.toISOString(), to: o.to.toISOString(),
    conversations, booked, bookingRate: rate, medianMinutesToBook: median,
    stoppedAt, byChannel,
    unanswered: { open: o.gapsOpen, newInPeriod: o.gapsNew },
    tips: tipsFor({ conversations, rate, stoppedAt, gapsOpen: o.gapsOpen }),
  };
}

/** Two or three next steps, from the numbers — the biggest leak first. */
export function tipsFor(o: { conversations: number; rate: number | null; stoppedAt: Record<Stop, number>; gapsOpen: number }): { vi: string; en: string }[] {
  const tips: { vi: string; en: string; weight: number }[] = [];
  const s = o.stoppedAt;
  if (o.gapsOpen > 0) tips.push({ weight: 50 + o.gapsOpen, vi: `Trả lời ${o.gapsOpen} câu bot chưa biết ở mục "Câu hỏi bot chưa trả lời được" — mỗi câu trả lời một lần là bot dùng mãi.`, en: `Answer the ${o.gapsOpen} question(s) the bot could not — each answer is used from then on.` });
  if (s.contact >= 2) tips.push({ weight: s.contact * 5, vi: `${s.contact} khách dừng ở bước để lại tên + SĐT. Bật "Follow-up khách im lặng" để bot nhắc lại một lần.`, en: `${s.contact} customers stopped when asked for name + phone. Turn on the quiet-chat follow-up so the bot asks once more.` });
  if (s.confirm >= 2) tips.push({ weight: s.confirm * 6, vi: `${s.confirm} khách đã được tóm tắt lịch nhưng chưa trả lời "ok". Follow-up sẽ hỏi lại đúng câu xác nhận.`, en: `${s.confirm} customers got the recap but never said yes. The follow-up asks for exactly that confirmation.` });
  if (s.time >= 2) tips.push({ weight: s.time * 3, vi: `${s.time} khách dừng sau khi bot đưa giờ. Kiểm tra giờ làm và số thợ nhận lịch online — có thể giờ trống quá ít.`, en: `${s.time} customers stopped after being offered times. Check hours and how many techs take online bookings — there may be too few open slots.` });
  if (s.noReply >= 2) tips.push({ weight: s.noReply * 6, vi: `${s.noReply} cuộc trò chuyện khách nhắn cuối mà chưa được trả lời. Kiểm tra bot đang bật và kết nối kênh còn hoạt động.`, en: `${s.noReply} conversations ended on an unanswered customer message. Check the bot is on and the channel is still connected.` });
  if (o.conversations >= 10 && o.rate !== null && o.rate < 0.15) tips.push({ weight: 20, vi: 'Tỉ lệ chốt lịch thấp. Thêm thông tin cho bot (giá, khuyến mãi, chỗ đậu xe…) để bot trả lời đúng ngay từ câu đầu.', en: 'Low booking rate. Give the bot more facts (prices, offers, parking…) so it answers right from the first message.' });
  return tips.sort((a, b) => b.weight - a.weight).slice(0, 3).map(({ vi, en }) => ({ vi, en }));
}
