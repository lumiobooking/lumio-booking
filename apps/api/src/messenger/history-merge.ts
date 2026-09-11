/**
 * Turning Meta's copy of a conversation and ours into the one a person reads.
 *
 * WHY THIS IS ITS OWN FILE WITH ITS OWN TESTS
 *
 * This function decides what appears on screen when somebody opens a
 * conversation. If it drops a turn, a message vanishes — and it vanishes
 * quietly, which means nobody reports it as a bug. They just answer a customer
 * who already told them the answer, or fail to notice a reply that never went
 * out. Every rule below therefore has a test, in the same way the ownership
 * states and the assignment rules do.
 *
 * THE TWO COPIES
 *
 *   Meta's copy   — the real transcript. Complete, but flat: everything the
 *                   Page sent looks the same, because the bot and the staff
 *                   both send THROUGH the Page. Meta cannot tell them apart.
 *
 *   Our copy      — `thread.history`, a rolling 12-turn buffer that exists so
 *                   the bot has short-term memory. Not a transcript, but it is
 *                   the only place that knows a human typed something, and the
 *                   only place that knows a send FAILED.
 *
 * So neither is sufficient alone: Meta has the messages, we have the meaning.
 */

export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
  at?: string | null;
  manual?: boolean;
  failed?: boolean;
  /** Meta's message id (mid) for anything we sent. The ONLY reliable way to
   *  say which of the Page's messages a person typed — see markManual. */
  messageId?: string | null;
}

/**
 * How a message is named so it can still be found tomorrow.
 *
 * The transcript is not a stored list. It is re-read from Meta on every open
 * and re-merged with our own buffer, so "the third message" means nothing five
 * minutes from now - a delayed webhook or a late Meta page can put a different
 * message in that position. Anything that has to survive across reads must be
 * keyed by the message itself.
 *
 * Two keys, because neither alone is enough:
 *
 *   m:<mid>  Meta's own message id. Exact, and the right answer whenever we
 *            have it - but our local buffer does not always carry one (a turn
 *            the bot wrote before we started recording mids, a reply Meta
 *            rejected and therefore never gave an id to).
 *   k:role:text  The fallback the merge already dedupes on. Survives a message
 *            we only know locally, and matches the same message when Meta
 *            hands it back with an id we did not have before.
 *
 * Hiding records BOTH, and a turn is hidden if EITHER matches. That is what
 * makes the hide stick when the same message arrives by the other route.
 */
export function turnKeys(t: HistoryTurn): string[] {
  const out: string[] = [];
  if (t?.messageId) out.push(`m:${String(t.messageId)}`);
  const text = String(t?.content ?? '').trim();
  if (text) out.push(`k:${t?.role ?? ''}:${text}`);
  return out;
}

/** Is this turn one the salon has taken off its screen? */
export function isHidden(t: HistoryTurn, hidden: readonly string[] | null | undefined): boolean {
  if (!hidden || hidden.length === 0) return false;
  const set = hidden instanceof Set ? hidden : new Set(hidden);
  return turnKeys(t).some((k) => set.has(k));
}

const key = (t: HistoryTurn) => `${t.role}:${String(t?.content ?? '').trim()}`;
const txt = (t: HistoryTurn) => String(t?.content ?? '').trim();
const ms = (t: HistoryTurn) => {
  const v = t?.at ? Date.parse(t.at) : NaN;
  return Number.isFinite(v) ? v : null;
};

/**
 * Oldest first, by the clock — not by the order the rows happened to arrive.
 *
 * WHAT THIS COST
 *
 * The merge below used to end by PUSHING every turn Meta had not caught up
 * with onto the end of the array. That is the right place for a reply sent two
 * seconds ago. It is the wrong place for everything else, and "everything
 * else" happens constantly: a staff reply whose text Meta returns in a
 * slightly different form is never matched, so it is appended — and a message
 * from the 1st of September was drawn UNDER a customer message from last
 * night. The transcript then reads as though the salon answered before it was
 * asked.
 *
 * Worse than the display: lastInboundAt() walks this array backwards looking
 * for the last customer turn, on the assumption that array order IS time
 * order. Break that assumption and the app can conclude the 24-hour window is
 * shut when it is open — and then attach Meta's HUMAN_AGENT tag inside the
 * window, which is a policy violation rather than a cosmetic bug.
 *
 * Turns with no timestamp keep their relative position instead of being
 * dumped at one end: a missing `at` means we do not know, and inventing an
 * order is worse than preserving the one we were given.
 */
export function sortByTime(turns: HistoryTurn[]): HistoryTurn[] {
  return turns
    .map((t, i) => ({ t, i, at: ms(t) }))
    .sort((a, b) => {
      if (a.at === null && b.at === null) return a.i - b.i;
      // No clock: hold position relative to the neighbour it arrived next to.
      if (a.at === null) return a.i - b.i > 0 ? 1 : -1;
      if (b.at === null) return b.i - a.i > 0 ? -1 : 1;
      return a.at === b.at ? a.i - b.i : a.at - b.at;
    })
    .map((x) => x.t);
}

/**
 * Which of the Page's messages a PERSON typed.
 *
 * Meta cannot tell a bot reply from a staff reply — both leave through the
 * Page. Only our own buffer knows, so the two copies have to be joined.
 *
 * Joined on Meta's message id where we have one. The previous version joined
 * on the TEXT, which marks every Page message with that text: the day a
 * receptionist typed "Thank you", every "Thank you" the bot had ever sent
 * became a staff message on screen. Short replies collide constantly, and on
 * this screen the bot/staff line is the one a reviewer looks at.
 *
 * Text is still the fallback for turns stored before mids were kept — but it
 * is consumed: one manual turn marks at most ONE of Meta's messages.
 */
function markManual(meta: HistoryTurn[], ours: HistoryTurn[]): HistoryTurn[] {
  const mine = ours.filter((t) => t.role === 'assistant' && t.manual);
  const byMid = new Set(mine.map((t) => t.messageId).filter((x): x is string => Boolean(x)));
  const byText = new Map<string, number>();
  for (const t of mine) {
    if (t.messageId) continue; // already covered by the id path
    byText.set(txt(t), (byText.get(txt(t)) ?? 0) + 1);
  }
  return meta.map((t) => {
    if (t.role !== 'assistant') return t;
    if (t.messageId && byMid.has(t.messageId)) return { ...t, manual: true };
    const left = byText.get(txt(t)) ?? 0;
    if (left > 0) { byText.set(txt(t), left - 1); return { ...t, manual: true }; }
    return t;
  });
}

/**
 * Merge Meta's transcript with what we know about it.
 *
 * @param meta  Meta's messages, oldest first. `null` means we could not ask —
 *              which is NOT the same as "there are none".
 * @param local Our own buffer, oldest first.
 */
export function mergeHistory(meta: HistoryTurn[] | null | undefined, local: HistoryTurn[]): HistoryTurn[] {
  const ours = Array.isArray(local) ? local.filter(Boolean) : [];

  // Could not reach Meta, or Meta has nothing. Fall back to our buffer rather
  // than showing an empty conversation. An incomplete screen is a nuisance; a
  // blank one looks like the customer is gone.
  if (!Array.isArray(meta) || meta.length === 0) return ours;

  const merged: HistoryTurn[] = markManual(
    meta.filter((t) => t && String(t.content ?? '').trim()),
    ours,
  );

  const seen = new Set(merged.map(key));

  for (const t of ours) {
    if (!t || !String(t.content ?? '').trim()) continue;
    // Anything Meta has not caught up with. Two kinds matter:
    //
    //  - a reply sent seconds ago, before Meta's read API reflects it;
    //  - a FAILED reply, which Meta will NEVER have, because it never went out.
    //
    // The second is the important one. A message that Facebook rejected is
    // precisely the message a person needs to see and send again, and dropping
    // it because "Meta does not have it" would hide the only evidence that a
    // customer was left without an answer.
    if (!seen.has(key(t))) {
      merged.push(t);
      seen.add(key(t));
    }
  }

  // Put the whole thing back in clock order. Appending above is how a turn
  // Meta has not returned gets INTO the list; it is not a claim about when it
  // happened. See sortByTime.
  return sortByTime(merged);
}
