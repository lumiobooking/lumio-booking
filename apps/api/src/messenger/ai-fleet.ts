/**
 * THE PLATFORM'S AI HEALTH — one row per salon, for the people who run Lumio.
 *
 * On 16/11/2026 the AI failed for four customers and the owner found out by
 * testing his own page; that the median reply took 14 seconds, that 62 of 94
 * salons had the AI switched off, and that it carried only 17% of
 * conversations alone were all found by hand the next morning. Nothing on any
 * screen showed them.
 *
 * This is that screen's arithmetic, pure: for each salon, how fast the AI
 * answers (from the conversation's own timestamps), where that time goes,
 * how often it apologised for failing, how many customers are still waiting,
 * and how often the owner's own instructions blocked a reply — with the
 * salons that need attention named first.
 *
 * Numbers only. No message text, no customer's name: it reads across salons,
 * and a count is all a platform screen may carry.
 */
import { botReport, type ReportBooking, type ReportThread } from './bot-report';
import { isFallbackLine } from './agent-fallback';
import { stepsOf, type StepTimes } from './turn-timing';

type FleetTurn = { role?: string; content?: unknown; at?: string; manual?: boolean; nudge?: boolean; failed?: boolean; survey?: unknown; ms?: { w?: number; t?: number; s?: number; h?: number } | null };

const MAX_REPLY_SEC = 600;
const WAITING_MIN = 30;

export function pctl(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}

/**
 * How long the customer waited for each AI reply in the period: from their
 * last message to the reply, in seconds. A second bubble, a survey question,
 * a follow-up nudge and anything a person typed are not replies to time.
 */
export function replyTimes(history: unknown, fromMs: number, toMs: number): { sec: number[]; w: number[]; t: number[]; s: number[]; steps: StepTimes[]; apologies: number } {
  const turns = (Array.isArray(history) ? history : []) as FleetTurn[];
  const out = { sec: [] as number[], w: [] as number[], t: [] as number[], s: [] as number[], steps: [] as StepTimes[], apologies: 0 };
  for (let i = 1; i < turns.length; i++) {
    const b = turns[i]; const u = turns[i - 1];
    if (!b || b.role !== 'assistant' || b.manual || b.nudge || b.failed || b.survey === 'ask') continue;
    const bAt = b.at ? Date.parse(b.at) : NaN;
    if (!Number.isFinite(bAt) || bAt < fromMs || bAt >= toMs) continue;
    if (isFallbackLine(b.content)) out.apologies += 1;
    if (!u || u.role !== 'user') continue;
    const uAt = u.at ? Date.parse(u.at) : NaN;
    const sec = (bAt - uAt) / 1000;
    if (!Number.isFinite(sec) || sec < 0 || sec > MAX_REPLY_SEC) continue;
    out.sec.push(Math.round(sec * 10) / 10);
    const ms = b.ms;
    if (ms && [ms.w, ms.t, ms.s].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
      // Not working = the wait before the AI began, plus (think-ahead) a finished reply held for the customer's pause.
      out.w.push((ms.w as number) + (typeof ms.h === 'number' && Number.isFinite(ms.h) && ms.h > 0 ? ms.h : 0)); out.t.push(ms.t as number); out.s.push(ms.s as number);
      // Inside the working time (replies since 18/11/2026 carry it; older ones do not).
      const st = stepsOf(ms);
      if (st) out.steps.push(st);
    }
  }
  return out;
}

/** Is a customer still waiting on this conversation — they wrote last, over half an hour ago, in the period? */
export function stillWaiting(history: unknown, fromMs: number, nowMs: number): boolean {
  const turns = (Array.isArray(history) ? history : []) as FleetTurn[];
  const last = turns[turns.length - 1];
  if (!last || last.role !== 'user') return false;
  const at = last.at ? Date.parse(last.at) : NaN;
  return Number.isFinite(at) && at >= fromMs && nowMs - at > WAITING_MIN * 60_000;
}

export interface FleetSalon { id: string; name: string; slug: string; /** null = no chat channel connected */ botOn: boolean | null }
export interface FleetThread extends ReportThread { tenantId: string }
export type FleetFlag = 'slow' | 'waiting' | 'errors' | 'blocked' | 'off';

export interface FleetRow {
  tenantId: string; name: string; slug: string; bot: 'on' | 'off' | 'none';
  conversations: number; botReplies: number;
  medianSec: number | null; p90Sec: number | null; over15: number;
  /** Median milliseconds per phase, where the reply carried them: waiting to start, the AI working, sending. */
  phases: { waitMs: number; thinkMs: number; sendMs: number; samples: number } | null;
  /**
   * Inside the working time, where replies carried it (./turn-timing): median
   * milliseconds preparing, the model writing, checking the draft; and the
   * share of replies whose first draft was sent back to be written again.
   */
  steps: { prepMs: number; modelMs: number; checkMs: number; rewriteRate: number; samples: number } | null;
  apologies: number; waiting: number;
  selfHandledRate: number | null; humanTook: number; booked: number;
  /** Share of the owner's-instruction checks that blocked a reply (all time), or null with fewer than 20 checks. */
  blockRate: number | null;
  flags: FleetFlag[];
}

export interface FleetReport {
  days: number; from: string; to: string;
  totals: { salons: number; botOn: number; botOff: number; noChannel: number; conversations: number; botReplies: number; medianSec: number | null; p90Sec: number | null; apologies: number; waiting: number; selfHandledRate: number | null; booked: number };
  rows: FleetRow[];
}

export const SLOW_MEDIAN_SEC = 10;
export const BLOCKED_RATE = 0.25;

export function fleetReport(o: {
  salons: FleetSalon[]; threads: FleetThread[]; bookings: (ReportBooking & { tenantId: string })[];
  /** Per salon: how many times its owner's instructions were applied, and how many of those blocked a reply. */
  instructions: { tenantId: string; used: number; blocked: number }[];
  from: Date; to: Date; days: number;
}): FleetReport {
  const fromMs = o.from.getTime(); const toMs = o.to.getTime();
  // Every row is built from its OWN salon's threads only: grouped by tenant first, never searched across.
  const threadsOf = new Map<string, FleetThread[]>();
  for (const t of o.threads) threadsOf.set(t.tenantId, [...(threadsOf.get(t.tenantId) ?? []), t]);
  const bookingsOf = new Map<string, ReportBooking[]>();
  for (const b of o.bookings) bookingsOf.set(b.tenantId, [...(bookingsOf.get(b.tenantId) ?? []), b]);
  const insOf = new Map(o.instructions.map((i) => [i.tenantId, i]));

  const all: number[] = []; let selfAll = 0;
  const rows: FleetRow[] = o.salons.map((s) => {
    const mine = threadsOf.get(s.id) ?? [];
    const sec: number[] = []; const w: number[] = []; const t: number[] = []; const snd: number[] = []; const steps: StepTimes[] = [];
    let apologies = 0; let waiting = 0;
    for (const th of mine) {
      const r = replyTimes(th.history, fromMs, toMs);
      sec.push(...r.sec); w.push(...r.w); t.push(...r.t); snd.push(...r.s); steps.push(...r.steps); apologies += r.apologies;
      if (stillWaiting(th.history, fromMs, toMs)) waiting += 1;
    }
    const rep = botReport({ threads: mine, bookings: bookingsOf.get(s.id) ?? [], gapsOpen: 0, gapsNew: 0, from: o.from, to: o.to });
    const ins = insOf.get(s.id);
    const blockRate = ins && ins.used >= 20 ? ins.blocked / ins.used : null;
    const medianSec = pctl(sec, 0.5);
    const bot: FleetRow['bot'] = s.botOn === null ? 'none' : s.botOn ? 'on' : 'off';
    const flags: FleetFlag[] = [];
    if (bot === 'on' && medianSec !== null && sec.length >= 3 && medianSec > SLOW_MEDIAN_SEC) flags.push('slow');
    if (waiting >= 3) flags.push('waiting');
    if (apologies > 0) flags.push('errors');
    if (blockRate !== null && blockRate > BLOCKED_RATE) flags.push('blocked');
    if (bot === 'off' && rep.conversations > 0) flags.push('off');
    all.push(...sec); selfAll += rep.selfHandled;
    return {
      tenantId: s.id, name: s.name, slug: s.slug, bot,
      conversations: rep.conversations, botReplies: sec.length,
      medianSec, p90Sec: pctl(sec, 0.9), over15: sec.filter((x) => x > 15).length,
      phases: w.length ? { waitMs: pctl(w, 0.5) as number, thinkMs: pctl(t, 0.5) as number, sendMs: pctl(snd, 0.5) as number, samples: w.length } : null,
      steps: steps.length ? {
        prepMs: pctl(steps.map((x) => x.p), 0.5) as number, modelMs: pctl(steps.map((x) => x.m), 0.5) as number, checkMs: pctl(steps.map((x) => x.j), 0.5) as number,
        rewriteRate: steps.filter((x) => x.r > 0).length / steps.length, samples: steps.length,
      } : null,
      apologies, waiting,
      selfHandledRate: rep.selfHandledRate, humanTook: rep.stoppedAt.human, booked: rep.booked,
      blockRate, flags,
    };
  });
  // What needs attention first, then the busiest.
  rows.sort((a, b) => (b.flags.length - a.flags.length) || (b.conversations - a.conversations) || a.name.localeCompare(b.name));
  const conversations = rows.reduce((n, r) => n + r.conversations, 0);
  return {
    days: o.days, from: o.from.toISOString(), to: o.to.toISOString(),
    totals: {
      salons: rows.length,
      botOn: rows.filter((r) => r.bot === 'on').length, botOff: rows.filter((r) => r.bot === 'off').length, noChannel: rows.filter((r) => r.bot === 'none').length,
      conversations, botReplies: all.length, medianSec: pctl(all, 0.5), p90Sec: pctl(all, 0.9),
      apologies: rows.reduce((n, r) => n + r.apologies, 0), waiting: rows.reduce((n, r) => n + r.waiting, 0),
      selfHandledRate: conversations ? selfAll / conversations : null,
      booked: rows.reduce((n, r) => n + r.booked, 0),
    },
    rows,
  };
}
