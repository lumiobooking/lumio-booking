/**
 * Chia turn đợt 2 + 3 (19/11/2026) — pure rules.
 *
 *  - Groups: A (best at closing) and B. A customer from an ad goes to group A
 *    first when the salon says so; when nobody in A can take it, everyone.
 *  - Weights: "Lan 50 %, Minh 30 %, Hà 20 %" — a new turn goes to whoever is
 *    furthest BELOW their share today.
 *  - Pages: a person may take only some Pages / Instagram accounts.
 *  - Permissions: staff see everything or only their own; may take a chat from
 *    someone else or not; see full phone numbers or masked.
 *  - The scoreboard: how fast each person answers, how often a turn is passed
 *    on from them, how many end with a phone number, and the ad customers left
 *    waiting (with an estimate of the ad money behind them, when set).
 */

export const TEAM_KEY = 'messenger.turn_team';
export const REPORT_SENT_KEY = 'messenger.turn_report_sent';

export type Member = { group: 'A' | 'B'; weight: number; sources: string[] };
export type TeamConfig = {
  members: Record<string, Member>;
  /** Ad customers go to group A first. */
  adGroupFirst: boolean;
  /** Staff see every conversation (true) or only theirs and nobody's (false). */
  staffSeeAll: boolean;
  /** Staff may take a conversation someone else holds. */
  staffCanTake: boolean;
  /** Staff see phone numbers masked (•••• 0142). */
  maskPhones: boolean;
  /** What one ad conversation costs the salon, in its currency's minor units (0 = do not estimate). */
  adCostCents: number;
  /** A summary to the owner at 21:00 salon time. */
  nightReport: boolean;
};

export const DEFAULT_TEAM: TeamConfig = { members: {}, adGroupFirst: true, staffSeeAll: true, staffCanTake: false, maskPhones: false, adCostCents: 0, nightReport: false };

/** A source is "<pageId>|<channel>", the same key the Inbox filters by. */
export const sourceOf = (pageId: string | null | undefined, channel: string | null | undefined) => `${pageId ?? ''}|${channel || 'messenger'}`;

export function cleanTeam(raw: unknown, allowedUserIds?: Set<string>): TeamConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<TeamConfig> & { members?: Record<string, unknown> };
  const members: Record<string, Member> = {};
  for (const [id, v] of Object.entries(o.members ?? {})) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || (allowedUserIds && !allowedUserIds.has(id))) continue;
    const m = (v ?? {}) as Partial<Member>;
    const w = Math.round(Number(m.weight ?? 0));
    members[id] = {
      group: m.group === 'B' ? 'B' : 'A',
      weight: Number.isFinite(w) ? Math.min(100, Math.max(0, w)) : 0,
      sources: Array.isArray(m.sources) ? m.sources.filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{0,64}\|[a-z]{2,12}$/.test(x)).slice(0, 20) : [],
    };
  }
  const cost = Math.round(Number(o.adCostCents ?? 0));
  return {
    members,
    adGroupFirst: o.adGroupFirst !== false,
    staffSeeAll: o.staffSeeAll !== false,
    staffCanTake: o.staffCanTake === true,
    maskPhones: o.maskPhones === true,
    adCostCents: Number.isFinite(cost) ? Math.min(1_000_000_000, Math.max(0, cost)) : 0,
    nightReport: o.nightReport === true,
  };
}

/** May this person take a conversation from this Page / account? (No list = all.) */
export function takesSource(m: Member | undefined, source: string): boolean {
  return !m || !m.sources.length || m.sources.includes(source);
}

export type PoolAgent = { userId: string; onShift: boolean; openThreads: number; turnsToday: number };

/**
 * Who of the pool may be picked for THIS conversation, in the order to try:
 * first group A for an ad customer when the salon wants that, then everyone.
 * Each element is a candidate list to give to the picker; the first that
 * yields somebody wins.
 */
export function poolsFor(agents: PoolAgent[], team: TeamConfig, thread: { source: string; fromAd: boolean }): PoolAgent[][] {
  const scoped = agents.filter((a) => takesSource(team.members[a.userId], thread.source));
  if (thread.fromAd && team.adGroupFirst) {
    const a = scoped.filter((x) => (team.members[x.userId]?.group ?? 'A') === 'A');
    if (a.length && a.length < scoped.length) return [a, scoped];
  }
  return [scoped];
}

/**
 * Weighted turns: of those who can take one, whoever is furthest below their
 * share of today's turns. A weight of 0 takes no automatic turns. Ties go to
 * fewer open conversations, then the queue order.
 */
export function pickWeighted(pool: PoolAgent[], team: TeamConfig, cap: number, excludeUserId?: string | null): string | null {
  const can = pool.filter((a) => a.onShift && a.userId !== excludeUserId && (cap <= 0 || a.openThreads < cap) && (team.members[a.userId]?.weight ?? 1) > 0);
  if (!can.length) return null;
  const totalW = can.reduce((s, a) => s + (team.members[a.userId]?.weight ?? 1), 0) || 1;
  const totalT = can.reduce((s, a) => s + a.turnsToday, 0) + 1;
  let best: { id: string; gap: number; open: number; i: number } | null = null;
  can.forEach((a, i) => {
    const share = (team.members[a.userId]?.weight ?? 1) / totalW;
    const gap = a.turnsToday / totalT - share; // most negative = most owed
    if (!best || gap < best.gap - 1e-9 || (Math.abs(gap - best.gap) < 1e-9 && (a.openThreads < best.open || (a.openThreads === best.open && i < best.i)))) best = { id: a.userId, gap, open: a.openThreads, i };
  });
  return best ? (best as { id: string }).id : null;
}

/** "0913 456 142" → "•••• 6142" for someone who may not see the whole number. */
export function maskPhone(p: string | null | undefined): string | null {
  if (!p) return p ?? null;
  const digits = String(p).replace(/\D/g, '');
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : '••••';
}

// ---------------------------------------------------------------- scoreboard

export type LogRow = { threadId: string; userId: string | null; fromUserId: string | null; reason: string; createdAt: Date };
export type ThreadFacts = { id: string; adId: string | null; adAt: Date | null; customerId: string | null; booked?: boolean };

export type AgentScore = {
  userId: string;
  received: number;
  answered: number;
  /** Median seconds from getting the turn to the first reply. */
  medianSec: number | null;
  /** Answered before the turn would have passed on. */
  onTimePct: number | null;
  /** Turns passed on FROM this person because they did not act. */
  lost: number;
  /** rt216: of those — not even opened in time / opened but no answer / pressed "Bỏ qua". */
  notOpened: number;
  notReplied: number;
  skipped: number;
  /** Conversations they held that now have a customer record (phone saved / booked). */
  withCustomer: number;
  /** rt219: of those, customers who booked (an appointment made in the period, not cancelled). */
  booked: number;
};

const isTurn = (r: string) => r !== 'unassign' && r !== 'first-reply' && r !== 'backlog' && r !== 'opened' && r !== 'prospect' && r !== 'customer-back'; // rt211: old customers given out to follow up are not live turns

/**
 * Score each person from the assignment log: a turn starts at an assignment
 * row and is answered by that person's first "first-reply" row on the same
 * conversation before the conversation is given to anyone else.
 */
export function scoreboard(logs: LogRow[], threads: Map<string, ThreadFacts>, limitMins: (t: ThreadFacts | undefined) => number): AgentScore[] {
  const sorted = [...logs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const by = new Map<string, AgentScore & { secs: number[]; onTime: number; heldThreads: Set<string> }>();
  const get = (id: string) => {
    let s = by.get(id);
    if (!s) { s = { userId: id, received: 0, answered: 0, medianSec: null, onTimePct: null, lost: 0, notOpened: 0, notReplied: 0, skipped: 0, withCustomer: 0, booked: 0, secs: [], onTime: 0, heldThreads: new Set() }; by.set(id, s); }
    return s;
  };
  const open = new Map<string, { userId: string; at: number }>(); // per thread: the turn in progress
  for (const r of sorted) {
    if (isTurn(r.reason) && r.userId) {
      if ((r.reason === 'reassign-unread' || r.reason === 'reassign-unreplied' || r.reason === 'skip') && r.fromUserId) {
        const f = get(r.fromUserId);
        f.lost += 1;
        if (r.reason === 'reassign-unread') f.notOpened += 1; else if (r.reason === 'skip') f.skipped += 1; else f.notReplied += 1;
      }
      const s = get(r.userId);
      s.received += 1;
      s.heldThreads.add(r.threadId);
      open.set(r.threadId, { userId: r.userId, at: r.createdAt.getTime() });
    } else if (r.reason === 'first-reply' && r.userId) {
      const cur = open.get(r.threadId);
      if (cur && cur.userId === r.userId) {
        const s = get(r.userId);
        const sec = Math.max(0, Math.round((r.createdAt.getTime() - cur.at) / 1000));
        s.answered += 1;
        s.secs.push(sec);
        const lim = limitMins(threads.get(r.threadId));
        if (!lim || sec <= lim * 60) s.onTime += 1;
        open.delete(r.threadId);
      }
    } else if (r.reason === 'unassign') {
      open.delete(r.threadId);
    }
  }
  return [...by.values()].map((s) => {
    const secs = [...s.secs].sort((a, b) => a - b);
    const med = secs.length ? secs[Math.floor((secs.length - 1) / 2)] : null;
    let withCustomer = 0;
    let booked = 0;
    for (const id of s.heldThreads) { const f = threads.get(id); if (f?.customerId) withCustomer += 1; if (f?.booked) booked += 1; }
    return {
      userId: s.userId, received: s.received, answered: s.answered, medianSec: med,
      onTimePct: s.received ? Math.round((s.onTime * 100) / s.received) : null,
      lost: s.lost, notOpened: s.notOpened, notReplied: s.notReplied, skipped: s.skipped, withCustomer, booked,
    };
  }).sort((a, b) => b.received - a.received);
}

/**
 * Ad customers left waiting: an ad conversation whose first human answer came
 * after the salon's ad limit — or never. Each one is ad money that bought a
 * customer nobody spoke to in time.
 */
export function adWaits(adThreads: ThreadFacts[], firstReplyAt: Map<string, Date>, limitMins: number, now: Date): number {
  if (!(limitMins > 0)) return 0;
  let n = 0;
  for (const t of adThreads) {
    if (!t.adAt) continue;
    const due = t.adAt.getTime() + limitMins * 60_000;
    const r = firstReplyAt.get(t.id);
    if (r ? r.getTime() > due : now.getTime() > due) n += 1;
  }
  return n;
}

/** The evening message to the owner. */
export function nightText(o: { scores: { name: string; received: number; medianSec: number | null; lost: number }[]; adWaiting: number; money: string | null }): string {
  const lines = ['📊 Chia turn hôm nay'];
  for (const s of o.scores.slice(0, 6)) {
    const m = s.medianSec == null ? '—' : s.medianSec < 60 ? `${s.medianSec}s` : `${Math.floor(s.medianSec / 60)}p${String(s.medianSec % 60).padStart(2, '0')}`;
    lines.push(`• ${s.name}: ${s.received} khách · trả lời ${m}${s.lost ? ` · bỏ turn ${s.lost}` : ''}`);
  }
  if (o.adWaiting) lines.push(`⚠ ${o.adWaiting} khách quảng cáo phải chờ quá hạn${o.money ? ` (~${o.money} tiền quảng cáo)` : ''}.`);
  return lines.join('\n');
}
