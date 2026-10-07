import { openTimesFor } from './open-times';
import type { DayHoursLike } from '../settings/business-hours';

/**
 * PHONE BOOKINGS FOR ONE PERSON OR A WHOLE GROUP.
 *
 * "Me and my two friends, Saturday at two — I want gel and a pedicure, they
 * just want pedicures." A receptionist hears three people, four services and
 * one time, checks there are three technicians free at two, and writes three
 * names into the book. The hotline used to hear one person and one service,
 * book blindly without looking at the diary, and lose the rest.
 *
 * Pure: everything here is arithmetic on rows the caller already loaded, so
 * the spec can pin each rule without a database.
 */

export interface MenuItem { id: string; name: string; minutes: number }

/** A technician who takes appointments, with what they do and when they are taken. */
export interface Tech {
  id: string;
  name: string;
  /** Services this tech registered. Empty = performs anything on the menu. */
  skills: string[];
  /** Their bookings that day plus everything outside their shift. */
  busy: { start: Date; end: Date }[];
}

/** One person in the party: their services, how long they take, an asked-for tech. */
export interface PartyMember { serviceIds: string[]; minutes: number; techId?: string | null }

/** Short, speakable menu codes. A model copying "S12" cannot garble it the
 *  way it garbles a 25-character database id. */
export const serviceCode = (i: number): string => `S${i + 1}`;

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The service a reference names: its menu code ("S3"), its id, its exact
 * name, or a name only ONE item on the menu contains. Two candidates is not
 * an answer — the assistant must ask, never pick.
 */
export function resolveService(ref: string, menu: MenuItem[]): MenuItem | null {
  const raw = String(ref ?? '').trim();
  if (!raw) return null;
  const code = /^s(\d{1,3})$/i.exec(raw);
  if (code) return menu[Number(code[1]) - 1] ?? null;
  const byId = menu.find((m) => m.id === raw);
  if (byId) return byId;
  const want = norm(raw);
  if (!want) return null;
  const exact = menu.filter((m) => norm(m.name) === want);
  if (exact.length === 1) return exact[0];
  const contains = menu.filter((m) => norm(m.name).includes(want));
  return contains.length === 1 ? contains[0] : null;
}

const overlaps = (a: { start: Date; end: Date }, s: Date, e: Date) => a.start.getTime() < e.getTime() && s.getTime() < a.end.getTime();

/** Techs able to do this person's visit: every service on their list, else the first one. */
function skilled(m: PartyMember, techs: Tech[]): Tech[] {
  // A service nobody lists is anybody's (the same rule as assignment/assignment.util skilledFor).
  const claimed = new Set(techs.flatMap((t) => t.skills));
  const can = (t: Tech, ids: string[]) => t.skills.length === 0 || ids.every((id) => t.skills.includes(id) || !claimed.has(id));
  const all = techs.filter((t) => can(t, m.serviceIds));
  return all.length ? all : techs.filter((t) => can(t, m.serviceIds.slice(0, 1)));
}

/**
 * Can the whole party start at `start`, each person with a DIFFERENT free
 * technician who can do their services? Unassigned bookings already in the
 * book at that time each hold one technician too — a salon of three with two
 * unassigned bookings at two o'clock has one chair left, not three.
 *
 * A salon with no technicians set up, or a service nobody has registered,
 * books PENDING exactly like the online page does — the desk assigns by hand.
 */
export function partyFits(
  start: Date,
  party: PartyMember[],
  techs: Tech[],
  unassigned: { start: Date; end: Date }[] = [],
): boolean {
  if (techs.length === 0) return true;
  type Demand = { cands: Tech[] };
  const demands: Demand[] = [];
  for (const m of party) {
    const end = new Date(start.getTime() + Math.max(5, m.minutes) * 60_000);
    let pool: Tech[];
    if (m.techId) {
      const t = techs.find((x) => x.id === m.techId);
      if (!t) return false;
      pool = [t];
    } else {
      pool = skilled(m, techs);
      if (pool.length === 0) continue; // nobody registered for it → lands PENDING
    }
    demands.push({ cands: pool.filter((t) => !t.busy.some((b) => overlaps(b, start, end))) });
  }
  const longest = Math.max(5, ...party.map((m) => m.minutes));
  const windowEnd = new Date(start.getTime() + longest * 60_000);
  for (const u of unassigned) {
    if (!overlaps(u, start, windowEnd)) continue;
    demands.push({ cands: techs.filter((t) => !t.busy.some((b) => overlaps(b, u.start, u.end))) });
  }
  if (demands.some((d) => d.cands.length === 0)) return false;
  // Fewest options first; a party is a handful of people, so plain backtracking is instant.
  demands.sort((a, b) => a.cands.length - b.cands.length);
  const used = new Set<string>();
  const place = (i: number): boolean => {
    if (i === demands.length) return true;
    for (const t of demands[i].cands) {
      if (used.has(t.id)) continue;
      used.add(t.id);
      if (place(i + 1)) return true;
      used.delete(t.id);
    }
    return false;
  };
  return place(0);
}

/** Every start time on one day that the salon is open for and the whole party fits. */
export function partyOpenTimes(args: {
  dateStr: string;
  tz: string;
  day: DayHoursLike | null;
  closedToday?: boolean;
  stepMinutes: number;
  now: Date;
  party: PartyMember[];
  techs: Tech[];
  unassigned?: { start: Date; end: Date }[];
}): Date[] {
  const longest = Math.max(5, ...args.party.map((m) => m.minutes));
  const opens = openTimesFor({
    dateStr: args.dateStr, tz: args.tz, day: args.day, closedToday: args.closedToday,
    stepMinutes: args.stepMinutes, durationMinutes: longest, busy: [], now: args.now,
  });
  return opens.filter((s) => partyFits(s, args.party, args.techs, args.unassigned ?? []));
}

/** The `n` options closest to what the caller asked for, in time order. */
export function nearestTimes(times: Date[], wanted: Date | null, n = 3): Date[] {
  if (!wanted) return times.slice(0, n);
  return [...times]
    .sort((a, b) => Math.abs(a.getTime() - wanted.getTime()) - Math.abs(b.getTime() - wanted.getTime()))
    .slice(0, n)
    .sort((a, b) => a.getTime() - b.getTime());
}
