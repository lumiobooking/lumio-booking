/**
 * The Human Agent tag, and why a request for it kept being refused.
 *
 * WHAT META'S RULE ACTUALLY IS
 *
 * A Page may answer a person freely for 24 hours after that person's last
 * message. After that the door shuts — unless a REAL PERSON at the business is
 * the one writing, in which case the message may carry the HUMAN_AGENT tag and
 * the door stays open for seven days. The tag is a promise about WHO is
 * typing: a human, dealing with something the automation could not.
 *
 * WHAT THIS APP WAS DOING
 *
 * Every outbound message — the bot's and the receptionist's alike — went out
 * as `messaging_type: 'RESPONSE'`. That is correct inside the 24 hours and
 * simply fails outside it. So the app asked App Review for the Human Agent
 * feature and then never sent a single message with the tag. A reviewer
 * looking for the use case could not find it, because it was not there.
 *
 * This module is the missing half. It decides, for one outbound message, which
 * envelope Meta should receive — and it refuses to put the tag on anything the
 * bot wrote, because the tag is a statement about a human being and lending it
 * to a machine is exactly the abuse the rule exists to stop.
 */

/** Meta's standard window: a Page may reply freely for 24 hours. */
export const RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** With the HUMAN_AGENT tag, a person at the business gets seven days. */
export const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface OutboundEnvelope {
  /** What goes in the Send API body, or null when nothing may be sent. */
  body: { messaging_type: 'RESPONSE' } | { messaging_type: 'MESSAGE_TAG'; tag: 'HUMAN_AGENT' } | null;
  /** Why, in words a receptionist can act on. Null when the send may proceed. */
  refusal: string | null;
  /** True when this message will carry the tag — the inbox says so out loud. */
  humanAgent: boolean;
}

/**
 * When the customer last wrote, from the thread's own history.
 *
 * The thread's `lastMessageAt` moves when WE send too, so it cannot answer
 * this question: a window is measured from the last INBOUND line and nothing
 * else. Returns null when the history holds no customer turn with a timestamp
 * — rows backfilled before stamping existed — and a null must never be read
 * as "long ago".
 */
export function lastInboundAt(history: unknown): string | null {
  // The NEWEST customer turn by the clock, not the last one in the array.
  //
  // This used to walk backwards and return the first `user` turn it met, which
  // is correct only if array order is time order. mergeHistory breaks that:
  // anything Meta has not caught up with is appended to the end regardless of
  // when it happened, so an OLD customer message could sit last. Reading that
  // as "when they last wrote" makes the app believe the 24-hour window shut
  // when it is open — and then attach HUMAN_AGENT inside the window, which is
  // a policy violation, not a display bug. Taking the maximum cannot be fooled
  // by order.
  const rows = Array.isArray(history) ? history : [];
  let best: number | null = null;
  let bestIso: string | null = null;
  for (const row of rows) {
    const r = row as { role?: string; at?: string } | null;
    if (!r || r.role !== 'user' || typeof r.at !== 'string' || !r.at) continue;
    const t = Date.parse(r.at);
    if (!Number.isFinite(t)) continue;
    if (best === null || t > best) { best = t; bestIso = r.at; }
  }
  return bestIso;
}

/**
 * When the customer last wrote — from the one column only they can move.
 *
 * `lastCustomerAt` is stamped by inbound webhooks and nothing else.
 * `lastMessageAt` is stamped by the bot and by staff sends too, so it answers
 * "when did anything happen here", which is a different question and the wrong
 * one for every window Meta measures. The header read that second field and
 * announced "wrote 1h ago" over a thread whose last customer message was the
 * night before.
 *
 * The history scan stays as the fallback for rows written before the column
 * existed. The column wins when both are present: it is a timestamp Meta gave
 * us, while history is a rolling 12-turn buffer that can have rolled past the
 * message in question.
 */
export function customerLastWroteAt(
  lastCustomerAt: string | Date | null | undefined,
  history: unknown,
): string | null {
  if (lastCustomerAt) {
    const d = lastCustomerAt instanceof Date ? lastCustomerAt : new Date(lastCustomerAt);
    if (Number.isFinite(d.getTime())) return d.toISOString();
  }
  return lastInboundAt(history);
}

/**
 * Which envelope this outbound message needs.
 *
 * `byHuman` is the whole point and is never inferred: the caller knows whether
 * a person pressed Send or the model did, and only the caller can know it.
 *
 * An unknown or unparseable last-inbound time sends as RESPONSE rather than
 * refusing. Our copy of that timestamp can be missing or wrong, Meta's cannot;
 * blocking on our guess makes a bad guess unrecoverable, while attempting the
 * send costs one error message that says exactly what happened.
 */
export function outboundEnvelope(
  opts: { lastInbound: string | null | undefined; byHuman: boolean; vi?: boolean },
  now: Date = new Date(),
): OutboundEnvelope {
  const vi = opts.vi !== false;
  const ms = opts.lastInbound ? Date.parse(opts.lastInbound) : NaN;
  if (!Number.isFinite(ms)) {
    return { body: { messaging_type: 'RESPONSE' }, refusal: null, humanAgent: false };
  }
  const age = now.getTime() - ms;

  // Inside 24 hours nothing special is needed, and a tag would be noise on a
  // message that did not require one.
  if (age <= RESPONSE_WINDOW_MS) {
    return { body: { messaging_type: 'RESPONSE' }, refusal: null, humanAgent: false };
  }

  // Past 24 hours the bot has nothing it may say. This is not a limitation to
  // work around: an automated message outside the window is precisely what the
  // rule forbids, and tagging it HUMAN_AGENT to get it through would be a lie
  // told to Meta on the salon's behalf.
  if (!byHumanSafe(opts.byHuman)) {
    return {
      body: null,
      humanAgent: false,
      refusal: vi
        ? 'Quá 24 giờ kể từ tin nhắn của khách — bot không được phép nhắn tiếp. Nhân viên trả lời tay thì vẫn gửi được (trong 7 ngày).'
        : 'More than 24 hours since the customer wrote — the bot may not message again. A person on the team can still reply by hand, for up to 7 days.',
    };
  }

  if (age <= HUMAN_AGENT_WINDOW_MS) {
    return { body: { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' }, refusal: null, humanAgent: true };
  }

  return {
    body: null,
    humanAgent: false,
    refusal: vi
      ? 'Quá 7 ngày kể từ tin nhắn của khách — Meta đóng hẳn cửa sổ trả lời. Gọi điện hoặc nhắn SMS cho khách.'
      : 'More than 7 days since the customer wrote — Meta has closed the window for good. Call or text them instead.',
  };
}

/** A defensive read: anything but a literal true is not a human. */
function byHumanSafe(v: unknown): boolean {
  return v === true;
}

/**
 * What the inbox shows above the message box.
 *
 * Three states, because there are three: the ordinary window, the seven-day
 * one a person may use, and shut. The middle one has to be VISIBLE — somebody
 * typing needs to know their message is going out under a rule that says a
 * human wrote it, because that is a promise the salon is making.
 */
export function replyWindowState(
  lastInbound: string | null | undefined,
  now: Date = new Date(),
): { kind: 'open' | 'human-agent' | 'closed' | 'unknown'; hoursLeft: number | null } {
  const ms = lastInbound ? Date.parse(lastInbound) : NaN;
  if (!Number.isFinite(ms)) return { kind: 'unknown', hoursLeft: null };
  const age = now.getTime() - ms;
  const hours = (win: number) => Math.max(0, Math.floor((win - age) / 3_600_000));
  if (age <= RESPONSE_WINDOW_MS) return { kind: 'open', hoursLeft: hours(RESPONSE_WINDOW_MS) };
  if (age <= HUMAN_AGENT_WINDOW_MS) return { kind: 'human-agent', hoursLeft: hours(HUMAN_AGENT_WINDOW_MS) };
  return { kind: 'closed', hoursLeft: 0 };
}
