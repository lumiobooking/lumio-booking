/**
 * WHAT THE DESK SHOULD KNOW THE MOMENT A RETURNING CUSTOMER IS PICKED.
 *
 * The booking form used to be five empty fields and a fifty-line service
 * list for everyone, first-timer and twelve-visit regular alike. The regular
 * costs the receptionist a minute of retyping and scrolling for a visit that
 * is almost always "the same as last time". This module folds a customer's
 * past visits — appointments and walk-ins — into the few facts that make
 * the next booking one tap: how many times she came, when last, what she
 * had, who did it, whether she has stood the shop up.
 *
 * Pure. The service fetches, this file counts, the spec checks the counting.
 * Every row handed in already belongs to one salon; nothing here crosses.
 */

export interface VisitRow {
  customerId: string;
  /** When the visit happened (appointment start, or a walk-in's done/created time). */
  at: Date;
  /** 'NO_SHOW' is counted apart; anything else that reached us is a visit. */
  status: string;
  staffId: string | null;
  staffName: string | null;
  /** Services in the order they were listed, by id and name; the primary first. */
  services: { id: string; name: string }[];
}

export interface CustomerHistory {
  /** Visits that happened (past, not a no-show). */
  visits: number;
  noShows: number;
  /** The next booking already on the calendar, if any. */
  upcomingAt: Date | null;
  last: { at: Date; services: { id: string; name: string }[]; staffId: string | null; staffName: string | null } | null;
  /** The technician who did most of her visits (ties: the most recent). */
  favoriteStaff: { id: string; name: string } | null;
  /** Her most frequent services, most frequent first. */
  topServices: { id: string; name: string; n: number }[];
}

export const EMPTY_HISTORY: CustomerHistory = { visits: 0, noShows: 0, upcomingAt: null, last: null, favoriteStaff: null, topServices: [] };

/** One customer's history from her rows, newest first or not — the function sorts. */
export function summarizeHistory(rows: VisitRow[], now: Date = new Date(), topN = 4): CustomerHistory {
  const sorted = [...rows].sort((a, b) => b.at.getTime() - a.at.getTime());
  const past = sorted.filter((r) => r.at.getTime() <= now.getTime());
  const upcoming = sorted.filter((r) => r.at.getTime() > now.getTime() && r.status !== 'NO_SHOW');
  const came = past.filter((r) => r.status !== 'NO_SHOW');
  const noShows = past.filter((r) => r.status === 'NO_SHOW').length;
  const last = came[0] ? { at: came[0].at, services: came[0].services, staffId: came[0].staffId, staffName: came[0].staffName } : null;

  // Favourite technician: most visits; a tie goes to whoever did the latest one.
  const byStaff = new Map<string, { name: string; n: number; latest: number }>();
  for (const r of came) {
    if (!r.staffId) continue;
    const cur = byStaff.get(r.staffId) ?? { name: r.staffName ?? '', n: 0, latest: 0 };
    cur.n += 1;
    cur.latest = Math.max(cur.latest, r.at.getTime());
    if (!cur.name && r.staffName) cur.name = r.staffName;
    byStaff.set(r.staffId, cur);
  }
  const fav = [...byStaff.entries()].sort((a, b) => b[1].n - a[1].n || b[1].latest - a[1].latest)[0];

  const bySvc = new Map<string, { name: string; n: number; latest: number }>();
  for (const r of came) {
    for (const s of r.services) {
      if (!s.id) continue;
      const cur = bySvc.get(s.id) ?? { name: s.name, n: 0, latest: 0 };
      cur.n += 1;
      cur.latest = Math.max(cur.latest, r.at.getTime());
      bySvc.set(s.id, cur);
    }
  }
  const topServices = [...bySvc.entries()]
    .sort((a, b) => b[1].n - a[1].n || b[1].latest - a[1].latest)
    .slice(0, topN)
    .map(([id, v]) => ({ id, name: v.name, n: v.n }));

  return {
    visits: came.length,
    noShows,
    upcomingAt: upcoming.length ? upcoming[upcoming.length - 1].at : null,
    last,
    favoriteStaff: fav ? { id: fav[0], name: fav[1].name } : null,
    topServices,
  };
}

/** Group rows by customer and summarize each; customers with no rows get EMPTY_HISTORY. */
export function historiesOf(ids: string[], rows: VisitRow[], now: Date = new Date()): Map<string, CustomerHistory> {
  const by = new Map<string, VisitRow[]>();
  for (const r of rows) by.set(r.customerId, [...(by.get(r.customerId) ?? []), r]);
  const out = new Map<string, CustomerHistory>();
  for (const id of ids) out.set(id, by.has(id) ? summarizeHistory(by.get(id)!, now) : EMPTY_HISTORY);
  return out;
}

/** The services on an appointment: the primary, then the extra services snapshotted in `addons`. */
export function appointmentServices(a: { service?: { id: string; name: string } | null; addons?: unknown }): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  if (a.service) out.push({ id: a.service.id, name: a.service.name });
  const addons = Array.isArray(a.addons) ? (a.addons as { id?: string; name?: string; kind?: string }[]) : [];
  for (const x of addons) {
    if (x && x.kind === 'service' && x.id && x.name && !out.some((s) => s.id === x.id)) out.push({ id: String(x.id), name: String(x.name) });
  }
  return out;
}

/** The services on a walk-in ticket: its line items (by service id), else its primary service. */
export function walkInServices(w: { service?: { id: string; name: string } | null; items?: unknown }): { id: string; name: string }[] {
  const items = Array.isArray(w.items) ? (w.items as { serviceId?: string; name?: string }[]) : [];
  const out: { id: string; name: string }[] = [];
  for (const it of items) {
    if (it && it.serviceId && it.name && !out.some((s) => s.id === it.serviceId)) out.push({ id: String(it.serviceId), name: String(it.name) });
  }
  if (!out.length && w.service) out.push({ id: w.service.id, name: w.service.name });
  return out;
}
