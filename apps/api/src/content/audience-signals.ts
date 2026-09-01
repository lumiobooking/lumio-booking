/**
 * Who this salon's customers actually are, read from its own book.
 *
 * The request behind this file was "who lives within five miles and who should
 * we target". The honest answer starts closer to home than census data: the
 * people already in the book ARE the catchment. They chose this shop over the
 * others within those five miles, they came at particular hours, and they
 * either came back or they did not. That last fact is worth more than any
 * demographic table, because it is about this business specifically.
 *
 * So this module segments real customers by real behaviour, and then says which
 * segment is worth chasing and why. It never describes a person it has not
 * seen. Where it has too few to speak from, it says so — a "tệp khách tiềm
 * năng" invented out of forty bookings is a horoscope.
 *
 * The segments are chosen for what a salon can actually DO about them:
 *
 *   một-lần-rồi-thôi  the largest and most ignored group in almost every local
 *                     business. They already found the door, paid, and did not
 *                     return. Cheaper to recover than a stranger is to acquire.
 *   khách-quen-đang-nguội  a regular whose gap has stretched past their own
 *                     normal interval. Still warm, and leaving quietly.
 *   khách-quen        the base. Protect, do not discount.
 *   khách-chi-cao     top spenders. Worth a different conversation entirely.
 *   khách-mới         arrived recently; the next visit decides everything.
 */

import { bi, viOf, type Txt } from './i18n';

export interface VisitRow {
  customerId: string;
  /** Epoch ms of the appointment. */
  at: number;
  priceCents: number;
  serviceName?: string | null;
  /** 0-6, local to the salon. */
  weekday: number;
  /** 0-23, local to the salon. */
  hour: number;
}

export type SegmentKey = 'new' | 'one-off' | 'occasional' | 'regular' | 'cooling' | 'high-value';

export interface Segment {
  key: SegmentKey;
  label: Txt;
  count: number;
  /** Share of all known customers, whole percent. */
  sharePct: number;
  avgTicketCents: number;
  /** Median days between visits, null when they have only been once. */
  medianGapDays: number | null;
  /** When they come, in the salon's own words. Null when too few to tell. */
  favouriteTime: Txt | null;
  /** The salon's own service name. Not translated — a service is called what the salon calls it. */
  topService: string | null;
  /** What this group is worth if it behaves as it has been behaving. */
  annualValueCents: number;
}

export interface Target {
  segment: SegmentKey;
  label: Txt;
  /** Why this group, ahead of the others. */
  why: Txt;
  /** The specific move, not "engage them". */
  action: Txt;
  /** Money on the table if it works, with the assumption stated. */
  prize: Txt;
}

export interface AudienceProfile {
  totalCustomers: number;
  segments: Segment[];
  targets: Target[];
  /** True when there is too little history to segment honestly. */
  thin: boolean;
  basis: Txt;
}

const WEEKDAY_VI = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
// Plural on the English side on purpose: this is a habit ("Saturday mornings"),
// not one appointment, and that is how an owner says it out loud.
const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY = 86_400_000;

/** Smallest group we will describe. Below this, three people set the pattern. */
const SEGMENT_FLOOR = 3;
/** Smallest book we will segment at all. */
const BOOK_FLOOR = 20;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function mode<T>(xs: T[]): T | null {
  if (!xs.length) return null;
  const c = new Map<T, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  let best: T | null = null; let n = 0;
  for (const [k, v] of c) if (v > n) { best = k; n = v; }
  return best;
}

const halfDay = (h: number) => (h < 12 ? 'buổi sáng' : h < 17 ? 'buổi chiều' : 'buổi tối');
const halfDayEn = (h: number) => (h < 12 ? 'mornings' : h < 17 ? 'afternoons' : 'evenings');

interface CustomerFacts {
  id: string;
  visits: number;
  totalCents: number;
  firstAt: number;
  lastAt: number;
  gaps: number[];
  weekdays: number[];
  hours: number[];
  services: string[];
}

function roll(rows: VisitRow[]): Map<string, CustomerFacts> {
  const by = new Map<string, VisitRow[]>();
  for (const r of rows) {
    if (!r?.customerId) continue;
    const list = by.get(r.customerId) ?? [];
    list.push(r);
    by.set(r.customerId, list);
  }
  const out = new Map<string, CustomerFacts>();
  for (const [id, list] of by) {
    list.sort((a, b) => a.at - b.at);
    const gaps: number[] = [];
    for (let i = 1; i < list.length; i += 1) gaps.push(Math.round((list[i].at - list[i - 1].at) / DAY));
    out.set(id, {
      id,
      visits: list.length,
      totalCents: list.reduce((s, r) => s + Math.max(0, r.priceCents || 0), 0),
      firstAt: list[0].at,
      lastAt: list[list.length - 1].at,
      gaps,
      weekdays: list.map((r) => r.weekday),
      hours: list.map((r) => r.hour),
      services: list.map((r) => String(r.serviceName ?? '').trim()).filter(Boolean),
    });
  }
  return out;
}

/**
 * Which group a customer belongs to.
 *
 * `cooling` is the judgement call worth explaining: a regular is only "going
 * cold" relative to THEIR OWN rhythm. Someone who comes every three weeks and
 * has been away seven is drifting; someone who comes twice a year and has been
 * away seven weeks is on schedule. A fixed 60-day rule would shout at the
 * second person and miss the first, which is the wrong way round.
 */
export function classify(c: CustomerFacts, now: number, highValueCents: number): SegmentKey {
  const sinceLast = (now - c.lastAt) / DAY;
  if (c.totalCents >= highValueCents && c.visits >= 2) return 'high-value';
  if (c.visits === 1) return sinceLast <= 60 ? 'new' : 'one-off';
  const own = median(c.gaps) ?? 45;
  if (sinceLast > own * 2 + 14) return 'cooling';
  return c.visits >= 4 ? 'regular' : 'occasional';
}

const LABEL: Record<SegmentKey, Txt> = {
  new: bi('Khách mới', 'New customers'),
  'one-off': bi('Đến một lần rồi thôi', 'Came once, never came back'),
  occasional: bi('Thỉnh thoảng', 'Occasional'),
  regular: bi('Khách quen', 'Regulars'),
  cooling: bi('Khách quen đang nguội', 'Regulars going cold'),
  'high-value': bi('Khách chi cao', 'Big spenders'),
};

export function buildAudienceProfile(rows: VisitRow[], now = Date.now()): AudienceProfile {
  const facts = roll(rows ?? []);
  const total = facts.size;
  if (total < BOOK_FLOOR) {
    return {
      totalCustomers: total,
      segments: [],
      targets: [],
      thin: true,
      basis: bi(
        `Mới có ${total} khách trong sổ — chưa đủ để chia nhóm. Dưới ${BOOK_FLOOR} khách thì mọi "tệp khách" rút ra đều là suy đoán.`,
        `Only ${total} customers in the book so far — not enough to split into groups. Under ${BOOK_FLOOR} customers, any "customer segment" you pull out is guesswork.`,
      ),
    };
  }

  // Top decile by lifetime spend defines "high value" for THIS salon. An
  // absolute dollar threshold would call every customer of an expensive shop a
  // VIP and none of a cheap one.
  const spends = Array.from(facts.values(), (c) => c.totalCents).sort((a, b) => b - a);
  const highValueCents = spends[Math.max(0, Math.floor(spends.length * 0.1) - 1)] ?? Infinity;

  const groups = new Map<SegmentKey, CustomerFacts[]>();
  for (const c of facts.values()) {
    const k = classify(c, now, highValueCents);
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }

  const segments: Segment[] = [];
  for (const [key, list] of groups) {
    if (list.length < SEGMENT_FLOOR) continue;
    const gaps = list.flatMap((c) => c.gaps);
    const gap = median(gaps);
    const avgTicket = Math.round(list.reduce((s, c) => s + c.totalCents / c.visits, 0) / list.length);
    const wd = mode(list.flatMap((c) => c.weekdays));
    const hr = mode(list.flatMap((c) => c.hours));
    // Annual value assumes today's rhythm continues — stated, never hidden.
    const perYear = gap && gap > 0 ? 365 / gap : 1;
    segments.push({
      key,
      label: LABEL[key],
      count: list.length,
      sharePct: Math.round((list.length / total) * 100),
      avgTicketCents: avgTicket,
      medianGapDays: gap,
      favouriteTime: wd !== null && hr !== null && list.length >= 5
        ? bi(`${WEEKDAY_VI[wd]} ${halfDay(hr)}`, `${WEEKDAY_EN[wd]} ${halfDayEn(hr)}`)
        : null,
      topService: list.length >= 5 ? mode(list.flatMap((c) => c.services)) : null,
      annualValueCents: Math.round(avgTicket * perYear * list.length),
    });
  }
  segments.sort((a, b) => b.count - a.count);

  const get = (k: SegmentKey) => segments.find((s) => s.key === k);
  const targets: Target[] = [];

  const cooling = get('cooling');
  if (cooling) {
    targets.push({
      segment: 'cooling',
      label: cooling.label,
      why: bi(
        `${cooling.count} người từng đi đều rồi chậm lại quá nhịp riêng của họ. Đây là nhóm đang rời đi trong im lặng, và họ chưa đi hẳn`,
        `${cooling.count} people who used to come in like clockwork have slipped past their own normal gap. This group is leaving quietly, and they are not gone yet`,
      ),
      action: bi(
        'Nhắn tay từng người, không giảm giá. Hỏi thăm và mời đặt lại đúng khung giờ họ vẫn hay đi',
        'Text them one at a time, no discount. Check in and invite them back into the time slot they always used to take',
      ),
      prize: bi(
        `Giữ được nửa nhóm này đáng khoảng ${Math.round(cooling.annualValueCents / 2 / 100)} đô mỗi năm, nếu họ quay lại đúng nhịp cũ`,
        `Keeping half this group is worth about $${Math.round(cooling.annualValueCents / 2 / 100)} a year, if they come back on their old rhythm`,
      ),
    });
  }

  const oneOff = get('one-off');
  if (oneOff) {
    targets.push({
      segment: 'one-off',
      label: oneOff.label,
      why: bi(
        `${oneOff.count} người (${oneOff.sharePct}% sổ khách) đến đúng một lần rồi không quay lại. Họ đã tìm ra tiệm và đã trả tiền — phần khó nhất đã xong`,
        `${oneOff.count} people (${oneOff.sharePct}% of the book) came exactly once and never came back. They already found you and already paid — the hard part is done`,
      ),
      action: bi(
        'Một lời mời quay lại có thời hạn, kèm đúng dịch vụ họ đã làm lần đó. Nếu tiệm chỉ làm một việc trong tháng này, hãy làm việc này',
        'One come-back offer with a deadline on it, for the exact service they had that day. If you only do one thing this month, do this one',
      ),
      prize: bi(
        `Kéo về được 1 trong 10 người là thêm khoảng ${Math.round((oneOff.avgTicketCents * Math.ceil(oneOff.count / 10)) / 100)} đô ngay lần hẹn đầu`,
        `Winning back 1 in 10 of them adds about $${Math.round((oneOff.avgTicketCents * Math.ceil(oneOff.count / 10)) / 100)} on the first appointment alone`,
      ),
    });
  }

  const high = get('high-value');
  if (high) {
    targets.push({
      segment: 'high-value',
      label: high.label,
      why: bi(
        `${high.count} khách chi nhiều nhất, trung bình ${Math.round(high.avgTicketCents / 100)} đô mỗi lần. Nhóm này nhạy với việc được ưu tiên hơn là với giá`,
        `${high.count} biggest spenders, averaging $${Math.round(high.avgTicketCents / 100)} a visit. This group cares about being looked after first, not about price`,
      ),
      action: bi(
        'Giữ chỗ trước cho họ vào khung đẹp, báo trước khi có mẫu mới. TUYỆT ĐỐI không gửi mã giảm giá cho nhóm này',
        'Hold the good time slots for them and tell them first when a new style comes in. NEVER send this group a discount code',
      ),
      prize: bi(
        'Mất một người ở nhóm này tốn bằng mất cả chục khách thỉnh thoảng',
        'Losing one person here costs you as much as losing a dozen occasional customers',
      ),
    });
  }

  const nw = get('new');
  if (nw) {
    targets.push({
      segment: 'new',
      label: nw.label,
      why: bi(
        `${nw.count} khách mới trong 60 ngày. Lần hẹn thứ hai quyết định họ thành khách quen hay thành nhóm một-lần-rồi-thôi`,
        `${nw.count} new customers in the last 60 days. The second appointment decides whether they turn into regulars or into the came-once group`,
      ),
      action: bi(
        'Nhắn cảm ơn trong 48 giờ đầu và gợi ý ngày cho lần sau ngay khi họ còn nhớ trải nghiệm',
        'Send a thank-you text within 48 hours and suggest a date for the next visit while the experience is still fresh',
      ),
      prize: bi(
        'Đây là chỗ rẻ nhất để chặn dòng chảy vào nhóm một-lần-rồi-thôi',
        'This is the cheapest place there is to stop the leak into the came-once group',
      ),
    });
  }

  return {
    totalCustomers: total,
    segments,
    targets,
    thin: false,
    basis: bi(
      `${total} khách có lịch sử trong sổ. Nhóm nào dưới ${SEGMENT_FLOOR} người thì không được nêu ra.`,
      `${total} customers with a history in the book. Any group under ${SEGMENT_FLOOR} people is left out.`,
    ),
  };
}

/**
 * For the prompt — real groups, real numbers, and the floor said out loud.
 *
 * Vietnamese only: the screen strings above are bilingual, so every one of them
 * is unwrapped with `viOf()` on the way in. A `Bi` object dropped into a
 * template literal prints `[object Object]` straight into the prompt.
 */
export function audienceToPrompt(p: AudienceProfile): string {
  if (p.thin) return `TỆP KHÁCH: ${viOf(p.basis)} Không được mô tả tệp khách nào.`;
  const L = [`TỆP KHÁCH THẬT CỦA TIỆM (${p.totalCustomers} khách):`];
  for (const s of p.segments) {
    L.push(`- ${viOf(s.label)}: ${s.count} người (${s.sharePct}%), trung bình ${Math.round(s.avgTicketCents / 100)} đô/lần${s.medianGapDays ? `, quay lại mỗi ~${s.medianGapDays} ngày` : ''}${s.favouriteTime ? `, hay đi ${viOf(s.favouriteTime)}` : ''}`);
  }
  if (p.targets.length) {
    L.push('NÊN NHẮM VÀO, theo thứ tự:');
    for (const t of p.targets) L.push(`- ${viOf(t.label)}: ${viOf(t.action)}. Vì ${viOf(t.why)}`);
  }
  return L.join('\n');
}
