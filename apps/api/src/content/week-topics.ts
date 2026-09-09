import { bi, viOf, enOf, type Txt } from './i18n';
import type { PostType } from './industry-playbook';

/**
 * A subject for every post on the week, taken from the shop's own numbers.
 *
 * THE COMPLAINT THIS ANSWERS
 *
 * "Đăng clip 1 — Trả lời một câu khách hay hỏi" is a slot, not a subject. It
 * tells the person what KIND of post to make and leaves the only hard part —
 * which question, which design, which service — for them to think up at 7am
 * with a customer in the chair. That is how a week of five good slots becomes
 * a week of five posts about nothing in particular.
 *
 * WHERE A SUBJECT COMES FROM
 *
 * Not from imagination, and not from a model guessing. Every shop already
 * produces the answers: the service customers book most is in the bookings,
 * the one that earns most per chair-hour is in the price list, and the
 * question customers keep asking is sitting in the Messenger inbox, asked in
 * their own words. A subject read off those is one the shop can stand behind
 * — and it names a number, which is what makes a post read as professional
 * rather than as decoration.
 *
 * When a number is missing the subject says so in plain terms ("mẫu tiệm tự
 * chọn") rather than inventing one. A confident sentence about a made-up
 * figure is worse than a shorter honest one.
 */

export interface TopicData {
  /** Most booked service in the window, with its count. */
  mostBooked?: { name: string; count: number } | null;
  /** Fastest-rising service, when one is clearly rising. */
  rising?: { name: string; pct: number } | null;
  /** Highest earner per chair-hour, with the minutes it takes. */
  bestYield?: { name: string; minutes: number; perHourCents: number } | null;
  /** The question customers ask most, verbatim, from the inbox. */
  question?: { text: string; times: number } | null;
  /** Something the shop is proud of this week, when the team wrote one. */
  spotlight?: string | null;
}

/** What a post is about, in each language — the part after the dash. */
export interface Topic {
  subject: Txt;
  /** Which of the playbook's angles this is. */
  angle: Angle;
  /** The thing itself — a service name or the customer's question — for a hook. */
  name?: string | null;
  /** The one figure behind it, for the caption. Null when it rests on none. */
  figure?: { kind: 'bookings' | 'minutes' | 'asked' | 'rising'; value: number } | null;
}

/** Which of the playbook's post types this is — matched on the label's sense, not its index. */
export type Angle = 'most-booked' | 'process' | 'before-after' | 'tech' | 'question' | 'other';

const trim = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);


export function angleOf(pt: Pick<PostType, 'label'>): Angle {
  const s = `${viOf(pt.label)} ${enOf(pt.label)}`.toLowerCase();
  if (/đặt nhiều|booking most|gọi nhiều|ordered most|đặt nhất|popular|bán chạy|best[- ]sell/.test(s)) return 'most-booked';
  if (/hay hỏi|keep asking|câu hỏi|question/.test(s)) return 'question';
  if (/quy trình|process|cận cảnh|up close|behind|hậu trường/.test(s)) return 'process';
  if (/trước và sau|before and after|phản ứng|reaction|transformation/.test(s)) return 'before-after';
  if (/người thợ|the tech|người làm|the person|đội ngũ|team/.test(s)) return 'tech';
  return 'other';
}

/**
 * The subject for one post type.
 *
 * Each angle has one data source it is honest about, and a plain fallback
 * that says the shop chooses. The fallback is deliberately less specific —
 * the gap is the reason to go and get the number.
 */
export function topicFor(pt: Pick<PostType, 'label'>, d: TopicData): Topic {
  const angle = angleOf(pt);
  switch (angle) {
    case 'most-booked': {
      if (d.rising && d.rising.pct >= 30 && (!d.mostBooked || d.rising.name !== d.mostBooked.name)) {
        return {
          subject: bi(`${d.rising.name} — đang tăng ${d.rising.pct}% so với tháng trước`,
            `${d.rising.name} — up ${d.rising.pct}% on last month`),
          angle, name: d.rising.name,
          figure: { kind: 'rising', value: d.rising.pct },
        };
      }
      if (d.mostBooked && d.mostBooked.count >= 3) {
        return {
          subject: bi(`${d.mostBooked.name} — mẫu được đặt nhiều nhất tháng này (${d.mostBooked.count} lượt)`,
            `${d.mostBooked.name} — this month's most-booked (${d.mostBooked.count} bookings)`),
          angle, name: d.mostBooked.name,
          figure: { kind: 'bookings', value: d.mostBooked.count },
        };
      }
      return { subject: bi('Mẫu khách đang chọn nhiều nhất — tiệm tự chọn', 'The design customers pick most — shop\'s choice'), angle, figure: null };
    }
    case 'process': {
      if (d.bestYield && d.bestYield.minutes > 0) {
        return {
          subject: bi(`${d.bestYield.name} trong ${d.bestYield.minutes} phút — ${viOf(pt.label).toLowerCase()}`,
            `${d.bestYield.name} in ${d.bestYield.minutes} minutes — ${enOf(pt.label).toLowerCase()}`),
          angle, name: d.bestYield.name,
          figure: { kind: 'minutes', value: d.bestYield.minutes },
        };
      }
      return { subject: pt.label, angle, figure: null };
    }
    case 'question': {
      if (d.question && d.question.text.trim()) {
        const q = trim(d.question.text.trim().replace(/\s+/g, ' '));
        return {
          subject: bi(`"${q}" — câu khách hỏi nhiều nhất trong inbox`,
            `"${q}" — the question customers ask most`),
          angle, name: q,
          figure: { kind: 'asked', value: d.question.times },
        };
      }
      const svc = d.mostBooked?.name ?? d.bestYield?.name ?? null;
      return {
        subject: svc
          ? bi(`"${svc} giữ được bao lâu?" — câu khách hay hỏi trước khi đặt`, `"How long does ${svc} last?" — what customers ask before booking`)
          : pt.label,
        angle, name: svc ? `${svc} giữ được bao lâu?` : null,
        figure: null,
      };
    }
    // The playbook's own label is the fallback for every trade-specific angle:
    // a restaurant's "the cook and the kitchen" must never come back as a
    // sentence about nails because the fallback was written with a salon in
    // mind. The data, when there is any, is what makes it specific.
    case 'before-after':
      return {
        subject: d.mostBooked
          ? bi(`${viOf(pt.label)} — ${d.mostBooked.name}`, `${enOf(pt.label)} — ${d.mostBooked.name}`)
          : pt.label,
        angle, name: d.mostBooked?.name ?? null,
        figure: null,
      };
    case 'tech':
      return {
        subject: d.spotlight?.trim()
          ? bi(`${viOf(pt.label)} — ${trim(d.spotlight.trim())}`, `${enOf(pt.label)} — ${trim(d.spotlight.trim())}`)
          : pt.label,
        angle, name: d.spotlight?.trim() || null,
        figure: null,
      };
    default:
      return { subject: pt.label, angle, figure: null };
  }
}

// ---- the question customers keep asking ------------------------------------------

/** One turn of a Messenger thread, as stored. */
export interface TurnLike { role?: string; content?: unknown }

const QUESTION_WORDS = /\b(how|what|when|where|which|do you|can i|can you|is it|are you|does|bao nhiêu|có .*không|khi nào|ở đâu|làm sao|thế nào|mấy giờ|giá)\b/i;

/** Lower-case, no punctuation, no doubled spaces — so two phrasings of one question meet. */
function normQ(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The questions customers actually asked, most frequent first.
 *
 * Read off the customer's own turns: a sentence ending in "?" or opening with
 * a question word. Greetings, one-word replies and anything too long to be a
 * question are dropped; the rest is grouped on a normalised form so "How much
 * for dip?" and "how much for dip" are one question, asked twice.
 */
export function topQuestions(histories: TurnLike[][], limit = 3): { text: string; times: number }[] {
  const seen = new Map<string, { text: string; times: number }>();
  for (const h of histories ?? []) {
    for (const t of h ?? []) {
      if (t?.role !== 'user' || typeof t.content !== 'string') continue;
      const raw = t.content.trim();
      if (raw.length < 12 || raw.length > 140) continue;
      const isQ = raw.endsWith('?') || QUESTION_WORDS.test(raw);
      if (!isQ) continue;
      const key = normQ(raw);
      if (key.split(' ').length < 3) continue;
      const cur = seen.get(key);
      if (cur) cur.times += 1;
      else seen.set(key, { text: raw, times: 1 });
    }
  }
  return [...seen.values()].sort((a, b) => b.times - a.times || a.text.localeCompare(b.text)).slice(0, limit);
}
