/**
 * QUICK REPAIR — a blocked draft is fixed by its checker, not written again.
 *
 * Every reply is read against the owner's instructions before it goes
 * (ai-brain/instructions). When the draft breaks one, the checker already
 * returns the repaired reply: "the draft with the smallest change that obeys
 * every instruction", using only facts that are in the draft or in the
 * instructions. Until 18/11/2026 that repair was thrown away the first time:
 * the whole reply was written again from the start (on the stronger model),
 * checked a second time, and only a SECOND failure used the checker's text.
 * On the two pages measured on 17/11 that happened to 30% and 37% of replies,
 * and it is where a 4-second answer became a 12-second one.
 *
 * Where this is released (common/ai-release "quickRepair") the checker's
 * repair goes out the first time — when it is usable:
 *   - it is a reply (not empty, not "no reply"), in the conversation's language;
 *   - it really changed the draft, and did not grow (a repair removes or
 *     rewords; it never adds);
 *   - it still carries every word-for-word answer of the owner that the
 *     draft was blocked for (the checker is not shown those);
 *   - and it then passes the same fixed gates as any draft (prices from the
 *     sources, no "booked" without a booking, not a repeat, addressed to the
 *     customer) — MessengerService.runAgent checks those, with what it knows.
 * Anything else falls back to the old way: write again, check again.
 *
 * Pure: the usability rules.
 */
import { keepsWords, type Instruction } from '../ai-brain/instructions';

const squash = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** A repair may reword, but it is not a place to add: at most this much longer than the draft. */
export const REPAIR_MAX_GROWTH = 1.2;
const REPAIR_GROWTH_SLACK = 40;
const REPAIR_MIN_CHARS = 12;

export type RepairRefusal = 'empty' | 'no-reply' | 'language' | 'unchanged' | 'grew' | 'too-short' | 'lost-answer';

/**
 * The checker's repair, if it may go out in place of the draft; else why not.
 * `sameLanguage` = the repair is in the language the conversation is held in.
 */
export function repairCandidate(o: { draft: string; rewrite: string; broken: Pick<Instruction, 'kind' | 'mode' | 'text'>[]; sameLanguage: boolean }): { ok: true; text: string } | { ok: false; why: RepairRefusal } {
  const text = String(o.rewrite ?? '').trim();
  const draft = String(o.draft ?? '').trim();
  if (!text) return { ok: false, why: 'empty' };
  if (/\[NO_REPLY\]/i.test(text)) return { ok: false, why: 'no-reply' };
  if (!o.sameLanguage) return { ok: false, why: 'language' };
  if (squash(text).toLowerCase() === squash(draft).toLowerCase()) return { ok: false, why: 'unchanged' };
  if (squash(text).length < REPAIR_MIN_CHARS || squash(text).split(' ').length < 3) return { ok: false, why: 'too-short' };
  if (text.length > draft.length * REPAIR_MAX_GROWTH + REPAIR_GROWTH_SLACK) return { ok: false, why: 'grew' };
  // The owner's word-for-word answers are checked by their words, not by the
  // checker — so its repair is only usable when it says them.
  for (const i of o.broken) {
    if (i.kind === 'answer' && i.mode === 'verbatim' && !keepsWords(text, i.text)) return { ok: false, why: 'lost-answer' };
  }
  return { ok: true, text };
}
