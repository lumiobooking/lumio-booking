/**
 * The decisions behind the two-button feedback, kept pure so a test can pin
 * each one: what the customer may pick, how a phone is shown on a shared
 * screen, what the owner is told to do about a "not quite", and how a month
 * of answers becomes the numbers on the dashboard.
 *
 * Nothing here touches the database or the clock unless handed one.
 */

export type Sentiment = 'HAPPY' | 'UNHAPPY';
export type CaseStatus = 'NEW' | 'IN_PROGRESS' | 'CONTACTED' | 'RESOLVED';
export const CASE_STATUSES: CaseStatus[] = ['NEW', 'IN_PROGRESS', 'CONTACTED', 'RESOLVED'];

/** The reasons a salon starts with. Stored by English label; shown localised. */
export const DEFAULT_REASONS = ['Waited too long', 'Service quality', 'Polish chipped', 'Staff attitude', 'Cleanliness', 'Price', 'Other'];

const REASON_VI: Record<string, string> = {
  'Waited too long': 'Chờ quá lâu',
  'Service quality': 'Chất lượng dịch vụ',
  'Polish chipped': 'Sơn bị bong',
  'Staff attitude': 'Thái độ nhân viên',
  Cleanliness: 'Vệ sinh',
  Price: 'Giá cả',
  Other: 'Khác',
};
const REASON_ICON: Record<string, string> = {
  'Waited too long': '⏱', 'Service quality': '💅', 'Polish chipped': '💔', 'Staff attitude': '🙂', Cleanliness: '🧼', Price: '💲', Other: '…',
};

/** A reason as the customer sees it: their language, a small icon. */
export function reasonLabel(reason: string, lang: 'en' | 'vi'): string {
  return lang === 'vi' ? (REASON_VI[reason] ?? reason) : reason;
}
export function reasonIcon(reason: string): string { return REASON_ICON[reason] ?? '•'; }

export interface FeedbackSettings {
  enabled: boolean;
  askOnDisplay: boolean;     // ask on the customer iPad right after payment
  smsFallback: boolean;      // text the link if they did not answer there
  smsDelayMinutes: number;
  receiptQr: boolean;        // QR at the bottom of the receipt
  cooldownDays: number;      // do not ask the same customer again within N days
  reasons: string[];
  askPhoto: boolean;
  replyHours: number;        // the promise shown to the customer, counted on each case
  alertPush: boolean;        // phone alert to owners/managers
  alertUserIds: string[];    // empty = every owner + manager
  techSeeOwnScore: boolean;
  techSeeReasons: boolean;
  techLeaderboard: boolean;
  alertSameReason: number;   // N of the same reason …
  alertWindowDays: number;   // … within D days → "needs attention"
}

export const DEFAULT_FEEDBACK_SETTINGS: FeedbackSettings = {
  enabled: false,
  askOnDisplay: true,
  smsFallback: true,
  smsDelayMinutes: 45,
  receiptQr: true,
  cooldownDays: 45,
  reasons: DEFAULT_REASONS,
  askPhoto: true,
  replyHours: 24,
  alertPush: true,
  alertUserIds: [],
  techSeeOwnScore: true,
  techSeeReasons: true,
  techLeaderboard: false,
  alertSameReason: 2,
  alertWindowDays: 14,
};

const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** Whatever was stored or posted, as settings the rest of the code can trust. */
export function sanitizeSettings(raw: Partial<FeedbackSettings> | null | undefined, base: FeedbackSettings = DEFAULT_FEEDBACK_SETTINGS): FeedbackSettings {
  const r = raw ?? {};
  const bool = (k: keyof FeedbackSettings) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : (base[k] as boolean));
  const reasons = Array.isArray(r.reasons)
    ? [...new Set(r.reasons.map((x) => String(x ?? '').trim().slice(0, 40)).filter(Boolean))].slice(0, 12)
    : base.reasons;
  return {
    enabled: bool('enabled'),
    askOnDisplay: bool('askOnDisplay'),
    smsFallback: bool('smsFallback'),
    smsDelayMinutes: r.smsDelayMinutes === undefined ? base.smsDelayMinutes : clampInt(r.smsDelayMinutes, 5, 24 * 60, base.smsDelayMinutes),
    receiptQr: bool('receiptQr'),
    cooldownDays: r.cooldownDays === undefined ? base.cooldownDays : clampInt(r.cooldownDays, 0, 365, base.cooldownDays),
    reasons: reasons.length ? reasons : DEFAULT_REASONS,
    askPhoto: bool('askPhoto'),
    replyHours: r.replyHours === undefined ? base.replyHours : clampInt(r.replyHours, 1, 168, base.replyHours),
    alertPush: bool('alertPush'),
    alertUserIds: Array.isArray(r.alertUserIds) ? r.alertUserIds.map(String).slice(0, 50) : base.alertUserIds,
    techSeeOwnScore: bool('techSeeOwnScore'),
    techSeeReasons: bool('techSeeReasons'),
    techLeaderboard: bool('techLeaderboard'),
    alertSameReason: r.alertSameReason === undefined ? base.alertSameReason : clampInt(r.alertSameReason, 1, 20, base.alertSameReason),
    alertWindowDays: r.alertWindowDays === undefined ? base.alertWindowDays : clampInt(r.alertWindowDays, 1, 90, base.alertWindowDays),
  };
}

/** Only reasons the salon offers survive a submission — nothing free-typed sneaks in as a "reason". */
export function cleanReasons(picked: unknown, offered: string[]): string[] {
  if (!Array.isArray(picked)) return [];
  const allowed = new Set(offered);
  return [...new Set(picked.map((x) => String(x ?? '').trim()))].filter((x) => allowed.has(x)).slice(0, 12);
}

/**
 * A phone on a screen other people can see: country code and the last four.
 * "+1 512 886 8189" → "+1 512 •••• 8189". Anything too short shows only dots.
 */
export function maskPhone(phone: string | null | undefined): string | null {
  const raw = String(phone ?? '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7) return '••••';
  const last = digits.slice(-4);
  if (raw.startsWith('+')) {
    // The markets Lumio sells in, longest code first; anything else keeps two digits.
    const cc = ['84', '61', '44', '1'].find((c) => digits.startsWith(c)) ?? digits.slice(0, 2);
    const area = digits.slice(cc.length, cc.length + 3);
    return `+${cc} ${area} •••• ${last}`;
  }
  return `${digits.slice(0, 3)} •••• ${last}`;
}

/** When a case must be answered by. */
export function caseDueAt(createdAt: Date, replyHours: number): Date {
  return new Date(createdAt.getTime() + Math.max(1, replyHours) * 3_600_000);
}

/** Overdue = still not contacted and past the promise. Contacted cases stop the clock. */
export function isOverdue(c: { status: string; dueAt: Date }, now: Date): boolean {
  return (c.status === 'NEW' || c.status === 'IN_PROGRESS') && c.dueAt.getTime() < now.getTime();
}

export function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/**
 * What to do about a "not quite": one sentence of advice for the owner and a
 * text they can send as it is. Deterministic on purpose — it has to be right
 * every time, in the customer's language, and cost nothing.
 */
export function suggestFix(input: {
  reasons: string[];
  visits: number;
  firstName: string | null;
  salonName: string;
  senderName: string | null;
  techName: string | null;
  lang: 'en' | 'vi';
}): { advice: string; message: string } {
  const r = new Set(input.reasons);
  const regular = input.visits >= 3;
  const name = (input.firstName || '').trim();
  const from = (input.senderName || '').trim();
  const vi = input.lang === 'vi';
  const quality = r.has('Polish chipped') || r.has('Service quality');
  const waited = r.has('Waited too long');
  const attitude = r.has('Staff attitude');
  const price = r.has('Price');

  let offerEn = 'a little something off your next visit';
  let offerVi = 'một ưu đãi nhỏ cho lần tới';
  if (quality) { offerEn = 'to fix it for free this week'; offerVi = 'làm lại miễn phí trong tuần này'; }
  else if (price) { offerEn = '$10 off your next visit'; offerVi = 'giảm giá cho lần tới'; }

  const what: string[] = [];
  if (waited) what.push(vi ? 'phải chờ lâu' : 'the wait');
  if (quality) what.push(vi ? (r.has('Polish chipped') ? 'móng bị bong' : 'chất lượng dịch vụ') : (r.has('Polish chipped') ? 'the chip' : 'how it turned out'));
  if (attitude) what.push(vi ? 'cách phục vụ' : 'how you were looked after');
  if (r.has('Cleanliness')) what.push(vi ? 'vệ sinh' : 'the cleanliness');
  if (price && !quality) what.push(vi ? 'giá' : 'the price');
  const about = what.length ? what.join(vi ? ' và ' : ' and ') : (vi ? 'trải nghiệm hôm nay' : 'your visit');

  const adviceParts: string[] = [];
  adviceParts.push(regular ? (vi ? `Khách quen (${input.visits} lần).` : `A regular (${input.visits} visits).`) : (vi ? 'Khách mới hoặc ít đến.' : 'A new or occasional customer.'));
  adviceParts.push(vi ? `Xin lỗi về ${about} và đề nghị ${offerVi}.` : `Apologise for ${about} and offer ${offerEn}.`);
  if (attitude && input.techName) adviceParts.push(vi ? `Nói chuyện riêng với ${input.techName}.` : `Have a private word with ${input.techName}.`);
  if (waited) adviceParts.push(vi ? 'Kiểm tra lịch hẹn lúc đó có bị dồn không.' : 'Check whether that hour was overbooked.');

  const hi = vi ? (name ? `Chào ${name}` : 'Chào bạn') : (name ? `Hi ${name}` : 'Hi');
  const me = from ? (vi ? `, mình là ${from} ở ${input.salonName}` : `, it's ${from} from ${input.salonName}`) : (vi ? `, ${input.salonName} đây` : ` from ${input.salonName}`);
  const message = vi
    ? `${hi}${me}. Rất xin lỗi về ${about}. Tiệm muốn ${offerVi} — bạn nhắn lại ngày nào tiện nhé.`
    : `${hi}${me} — so sorry about ${about}. We'd love ${offerEn}. Just reply with a day that works.`;
  return { advice: adviceParts.join(' '), message };
}

/** Monday 00:00 of the week `day` (YYYY-MM-DD) falls in, as YYYY-MM-DD. */
export function weekKey(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export interface AnswerRow { dayKey: string; sentiment: Sentiment; staffId: string | null; reasons: string[]; toGoogle: boolean }

/** Answers grouped by week, oldest first, for the last `weeks` weeks ending at `todayKey`. Empty weeks stay (with null %). */
export function weeklyTrend(rows: AnswerRow[], todayKey: string, weeks: number): { week: string; answers: number; happy: number; google: number; pct: number | null }[] {
  const last = weekKey(todayKey);
  const keys: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(`${last}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 7 * i);
    keys.push(d.toISOString().slice(0, 10));
  }
  const by = new Map(keys.map((k) => [k, { answers: 0, happy: 0, google: 0 }]));
  for (const r of rows) {
    const b = by.get(weekKey(r.dayKey));
    if (!b) continue;
    b.answers += 1; if (r.sentiment === 'HAPPY') b.happy += 1; if (r.toGoogle) b.google += 1;
  }
  return keys.map((k) => { const b = by.get(k)!; return { week: k, answers: b.answers, happy: b.happy, google: b.google, pct: pct(b.happy, b.answers) }; });
}

/** Reasons counted, most frequent first. */
export function reasonCounts(rows: AnswerRow[]): { reason: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) if (r.sentiment === 'UNHAPPY') for (const x of r.reasons) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export interface StaffLine { staffId: string; answers: number; happy: number; pct: number | null; google: number; complaints: number; topReason: string | null; topReasonCount: number }

/** Per-technician numbers for the table. Answers with no technician are left out. */
export function staffLines(rows: AnswerRow[]): StaffLine[] {
  const m = new Map<string, AnswerRow[]>();
  for (const r of rows) if (r.staffId) { const a = m.get(r.staffId) ?? []; a.push(r); m.set(r.staffId, a); }
  return [...m].map(([staffId, rs]) => {
    const happy = rs.filter((r) => r.sentiment === 'HAPPY').length;
    const rc = reasonCounts(rs);
    return {
      staffId, answers: rs.length, happy, pct: pct(happy, rs.length),
      google: rs.filter((r) => r.toGoogle).length,
      complaints: rs.length - happy,
      topReason: rc[0]?.reason ?? null, topReasonCount: rc[0]?.count ?? 0,
    };
  });
}

/**
 * A technician "needs attention" when the same reason came up at least
 * `minSame` times within the window — the owner's own threshold from Settings.
 * Returns the worst reason per technician.
 */
export function techFlags(rows: AnswerRow[], minSame: number): { staffId: string; reason: string; count: number }[] {
  const out: { staffId: string; reason: string; count: number }[] = [];
  for (const line of staffLines(rows)) {
    if (line.topReason && line.topReasonCount >= Math.max(1, minSame)) out.push({ staffId: line.staffId, reason: line.topReason, count: line.topReasonCount });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** The salon-local hour band most "waited too long" answers fall in, when it is a real cluster (≥3 and ≥ half). */
export function waitCluster(hours: number[]): { from: number; to: number; count: number; total: number } | null {
  if (hours.length < 3) return null;
  let best = { from: 0, to: 0, count: 0 };
  for (let h = 0; h < 24; h++) {
    const c = hours.filter((x) => x >= h && x < h + 2).length;
    if (c > best.count) best = { from: h, to: h + 2, count: c };
  }
  return best.count >= 3 && best.count * 2 >= hours.length ? { ...best, total: hours.length } : null;
}
