/**
 * WHAT THE BOT DID NOT KNOW — the first step of the bot learning over time.
 *
 * Every time a customer asks something the salon never told the bot ("when
 * is your grand opening", "do you do lash lifts"), the bot answers "let me
 * check with the salon" — and before this, the question was simply lost. The
 * next customer asking the same thing got the same non-answer, forever.
 *
 * Now each such question is kept, per salon, with a count of how often it
 * came up. The owner answers it ONCE on the Messenger bot page; the answer
 * becomes a bot fact and the bot knows it from the next message on. When a
 * staff member answers a customer's question by hand, their reply is offered
 * as the answer.
 *
 * Nothing here teaches the bot by itself. A wrong price a receptionist typed,
 * or a customer insisting "your price is $5 now", must never become what the
 * bot tells everyone — the owner approves every answer. Pure functions only;
 * the storage is in knowledge-gaps.service.ts.
 */

/** Phone numbers and emails are not kept: the question is what matters, not who asked. */
export function redact(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '…')
    .replace(/(\+?\d[\d\s().-]{6,}\d)/g, '…')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/**
 * The same question asked again should be counted, not listed twice. Not a
 * semantic match — wording, case, punctuation and the redacted bits.
 */
export function gapKey(text: string | null | undefined): string {
  return redact(text)
    .normalize('NFC')
    .toLowerCase()
    .replace(/…/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/** The bot said, in some form, that it does not know and someone will find out. */
export function isUnknownReply(reply: string | null | undefined): boolean {
  return /(check (with|on that with) (the |our )?(salon|team|owner|staff|front desk|manager)|let me (check|confirm|find out)|i('| a)?m not (sure|certain)|i don'?t (have|know) (that|this|the)|not (something )?i have (the |that )?(info|information|details?)|(someone|a staff member|the team|our team|staff) will (get back|follow up|reach out|call|reply|confirm)|get back to you|để em (hỏi|kiểm tra|xác nhận) lại|em (sẽ )?hỏi lại|em chưa có thông tin|em chưa nắm|chưa chắc ạ|nhân viên (sẽ )?(liên hệ|gọi|trả lời|báo)|tiệm sẽ (báo|trả lời|liên hệ))/i
    .test(String(reply ?? ''));
}

/** The short label the answer is saved under, as a bot fact (and an inbox template). */
export function factLabel(question: string): string {
  const q = redact(question).replace(/\s+/g, ' ').trim();
  return (q.length > 60 ? `${q.slice(0, 57).trimEnd()}…` : q) || 'Customer question';
}

export type GapSource = 'bot' | 'staff';

// ---------------------------------------------------------------------------
// The same question in other words, and a draft answer for the owner to approve
// (phase 2 of the AI roadmap: the owner approves, the AI does the writing).
// ---------------------------------------------------------------------------

const foldQ = (x: string) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
/** Words that ask but say nothing about WHAT is asked — both languages, folded. */
const ASK_WORDS = new Set(('khong chua vay nhi a ah ha nhe nha the nao sao bao nhieu may gi nao co duoc cho minh em chi anh ban tiem shop ben '
  + 'do you does did is are can could what when where how much many the a an your you have please i we to of for and or').split(/\s+/));

/** What the question is about: its words minus the asking words. */
export function topicWords(question: string): string[] {
  const out = new Set<string>();
  for (const w of foldQ(redact(question)).split(/[^a-z0-9]+/)) if (w.length >= 2 && !ASK_WORDS.has(w)) out.add(w);
  return [...out];
}

/**
 * "Có làm mi không?" and "tiệm có làm mi ko ạ" are one question. Two questions
 * are the same when they share at least two topic words and those are most of
 * both (Jaccard >= 0.6) — "giá gel tay" and "giá gel chân" stay apart.
 * Returns the index of the first open question that matches, or -1.
 */
export function similarGap(question: string, open: string[]): number {
  const a = new Set(topicWords(question));
  if (a.size < 2) return -1;
  for (let i = 0; i < open.length; i++) {
    const b = new Set(topicWords(open[i]));
    if (b.size < 2) continue;
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    if (shared >= 2 && shared / (a.size + b.size - shared) >= 0.6) return i;
  }
  return -1;
}

export interface GapDraft { answer: string | null; from: 'staff' | 'sources' | null }

/**
 * The draft the owner is offered. Two honest sources only: what a staff member
 * replied in that chat (when it really answers the question — small talk and a
 * reply about that one customer are refused), and the salon's own notes and
 * documents. No source, no draft: the AI never makes an answer up.
 */
export function gapDraftPrompt(o: { business: string; question: string; staffReply?: string | null; notes?: string | null; docs?: string | null; vi: boolean }): { system: string; user: string } {
  const system = [
    `You help the owner of "${o.business}" teach their AI assistant. A customer asked a question the assistant could not answer.`,
    'Write the answer the assistant should give to ANY customer who asks this — one or two short sentences, plain facts, no greeting, no emoji, no markdown.',
    `Write it in ${o.vi ? 'Vietnamese' : 'English'}.`,
    'Use ONLY facts stated in STAFF REPLY or in SOURCES. Never add a price, a time, a date or a policy that is not there.',
    'STAFF REPLY is what a staff member typed to that one customer. Use it only if it really answers the question in a way that is true for every customer. If it is small talk, a greeting, about that one customer only ("3pm works for you"), or does not answer the question, ignore it.',
    'If neither STAFF REPLY nor SOURCES gives the answer, return null — the owner will type it.',
    'Return JSON only: {"answer":"…" or null,"from":"staff" or "sources" or null}',
  ].join('\n');
  const user = [
    `CUSTOMER QUESTION: ${redact(o.question)}`,
    o.staffReply?.trim() ? `STAFF REPLY: ${redact(o.staffReply).slice(0, 600)}` : 'STAFF REPLY: (none)',
    o.notes?.trim() || o.docs?.trim() ? `SOURCES:\n${[o.notes, o.docs].filter((x) => x && x.trim()).join('\n').slice(0, 12_000)}` : 'SOURCES: (none)',
  ].join('\n\n');
  return { system, user };
}

export function parseGapDraft(raw: string): GapDraft {
  const none: GapDraft = { answer: null, from: null };
  const text = String(raw ?? '');
  const a = text.indexOf('{'); const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return none;
  let j: { answer?: unknown; from?: unknown };
  try { j = JSON.parse(text.slice(a, b + 1)) as typeof j; } catch { return none; }
  const answer = typeof j.answer === 'string' ? j.answer.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 600) : '';
  if (!answer || /^(null|none|n\/a)$/i.test(answer)) return none;
  return { answer, from: j.from === 'staff' ? 'staff' : j.from === 'sources' ? 'sources' : null };
}

