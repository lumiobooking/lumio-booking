/**
 * One person, one chair, one appointment, one bill.
 *
 * WHAT WENT WRONG
 *
 * A customer wrote "waxing eyebrow and acrylic refill". The booking tool
 * accepted a single serviceId, so the model did the only thing it could: it
 * called create_booking twice. The salon's calendar got two rows fifteen
 * minutes apart under the same name, and the till got two separate bills for
 * one person sitting in one chair for one visit.
 *
 * The multi-service path had existed in the booking service the whole time —
 * `serviceIds` on the DTO, priced as line items on one appointment. Nothing in
 * the chat bot could reach it.
 *
 * TWO FIXES, AND ONLY ONE OF THEM IS AN INSTRUCTION
 *
 * The tool now takes a list of services, and the prompt says to send them all
 * in one call. That is the fix that makes the common case right.
 *
 * But a prompt is a request, not a constraint, and a model that has been asked
 * for one call will occasionally still make two. So the second call is caught
 * here and merged into the visit already open — the arithmetic below decides
 * when two calls describe one visit, and it errs towards NOT merging, because
 * a customer who books 10am and then 3pm has booked twice and joining those
 * would be the opposite mistake.
 */

export interface OpenVisit {
  id: string;
  /** The phone the appointment was made under. */
  phone: string;
  url: string;
  /** When the visit currently ends, epoch ms. Grows as services are added. */
  endMs: number;
}

/**
 * How far after a visit ends a second call still counts as the same visit.
 *
 * The model places a second service right after the first — 3:00 then 3:15 for
 * a fifteen-minute wax. An hour is generous enough to absorb that whatever the
 * durations are, and far short of the gap between two genuinely separate
 * appointments on the same day.
 */
export const SAME_VISIT_GRACE_MS = 60 * 60_000;

export function isSameVisit(open: OpenVisit | undefined, phone: string, startIso: string): boolean {
  if (!open) return false;
  if (!phone || open.phone !== phone) return false;
  const start = Date.parse(startIso);
  if (!Number.isFinite(start)) return false;
  // Inside the block, or within the grace period after it. A start BEFORE the
  // visit began is not a continuation of it.
  return start >= open.endMs - SAME_VISIT_GRACE_MS && start <= open.endMs + SAME_VISIT_GRACE_MS;
}

/**
 * Every service the model asked for, from either shape of the tool call.
 *
 * `services` is what the schema now asks for. The single serviceId/serviceName
 * pair is still read, because a model working from a cached prompt or retrying
 * an older call should book rather than fail.
 */
export function servicesAsked(input: Record<string, unknown>): { id: string; name: string }[] {
  const list = Array.isArray(input?.services) && input.services.length
    ? (input.services as Record<string, unknown>[]).map((s) => ({
      id: String(s?.serviceId ?? '').trim(),
      name: String(s?.serviceName ?? '').trim(),
    }))
    : [{
      id: String(input?.serviceId ?? '').trim(),
      name: String(input?.serviceName ?? '').trim(),
    }];
  const seen = new Set<string>();
  return list.filter((s) => {
    if (!s.id && !s.name) return false;
    const key = `${s.id}|${s.name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
