/**
 * When a marketing SMS may legally be sent, per market.
 *
 * WHY THIS EXISTS
 *
 * Vietnam regulates advertising SMS (Nghị định 91/2020/NĐ-CP) in ways this
 * codebase had no concept of: advertising may only be sent 07:00–22:00 local
 * time, no more than three advertising messages to one number per 24 hours, and
 * only to someone who agreed in advance. The campaign engine had consent
 * (smsConsent) and nothing else — a birthday campaign could fire at 2am Hanoi
 * time, three times over, and nobody would have known until a complaint landed.
 *
 * THE DISTINCTION EVERYTHING HANGS ON
 *
 * A booking confirmation is NOT advertising. The customer just booked; the
 * message is the receipt. Vietnamese rules call this "tin CSKH" and it is not
 * time-restricted, because a 10pm booking that gets no confirmation until 7am
 * is a broken product, not a compliant one.
 *
 * So every check here takes `kind`. Transactional messages pass unconditionally.
 * Only marketing is gated. Getting this backwards in either direction is bad:
 * gate the receipt and the product breaks, ungate the advert and the law does.
 *
 * THE RULE THAT PROTECTS EVERY EXISTING SALON
 *
 * US and CA get NO restrictions here, because that is exactly what they have
 * today. Adding quiet hours to the US market would change the behaviour of 25
 * live salons in a commit about Vietnam, which is not a thing to do quietly.
 * (The US has its own quiet-hours law — TCPA, 8am–9pm local — and this system
 * does not implement it. That is a real gap, flagged deliberately rather than
 * fixed by surprise here.)
 */

export type MessageKind = 'transactional' | 'marketing';

export interface SmsPolicy {
  /** Local-time window advertising may be sent in. null = no restriction. */
  adHoursLocal: { fromMinutes: number; toMinutes: number } | null;
  /** Max advertising messages to one number per rolling 24h. null = no cap. */
  adPerDayCap: number | null;
  /** What a customer can text back to stop, beyond the platform default. */
  optOutKeywords: string[];
  /** Appended to marketing messages so the opt-out is stated in their language. */
  optOutLine: string;
}

const US_POLICY: SmsPolicy = {
  // Deliberately null: this is what US salons do today, and a market column is
  // not a licence to change them.
  adHoursLocal: null,
  adPerDayCap: null,
  optOutKeywords: ['stop', 'unsubscribe'],
  optOutLine: 'Reply STOP to opt out.',
};

const VN_POLICY: SmsPolicy = {
  // Nghị định 91/2020: advertising SMS only between 07:00 and 22:00.
  adHoursLocal: { fromMinutes: 7 * 60, toMinutes: 22 * 60 },
  // …and no more than three to one number in 24 hours.
  adPerDayCap: 3,
  // "STOP" is a US carrier convention. A Vietnamese customer will type the
  // Vietnamese word, so both are accepted — an opt-out that is not recognised
  // is worse than no opt-out at all, because the person believes they stopped it.
  optOutKeywords: ['stop', 'tu choi', 'tuchoi', 'từ chối', 'huy', 'hủy'],
  optOutLine: 'Soạn TU CHOI gửi lại để ngừng nhận tin.',
};

/**
 * Australia — Spam Act 2003 and the ACMA rules: every commercial message
 * must identify the sender and carry a working unsubscribe, honoured within
 * five business days. No statutory hours, but 09:00–20:00 keeps a salon out
 * of the complaints Telstra forwards. The daily cap is a courtesy, not law.
 */
const AU_POLICY: SmsPolicy = {
  adHoursLocal: { fromMinutes: 9 * 60, toMinutes: 20 * 60 },
  adPerDayCap: 2,
  optOutKeywords: ['stop', 'unsubscribe', 'opt out', 'optout'],
  optOutLine: 'Reply STOP to unsubscribe.',
};

export function smsPolicyFor(market: string | null | undefined): SmsPolicy {
  const m = String(market ?? '').trim().toUpperCase();
  if (m === 'VN') return VN_POLICY;
  if (m === 'AU') return AU_POLICY;
  return US_POLICY;
}

/**
 * Is this the right time of day to send?
 *
 * `nowMinutesLocal` is minutes past midnight IN THE SALON'S timezone — the
 * caller resolves that, because a server in Oregon deciding what "22:00" means
 * for a salon in Hanoi off its own clock is how this goes wrong.
 */
export function allowedAtThisHour(args: {
  policy: SmsPolicy;
  kind: MessageKind;
  nowMinutesLocal: number;
}): boolean {
  // A receipt is not an advert. Never hold one back.
  if (args.kind === 'transactional') return true;
  const w = args.policy.adHoursLocal;
  if (!w) return true;
  const m = Math.round(Number(args.nowMinutesLocal));
  if (!Number.isFinite(m)) return false;
  return m >= w.fromMinutes && m < w.toMinutes;
}

/**
 * Has this number already had its allowance of adverts today?
 *
 * Takes the timestamps of marketing messages already sent to that number, so
 * the rule can be tested without a database and cannot drift from the query.
 */
export function underDailyCap(args: {
  policy: SmsPolicy;
  kind: MessageKind;
  sentAt: (string | Date)[];
  now?: Date;
}): boolean {
  if (args.kind === 'transactional') return true;
  const cap = args.policy.adPerDayCap;
  if (cap === null) return true;

  const now = (args.now ?? new Date()).getTime();
  const cutoff = now - 24 * 60 * 60 * 1000;
  const recent = args.sentAt.filter((t) => {
    const ms = t instanceof Date ? t.getTime() : Date.parse(String(t));
    // An unparseable timestamp counts AGAINST the sender. Skipping it would let
    // bad data raise the cap, which is the wrong way for a rule to fail.
    return !Number.isFinite(ms) || ms > cutoff;
  });
  return recent.length < cap;
}

/** Did the customer just ask to be left alone? */
export function isOptOut(policy: SmsPolicy, text: string): boolean {
  const t = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.!,;:]+$/g, '');
  if (!t) return false;
  return policy.optOutKeywords.includes(t);
}

/**
 * Both gates plus the reason, so a skipped send can be logged as a decision
 * rather than vanishing. A campaign that silently sends nothing looks exactly
 * like a campaign with no eligible customers, and that ambiguity has cost this
 * project a whole afternoon before.
 */
/**
 * Why an advert was held, in the words of the law that held it. The row is
 * read by the salon on its notification log, so a Sydney shop must not be
 * told it broke a Vietnamese decree.
 */
export function heldReasonFor(
  market: string | null | undefined,
  reason: 'no-consent' | 'outside-hours' | 'daily-cap',
): string {
  const m = String(market ?? '').trim().toUpperCase();
  const p = smsPolicyFor(m);
  const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const win = p.adHoursLocal ? `${hhmm(p.adHoursLocal.fromMinutes)}-${hhmm(p.adHoursLocal.toMinutes)}` : '';
  if (m === 'AU') {
    if (reason === 'no-consent') return 'Giữ lại: khách chưa đồng ý (hoặc đã từ chối) nhận tin quảng cáo — Spam Act 2003. / Held: this customer has not consented to (or opted out of) marketing SMS — Spam Act 2003.';
    if (reason === 'outside-hours') return `Giữ lại: ngoài khung giờ gửi quảng cáo (${win} giờ tiệm). / Held: outside the advertising window (${win} salon time).`;
    return `Giữ lại: số này đã nhận đủ ${p.adPerDayCap} tin quảng cáo trong 24 giờ. / Held: this number reached the ${p.adPerDayCap}-ads-per-day limit.`;
  }
  if (reason === 'no-consent') return 'Giữ lại: khách chưa đồng ý (hoặc đã từ chối) nhận tin quảng cáo — Nghị định 91/2020. / Held: this customer has not consented to (or opted out of) marketing SMS.';
  if (reason === 'outside-hours') return `Giữ lại: ngoài khung giờ quảng cáo cho phép (${win || '07:00-22:00'} giờ tiệm) — Nghị định 91/2020. / Held: outside the allowed advertising window.`;
  return `Giữ lại: số này đã nhận đủ ${p.adPerDayCap ?? 3} tin quảng cáo trong 24 giờ — Nghị định 91/2020. / Held: this number reached the ${p.adPerDayCap ?? 3}-ads-per-day cap.`;
}

export function maySendSms(args: {
  market: string | null | undefined;
  kind: MessageKind;
  nowMinutesLocal: number;
  sentAt?: (string | Date)[];
  now?: Date;
}): { ok: true } | { ok: false; reason: 'outside-hours' | 'daily-cap' } {
  const policy = smsPolicyFor(args.market);
  if (!allowedAtThisHour({ policy, kind: args.kind, nowMinutesLocal: args.nowMinutesLocal })) {
    return { ok: false, reason: 'outside-hours' };
  }
  if (!underDailyCap({ policy, kind: args.kind, sentAt: args.sentAt ?? [], now: args.now })) {
    return { ok: false, reason: 'daily-cap' };
  }
  return { ok: true };
}
