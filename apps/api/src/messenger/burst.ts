/**
 * What to do when a customer sends five messages in four seconds.
 *
 * THE BUG THIS EXISTS TO KILL
 *
 * Every inbound Messenger event started its own reply. Tap a quick-reply
 * button five times — which people do when a page feels slow, or when they
 * are on a phone and not sure the tap registered — and five agent runs start
 * at once. None of them can see the others (each reads the thread history
 * before any of them has written to it), so the customer gets the same
 * paragraph five times. It reads like a broken machine, and the one thing a
 * salon is buying here is a page that reads like a person.
 *
 * THE FIX IS THE ONE A PERSON USES
 *
 * A receptionist does not answer each line as it lands; they wait a beat to
 * see if more is coming, and then answer once. So do we: a short collecting
 * window, everything that arrives inside it merged into one turn, one reply.
 * That fixes the duplicate taps AND the far more common case of somebody
 * typing "Tôi tên An" / "SĐT 0909..." / "Thứ 5 nhé" as three messages — which
 * used to produce three replies, each answering a third of the question.
 */

/** How long to wait for the rest of a burst before answering. */
export const BURST_MS = 4_000;

/** An exactly-repeated reply is worth nothing to the reader for this long. */
export const REPEAT_WINDOW_MS = 10 * 60_000;

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Several messages, as one turn for the agent.
 *
 * Identical lines collapse: the same button tapped twice is a customer who
 * was not sure the first tap worked, not a customer saying it twice as hard.
 * Different lines stay, in order, because "An" then "0909..." then "Thứ 5" is
 * one thought delivered in three keystrokes and the agent needs all of it.
 */
export function mergeBurst(texts: string[]): string {
  const out: string[] = [];
  for (const raw of texts ?? []) {
    const t = String(raw ?? '').trim();
    if (!t) continue;
    if (out.some((p) => norm(p) === norm(t))) continue;
    out.push(t);
  }
  return out.join('\n');
}

/**
 * Would sending this repeat, word for word, what we just said?
 *
 * Only the MOST RECENT reply counts. Saying the same sentence again after
 * saying something else in between is a normal conversation; saying it twice
 * in a row is a stutter, and a stutter carries no information the customer
 * does not already have on screen.
 */
export function alreadySaid(
  history: { role?: string; content?: unknown; at?: string; failed?: boolean }[],
  reply: string,
  nowMs: number = Date.now(),
  withinMs: number = REPEAT_WINDOW_MS,
): boolean {
  const want = norm(reply);
  if (!want) return false;
  for (let i = (history?.length ?? 0) - 1; i >= 0; i--) {
    const turn = history[i];
    if (turn?.role !== 'assistant') continue;
    // A reply the platform refused never reached the customer, so it cannot
    // be "already said" — saying it again is the whole point of retrying.
    if (turn.failed) continue;
    if (norm(turn.content) !== want) return false;
    const at = turn.at ? Date.parse(turn.at) : NaN;
    // No timestamp on an old turn: treat it as recent rather than send a
    // duplicate on the strength of a missing field.
    return !Number.isFinite(at) || nowMs - at < withinMs;
  }
  return false;
}
