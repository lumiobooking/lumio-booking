/**
 * rt246 — each salon shapes how its Google review replies read (27/11/2026).
 *
 * Feedback from a client restaurant (Boba Mi Cafe + Phở Hằng):
 *  - A reviewer thanked the team; the AI answered "please pass along our thanks
 *    to…", which in English asks the REVIEWER to pass thanks on. The right reply
 *    is "we'll pass your kind words on to our team".
 *  - The reviewer wrote the dish wrong; the reply copied the wrong spelling. The
 *    salon's own dishes and services must always be written correctly.
 *  - "Let us set the tone and the way it answers."
 *
 * So: rules on who is thanking whom, the salon's own names spelled from its own
 * menu / service list, the owner's style rules given real weight, and the AI
 * learns from the owner's own edits (the last few "AI wrote → owner posted"
 * pairs become examples). Pure: no database, no clock.
 */

export type ReplyExample = { stars: number; review: string; draft: string; final: string; at: string };
export const MAX_EXAMPLES = 6;

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Remember how the owner rewrote a draft. Only a real edit counts (not the same
 * text, not a one-word tweak of whitespace), newest first, one per review text.
 */
export function rememberEdit(list: ReplyExample[] | null | undefined, e: { stars: number; review: string; draft: string | null | undefined; final: string }, now: Date): ReplyExample[] {
  const cur = Array.isArray(list) ? list.filter((x) => x && typeof x.final === 'string') : [];
  const draft = norm(e.draft ?? '');
  const final = norm(e.final);
  if (!draft || final.length < 10 || final === draft) return cur.slice(0, MAX_EXAMPLES);
  const item: ReplyExample = { stars: Math.round(e.stars) || 0, review: norm(e.review).slice(0, 400), draft: draft.slice(0, 600), final: final.slice(0, 600), at: now.toISOString() };
  return [item, ...cur.filter((x) => norm(x.review) !== item.review)].slice(0, MAX_EXAMPLES);
}

/** The salon's own dish / service names worth spelling right (diacritics kept), short list. */
export function ownNames(raw: (string | null | undefined)[], max = 60): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const n = norm(String(r ?? '')).slice(0, 60);
    if (n.length < 2) continue;
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

/** Who thanks whom — the mistake the client caught, written as a rule. */
export const PERSPECTIVE_RULES = `WHO IS SPEAKING: you are the business answering the reviewer.
- When the reviewer praises or thanks a staff member or "the team", say WE will pass their kind words on (e.g. "We'll be sure to pass your kind words on to our team."). NEVER ask the reviewer to pass anything along ("please pass along our thanks to…" is wrong: it asks THEM to do it).
- Thank the reviewer for their visit and their words; do not thank them on behalf of someone they mentioned.
- Answer what this review actually says; never paste a generic line that does not fit it.`;

/**
 * The salon's voice: its own rules first (inside Google's policy), the correct
 * spelling of its own names, the owner's past rewrites as examples, and a
 * one-off note for this reply.
 */
export function voiceBlock(o: { instruction?: string | null; examples?: ReplyExample[] | null; names?: string[] | null; note?: string | null }): string {
  const parts: string[] = [];
  const ins = norm(o.instruction ?? '');
  if (ins) parts.push(`THE OWNER'S STYLE RULES — follow them closely (wording, sign-off, length, what to mention), except anything Google's policy above forbids (promotions, discounts, offers, incentives, keywords, contact details): ${ins.slice(0, 2000)}`);
  const names = (o.names ?? []).filter(Boolean);
  if (names.length) parts.push(`OUR OWN DISHES / SERVICES — if the reply names one, write it EXACTLY like this (accents included), even if the reviewer spelled it differently; never copy a misspelling of our own names: ${names.join(' · ')}`);
  const ex = (o.examples ?? []).slice(0, MAX_EXAMPLES);
  if (ex.length) {
    parts.push(`HOW THE OWNER CORRECTED EARLIER DRAFTS — match the owner's version: its tone, length, wording and sign-off (never copy the review details):\n${ex.map((x, i) => `${i + 1}. Review (${x.stars}★): "${x.review.slice(0, 200)}"\n   AI draft: "${x.draft.slice(0, 300)}"\n   Owner posted: "${x.final.slice(0, 300)}"`).join('\n')}`);
  }
  const note = norm(o.note ?? '');
  if (note) parts.push(`FOR THIS REPLY ONLY, the owner asks: ${note.slice(0, 300)} (still within Google's policy).`);
  return parts.length ? `\n\n${parts.join('\n\n')}` : '';
}
