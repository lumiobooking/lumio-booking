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
}

const key = (t: HistoryTurn) => `${t.role}:${String(t?.content ?? '').trim()}`;

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

  // Which of the Page's messages were typed by a person. Matched on the text,
  // because that is all the two copies share — Meta assigns its own message
  // ids and never sees ours.
  const manual = new Set(
    ours.filter((t) => t.role === 'assistant' && t.manual).map((t) => String(t.content ?? '').trim()),
  );

  const merged: HistoryTurn[] = meta
    .filter((t) => t && String(t.content ?? '').trim())
    .map((t) => (t.role === 'assistant' && manual.has(String(t.content).trim()) ? { ...t, manual: true } : t));

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

  return merged;
}
