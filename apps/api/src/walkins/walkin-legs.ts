/**
 * Multi-leg walk-in tickets ("vé nhiều chặng").
 *
 * A customer who wants hands AND feet is two jobs, often for two technicians:
 * the manicurist may not do pedicures, and when two techs are free the two can
 * run at the same time. One ticket = one technician could not say any of that,
 * so a ticket whose hands were finished sat under the first tech's name, kept
 * her "busy", and nobody was asked to do the feet.
 *
 * Here a ticket's service lines are grouped into LEGS ("chặng"): every line of
 * one leg is done by one technician, one leg at a time per technician.
 *   - HAND and FOOT legs can run at the same time (two techs, one customer).
 *   - Anything else (massage, facial, wax, a combined mani-pedi) runs alone.
 *   - A leg is WAITING → SERVING → DONE. The ticket's own status follows from
 *     its legs (see syncTicket).
 *
 * The leg fields live on each line of the ticket's JSON `items`, so no table
 * changes and old tickets keep working: a ticket written before legs existed
 * reads as ONE leg carrying the ticket's own status and technician — exactly
 * how it behaved before.
 *
 * Everything in this file is pure (no database), so the rules are tested
 * directly in walkin-legs.spec.ts.
 */

export type Zone = 'HAND' | 'FOOT' | 'OTHER';
export type LegStatus = 'WAITING' | 'SERVING' | 'DONE';

export interface LegItem {
  lineId: string;
  serviceId: string;
  name: string;
  priceCents: number;
  durationMinutes?: number;
  staffId: string | null;
  /** Lines sharing a legId are one leg, done by one technician. */
  legId?: string;
  zone?: Zone;
  legStatus?: LegStatus;
  /** The desk (or the customer) chose this technician: the dispatcher never moves it. */
  pinned?: boolean;
  startedAt?: string | null;
  doneAt?: string | null;
  /** How many turns this service is worth (snapshot of Service.turnValue). */
  turnValue?: number;
}

export interface Leg {
  legId: string;
  zone: Zone;
  status: LegStatus;
  staffId: string | null;
  pinned: boolean;
  startedAt: string | null;
  doneAt: string | null;
  lineIds: string[];
  serviceIds: string[];
  names: string[];
  minutes: number;
  turnValue: number;
  /** True for a ticket written before legs existed (one leg = the whole ticket). */
  legacy?: boolean;
}

export interface TicketLike {
  id: string;
  status: string; // WAITING | SERVING | DONE | CANCELLED
  assignedStaffId: string | null;
  createdAt: Date | string;
  assignedAt?: Date | string | null;
  doneAt?: Date | string | null;
  awaitingPayment?: boolean;
  items?: unknown;
}

// ------------------------------------------------------------------ zones

const FOOT = /\b(pedi|pédi|pedicure|foot|feet|toe|toes|callus)|chân|gót/i;
const HAND = /\b(mani|manicure|hand|hands|finger|fingers|nail|nails|gel|dip|acrylic|shellac|polish|french|ombre|fill|fills|tips?|colou?r|sns|builder|cuticle|take ?off|removal|powder)|tay|móng|sơn|bột|đắp/i;

/**
 * Which part of the customer a service works on, from its name and category.
 * A service that names both (a "Mani & Pedi" combo) is OTHER: one technician,
 * and nothing runs beside it.
 */
export function zoneOf(name?: string | null, category?: string | null): Zone {
  const text = `${name ?? ''} ${category ?? ''}`;
  const foot = FOOT.test(text);
  const hand = HAND.test(text.replace(/toe ?nail/gi, 'toe'));
  if (foot && hand) {
    // "Toe Nail Polish" is a foot service that happens to say "nail".
    if (/toe/i.test(text) && !/mani|manicure|hand|finger|tay/i.test(text)) return 'FOOT';
    return 'OTHER';
  }
  if (foot) return 'FOOT';
  if (hand) return 'HAND';
  return 'OTHER';
}

/** Two legs of the same customer can run at once only as hands + feet. */
export function canRunTogether(a: Zone, b: Zone): boolean {
  return (a === 'HAND' && b === 'FOOT') || (a === 'FOOT' && b === 'HAND');
}

// ------------------------------------------------------------------ reading

export function itemsOf(t: { items?: unknown }): LegItem[] {
  return Array.isArray(t.items) ? (t.items as LegItem[]) : [];
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

function legacyStatus(ticketStatus: string): LegStatus {
  if (ticketStatus === 'SERVING') return 'SERVING';
  if (ticketStatus === 'DONE') return 'DONE';
  return 'WAITING';
}

/**
 * The ticket's legs, in the order they were added. Lines without a legId (a
 * ticket from before legs, or a line added by old code) are read as one leg
 * that carries the ticket's status and technician.
 */
export function legsOf(t: TicketLike): Leg[] {
  const items = itemsOf(t);
  const legs: Leg[] = [];
  const byId = new Map<string, Leg>();
  const legacyLines = items.filter((it) => !it.legId);
  for (const it of items) {
    if (!it.legId) continue;
    let leg = byId.get(it.legId);
    if (!leg) {
      leg = {
        legId: it.legId,
        zone: it.zone ?? 'OTHER',
        status: it.legStatus ?? 'WAITING',
        staffId: it.staffId ?? null,
        pinned: !!it.pinned,
        startedAt: it.startedAt ?? null,
        doneAt: it.doneAt ?? null,
        lineIds: [], serviceIds: [], names: [], minutes: 0, turnValue: 0,
      };
      byId.set(it.legId, leg);
      legs.push(leg);
    }
    leg.lineIds.push(it.lineId);
    leg.serviceIds.push(it.serviceId);
    leg.names.push(it.name);
    leg.minutes += it.durationMinutes ?? 0;
    leg.turnValue = Math.max(leg.turnValue, typeof it.turnValue === 'number' ? it.turnValue : 1);
    if (!leg.staffId && it.staffId) leg.staffId = it.staffId;
  }
  if (legacyLines.length || (!items.length)) {
    const zones = new Set(legacyLines.map((it) => it.zone ?? zoneOf(it.name)));
    const zone: Zone = zones.size === 1 ? [...zones][0] : 'OTHER';
    const status = legacyStatus(t.status);
    legs.unshift({
      legId: '_ticket',
      zone,
      status,
      staffId: t.assignedStaffId ?? legacyLines.find((it) => it.staffId)?.staffId ?? null,
      pinned: !!t.assignedStaffId,
      startedAt: iso(t.assignedAt),
      doneAt: status === 'DONE' ? iso(t.doneAt) : null,
      lineIds: legacyLines.map((it) => it.lineId),
      serviceIds: legacyLines.map((it) => it.serviceId),
      names: legacyLines.map((it) => it.name),
      minutes: legacyLines.reduce((s, it) => s + (it.durationMinutes ?? 0), 0),
      turnValue: legacyLines.length ? Math.max(...legacyLines.map((it) => (typeof it.turnValue === 'number' ? it.turnValue : 1))) : 1,
      legacy: true,
    });
  }
  return legs;
}

/** The leg that hasn't been written to items yet (a ticket with no service lines). */
export const isVirtualLeg = (leg: Leg) => leg.legacy && leg.lineIds.length === 0;

// ------------------------------------------------------------------ writing

let seq = 0;
export function newLegId(): string {
  seq = (seq + 1) % 1e6;
  return `L${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Give old lines a real legId, keeping exactly what they meant: one leg with
 * the ticket's status and technician. Called before any leg-level write.
 */
export function upgradeItems(t: TicketLike): LegItem[] {
  const items = itemsOf(t).map((it) => ({ ...it }));
  const legacy = items.filter((it) => !it.legId);
  if (!legacy.length) return items;
  // Nothing started yet: split by zone exactly like a ticket made today.
  if (t.status === 'WAITING' && !t.assignedStaffId) {
    const kept = items.filter((it) => it.legId);
    return attachLines(kept, legacy.map((it) => ({ ...it, zone: it.zone ?? zoneOf(it.name), staffId: it.staffId ?? null })));
  }
  const leg = legsOf(t).find((l) => l.legacy)!;
  const id = newLegId();
  for (const it of legacy) {
    it.legId = id;
    it.zone = leg.zone;
    it.legStatus = leg.status;
    it.pinned = leg.pinned;
    it.staffId = it.staffId ?? leg.staffId;
    it.startedAt = leg.startedAt;
    it.doneAt = leg.doneAt;
    if (typeof it.turnValue !== 'number') it.turnValue = 1;
  }
  return items;
}

/** Apply a change to every line of one leg. */
export function patchLeg(items: LegItem[], legId: string, patch: Partial<LegItem>): LegItem[] {
  return items.map((it) => (it.legId === legId ? { ...it, ...patch } : it));
}

/**
 * Put new lines on the ticket. Each joins the leg already open for its zone
 * (a nail art added to a manicure in progress is the same job), or starts a
 * new WAITING leg. OTHER lines are always a leg of their own.
 * A line that arrives with a technician (a tech logging what they did) lands
 * on that tech's open leg of the zone, or a new leg pinned to them.
 */
export function attachLines(items: LegItem[], lines: (LegItem & { zone: Zone })[]): LegItem[] {
  const out = items.map((it) => ({ ...it }));
  for (const line of lines) {
    const open = line.zone === 'OTHER' ? undefined : out.find((it) =>
      it.legId && it.zone === line.zone && it.legStatus !== 'DONE'
      && (!line.staffId || !it.staffId || it.staffId === line.staffId));
    if (open) {
      out.push({
        ...line,
        legId: open.legId, zone: open.zone, legStatus: open.legStatus, pinned: open.pinned,
        startedAt: open.startedAt ?? null, doneAt: null,
        staffId: open.staffId ?? line.staffId ?? null,
      });
    } else {
      out.push({
        ...line,
        legId: newLegId(), legStatus: 'WAITING', pinned: !!line.staffId,
        startedAt: null, doneAt: null,
      });
    }
  }
  return out;
}

export interface TicketSync {
  status: 'WAITING' | 'SERVING' | 'DONE';
  assignedStaffId: string | null;
  assignedAt: Date | null;
  doneAt: Date | null;
}

/**
 * What the ticket row says, from its legs:
 *   nothing started            → WAITING
 *   anything started, not all  → SERVING (in a chair, or between legs)
 *   every leg done             → DONE (off to the till)
 * The ticket's technician is whoever is working on it now, else the last one.
 */
export function syncTicket(t: TicketLike, items: LegItem[], now: Date): TicketSync {
  const legs = legsOf({ ...t, items });
  const started = legs.filter((l) => l.status !== 'WAITING');
  const serving = legs.filter((l) => l.status === 'SERVING');
  const allDone = legs.length > 0 && legs.every((l) => l.status === 'DONE');
  const lastDone = [...legs].filter((l) => l.status === 'DONE').sort((a, b) => String(a.doneAt).localeCompare(String(b.doneAt))).pop();
  const firstStart = started.map((l) => l.startedAt).filter(Boolean).sort()[0];
  return {
    status: allDone ? 'DONE' : started.length ? 'SERVING' : 'WAITING',
    assignedStaffId: serving[0]?.staffId ?? lastDone?.staffId ?? legs.find((l) => l.pinned)?.staffId ?? t.assignedStaffId ?? null,
    assignedAt: started.length ? (t.assignedAt ? new Date(t.assignedAt) : firstStart ? new Date(firstStart) : now) : null,
    doneAt: allDone ? (t.doneAt ? new Date(t.doneAt) : now) : null,
  };
}

/** Ticket phase for the board: waiting, in a chair, or between two legs. */
export function phaseOf(t: TicketLike): 'WAITING' | 'SERVING' | 'BETWEEN' | 'DONE' {
  if (t.status === 'DONE' || t.status === 'CANCELLED') return 'DONE';
  const legs = legsOf(t);
  if (legs.some((l) => l.status === 'SERVING')) return 'SERVING';
  if (legs.some((l) => l.status === 'DONE')) return 'BETWEEN';
  return t.status === 'SERVING' ? 'SERVING' : 'WAITING';
}

// ------------------------------------------------------------------ turns

/**
 * Turns per technician since `since`: every finished leg is worth its
 * service's turn value (1 by default, ½ or 0 for small add-ons), credited to
 * whoever did it. A ticket closed at the till counts its legs as finished
 * then. Old tickets keep the old rule (one turn per technician on the ticket).
 */
export function turnsFromTickets(tickets: TicketLike[], since: Date): Map<string, number> {
  const turns = new Map<string, number>();
  const add = (id: string | null | undefined, v: number) => { if (id && v > 0) turns.set(id, Math.round(((turns.get(id) ?? 0) + v) * 100) / 100); };
  for (const t of tickets) {
    const closed = t.status === 'DONE';
    const items = itemsOf(t);
    const hasLegs = items.some((it) => it.legId);
    if (!hasLegs) {
      // The pre-legs rule, unchanged: a finished (or waiting-to-pay) ticket is
      // one turn for every technician who has a line on it.
      if (!(closed || t.awaitingPayment)) continue;
      const when = t.doneAt ? new Date(t.doneAt) : null;
      if (closed && when && when < since) continue;
      const techs = new Set(items.map((it) => it.staffId).filter(Boolean) as string[]);
      if (techs.size) techs.forEach((id) => add(id, 1)); else add(t.assignedStaffId, 1);
      continue;
    }
    for (const leg of legsOf(t)) {
      if (!leg.staffId) continue;
      const finished = leg.status === 'DONE' || (closed && leg.status !== 'WAITING') || (t.awaitingPayment && leg.status !== 'WAITING');
      if (!finished) continue;
      const when = leg.doneAt ? new Date(leg.doneAt) : t.doneAt ? new Date(t.doneAt) : null;
      if (when && when < since) continue;
      add(leg.staffId, leg.turnValue);
    }
  }
  return turns;
}

/** Technicians working on something right now (a SERVING leg of an open ticket). */
export function busyTechs(tickets: TicketLike[]): Set<string> {
  const busy = new Set<string>();
  for (const t of tickets) {
    if (t.status !== 'SERVING' || t.awaitingPayment) continue;
    for (const leg of legsOf(t)) if (leg.status === 'SERVING' && leg.staffId) busy.add(leg.staffId);
  }
  return busy;
}

// ------------------------------------------------------------------ dispatch

export interface TechInfo {
  id: string;
  name: string;
  /** Higher first when turns are equal (StaffMember.bookingPriority). */
  priority: number;
  /** Services this tech does; empty = every service (nobody set it up yet). */
  skills: string[];
}

export function canDo(tech: TechInfo, serviceIds: string[]): boolean {
  if (!tech.skills.length || !serviceIds.length) return true;
  return serviceIds.every((id) => tech.skills.includes(id));
}

/** The fairest free technician for these services: fewest turns, then priority, then list order. */
export function pickTech(free: TechInfo[], serviceIds: string[], turns: Map<string, number>): TechInfo | null {
  const able = free.filter((t) => canDo(t, serviceIds));
  if (!able.length) return null;
  return able.reduce((best, t) => {
    const a = turns.get(best.id) ?? 0;
    const b = turns.get(t.id) ?? 0;
    if (b < a) return t;
    if (b === a && t.priority > best.priority) return t;
    return best;
  });
}

export interface Assignment { ticketId: string; legId: string; staffId: string }

export interface DispatchOptions {
  /**
   * Services at least one technician is ticked for. A service nobody is set up
   * for yet (a new menu item, an add-on) is open to everyone — otherwise one
   * unticked box would leave a customer in the queue forever.
   * Omitted = every service is checked against skills.
   */
  restricted?: Set<string>;
}

/**
 * The services a leg's technician must be able to do. When nobody on the team
 * does all of them (manicure + an art nobody is ticked for together), the
 * leg's main service decides; when nobody does even that, anyone may take it.
 * A customer is never stuck in the queue because of how skills were ticked.
 */
export function needFor(leg: Leg, team: TechInfo[], opts: DispatchOptions = {}): string[] {
  const ids = opts.restricted ? leg.serviceIds.filter((id) => opts.restricted!.has(id)) : leg.serviceIds;
  if (!ids.length) return [];
  if (team.some((t) => canDo(t, ids))) return ids;
  const main = ids.slice(0, 1);
  if (team.some((t) => canDo(t, main))) return main;
  return [];
}

/**
 * Who starts what, right now. Pure: the service applies the result.
 *
 * Order of service:
 *   1. customers already part-way through a visit (hands done, feet waiting),
 *      in the order they arrived — they are sitting in a chair;
 *   2. then everybody else in the queue, in arrival order.
 * For each waiting leg: a pinned leg waits for its technician; any other leg
 * gets the fairest free technician who does those services, preferring one no
 * other customer asked for by name. A leg never starts beside a leg it can't
 * run with (only hands + feet run together).
 */
export function planDispatch(tickets: TicketLike[], techs: TechInfo[], turns: Map<string, number>, opts: DispatchOptions = {}): Assignment[] {
  const busy = busyTechs(tickets);
  let free = techs.filter((t) => !busy.has(t.id));
  const out: Assignment[] = [];
  const open = tickets.filter((t) => (t.status === 'WAITING' || t.status === 'SERVING') && !t.awaitingPayment);
  const started = (t: TicketLike) => legsOf(t).some((l) => l.status !== 'WAITING');
  const ts = (d: Date | string) => new Date(d).getTime();
  const ordered = [
    ...open.filter(started).sort((a, b) => ts(a.createdAt) - ts(b.createdAt)),
    ...open.filter((t) => !started(t)).sort((a, b) => ts(a.createdAt) - ts(b.createdAt)),
  ];
  // Technicians a waiting customer asked for by name.
  const reserved = new Set<string>();
  for (const t of ordered) for (const l of legsOf(t)) if (l.status === 'WAITING' && l.pinned && l.staffId) reserved.add(l.staffId);
  for (const t of ordered) {
    if (!free.length) break;
    const legs = legsOf(t);
    const running: Zone[] = legs.filter((l) => l.status === 'SERVING').map((l) => l.zone);
    for (const leg of legs) {
      if (!free.length) break;
      if (leg.status !== 'WAITING') continue;
      if (running.length && !running.every((z) => canRunTogether(z, leg.zone))) continue;
      let tech: TechInfo | null = null;
      if (leg.pinned && leg.staffId) {
        tech = free.find((f) => f.id === leg.staffId) ?? null;
      } else {
        const need = needFor(leg, techs, opts);
        tech = pickTech(free.filter((f) => !reserved.has(f.id)), need, turns) ?? pickTech(free, need, turns);
      }
      if (!tech) continue;
      out.push({ ticketId: t.id, legId: leg.legId, staffId: tech.id });
      free = free.filter((f) => f.id !== tech!.id);
      running.push(leg.zone);
    }
  }
  return out;
}

/** Minutes left on a technician's current leg (rough: its services' length minus time spent). */
export function minutesLeft(tickets: TicketLike[], staffId: string, now: Date): number | null {
  for (const t of tickets) {
    if (t.status !== 'SERVING') continue;
    for (const leg of legsOf(t)) {
      if (leg.status !== 'SERVING' || leg.staffId !== staffId) continue;
      if (!leg.startedAt || !leg.minutes) return null;
      const spent = (now.getTime() - new Date(leg.startedAt).getTime()) / 60000;
      return Math.max(0, Math.round(leg.minutes - spent));
    }
  }
  return null;
}

// ------------------------------------------------------------------ stale chairs

/**
 * A ticket nobody closed. "anna nguy · Sang · 107′" on a 60-minute service:
 * the customer left, the technician forgot to tap Done, and the board kept
 * Sang "busy" all afternoon — the dispatcher skipped her, her turn never
 * counted, the free-chair count lied. Nothing ever released it.
 *
 * The board now says how late a visit is, and a sweeper parks a visit that is
 * late by STALE_GRACE_MIN (or still open after closing) at "waiting to pay":
 * the bill stays open for the till, the chair and the technician are free.
 */
export const LATE_WARN_MIN = 15;
export const STALE_GRACE_MIN = 45;
/** A running leg with no durations on its lines is assumed this long. */
const ASSUMED_LEG_MIN = 60;

/**
 * Minutes past the expected finish of the visit's running legs — the most
 * overdue one. Null when nothing is running, or it is already parked at the
 * till, or no running leg has a start time. Negative is "still within time".
 */
export function overdueMinutes(t: TicketLike, now: Date): number | null {
  if (t.status !== 'SERVING' || t.awaitingPayment) return null;
  let worst: number | null = null;
  for (const leg of legsOf(t)) {
    if (leg.status !== 'SERVING' || !leg.startedAt) continue;
    const spent = (now.getTime() - new Date(leg.startedAt).getTime()) / 60000;
    const over = Math.round(spent - (leg.minutes || ASSUMED_LEG_MIN));
    if (worst === null || over > worst) worst = over;
  }
  return worst;
}

/**
 * True when EVERY running leg is past its time by `grace` — one technician
 * still inside her pedicure keeps the whole visit on the floor.
 */
export function isStale(t: TicketLike, now: Date, grace = STALE_GRACE_MIN): boolean {
  if (t.status !== 'SERVING' || t.awaitingPayment) return false;
  const running = legsOf(t).filter((l) => l.status === 'SERVING');
  if (!running.length) return false;
  return running.every((leg) => {
    if (!leg.startedAt) return false;
    const spent = (now.getTime() - new Date(leg.startedAt).getTime()) / 60000;
    return spent >= (leg.minutes || ASSUMED_LEG_MIN) + grace;
  });
}

/**
 * After closing time a visit is parked once it has run its expected length
 * (no grace) — never the moment it starts. The old rule parked EVERY chair an
 * hour after closing, so a customer seated at 7:05 PM by a salon working late
 * jumped straight to "waiting to pay" and her technician showed as free.
 * A leg with no start time falls back to when the ticket was seated.
 */
export function staleAfterHours(t: TicketLike, now: Date): boolean {
  if (t.status !== 'SERVING' || t.awaitingPayment) return false;
  const running = legsOf(t).filter((l) => l.status === 'SERVING');
  const seatedAt = (t as { assignedAt?: Date | string | null }).assignedAt ?? t.createdAt;
  if (!running.length) {
    const spent = (now.getTime() - new Date(seatedAt as Date).getTime()) / 60000;
    return spent >= ASSUMED_LEG_MIN;
  }
  return running.every((leg) => {
    const from = leg.startedAt ?? seatedAt;
    const spent = (now.getTime() - new Date(from as Date).getTime()) / 60000;
    return spent >= (leg.minutes || ASSUMED_LEG_MIN);
  });
}

// ------------------------------------------------------------------ parties

export interface PartyInfo {
  /** A, B, C… in order of arrival today. */
  tag: string;
  size: number;
  waiting: number;
  serving: number;
  done: number;
}

/**
 * One letter per party on today's floor, in order of the party's first
 * arrival, with where its members are. A ticket without a groupId is not
 * in any party. Pure; the board attaches the result to each ticket.
 */
export function partyTags(tickets: (TicketLike & { groupId?: string | null; awaitingPayment?: boolean })[]): Map<string, PartyInfo> {
  const first = new Map<string, number>();
  const info = new Map<string, PartyInfo>();
  for (const t of tickets) {
    if (!t.groupId || t.status === 'CANCELLED') continue;
    const at = new Date(t.createdAt).getTime();
    first.set(t.groupId, Math.min(first.get(t.groupId) ?? Infinity, at));
    const g = info.get(t.groupId) ?? { tag: '', size: 0, waiting: 0, serving: 0, done: 0 };
    g.size += 1;
    if (t.status === 'DONE') g.done += 1;
    else if (t.status === 'SERVING') g.serving += 1;
    else g.waiting += 1;
    info.set(t.groupId, g);
  }
  const order = [...first.entries()].sort((a, b) => a[1] - b[1]).map(([gid]) => gid);
  order.forEach((gid, i) => { info.get(gid)!.tag = i < 26 ? String.fromCharCode(65 + i) : `G${i + 1}`; });
  return info;
}
