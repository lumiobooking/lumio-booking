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
