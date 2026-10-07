/**
 * THẺ KHÁCH for the technician's booking sheet — pure.
 *
 * What she wants to know before the client sits down, in the order she
 * needs it: anything to be careful about (allergies, sensitivities), how the
 * client likes things done (shape, colours, pressure…), the desk's note,
 * whether this is a first visit or a regular, what they usually have and
 * who usually does it. Nothing about money owed, nothing about other
 * clients, no contact details beyond what the booking already shows.
 */
import { fieldsFor, warnings } from '../common/industry-fields';
import { profileFrom, Visit } from '../common/customer-profile';

export interface CardVisit extends Visit { withMe: boolean }

export interface ClientCardInput {
  industry: string;
  customer: { firstName: string; lastName: string | null; notes: string | null; industryFields: unknown; loyaltyPoints: number; birthDate: Date | null; createdAt: Date; importedVisits?: number; lastVisitAt?: Date | null } | null;
  visits: CardVisit[];
  tz?: string | null;
  now?: Date;
}

export interface ClientCard {
  name: string;
  firstVisit: boolean;
  visits: number;
  withMe: number;
  lastVisit: Date | null;
  lastWithMe: Date | null;
  warnings: { label: { vi: string; en: string }; value: string }[];
  prefs: { label: { vi: string; en: string }; value: string }[];
  notes: string | null;
  favourites: { name: string; count: number }[];
  preferredStaff: { name: string; count: number } | null;
  recent: { at: Date; services: string[]; staff: string | null; withMe: boolean }[];
  points: number;
  birthdaySoon: boolean;
  /** Old-system visits counted in `visits` (shown as "trước đây"). */
  pastVisits: number;
}

/** Days until the next birthday, 0 today; null without a date. */
export function daysToBirthday(birth: Date | null | undefined, now: Date): number | null {
  if (!birth || Number.isNaN(birth.getTime())) return null;
  const m = birth.getUTCMonth();
  const d = birth.getUTCDate();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let next = Date.UTC(now.getUTCFullYear(), m, d);
  if (next < today) next = Date.UTC(now.getUTCFullYear() + 1, m, d);
  return Math.round((next - today) / 86_400_000);
}

export function buildClientCard(input: ClientCardInput): ClientCard | null {
  const c = input.customer;
  if (!c) return null;
  const now = input.now ?? new Date();
  const visits = [...input.visits].filter((v) => v.at instanceof Date && !Number.isNaN(v.at.getTime())).sort((a, b) => b.at.getTime() - a.at.getTime());
  const profile = profileFrom(visits, input.tz);
  const mine = visits.filter((v) => v.withMe);
  const pastVisits = Math.max(0, c.importedVisits ?? 0);
  const total = visits.length + pastVisits;
  const lastHere = visits[0]?.at ?? null;
  const lastOld = c.lastVisitAt ?? null;
  const lastVisit = lastHere && lastOld ? (lastHere > lastOld ? lastHere : lastOld) : (lastHere ?? lastOld);

  const fields = fieldsFor(input.industry).fields;
  const values = (c.industryFields && typeof c.industryFields === 'object' ? c.industryFields : {}) as Record<string, unknown>;
  const warn = warnings(input.industry, values);
  const prefs = fields
    .filter((f) => !f.warn && String(values[f.key] ?? '').trim())
    .map((f) => {
      const raw = String(values[f.key]);
      const opt = f.type === 'select' ? f.options?.find((o) => o.value === raw) : null;
      return { label: { vi: f.vi, en: f.en }, value: opt ? `${opt.vi} / ${opt.en}` : raw.slice(0, 160) };
    });
  const d2b = daysToBirthday(c.birthDate, now);

  return {
    name: `${c.firstName}${c.lastName ? ' ' + c.lastName : ''}`.trim(),
    firstVisit: total === 0,
    visits: total,
    withMe: mine.length,
    lastVisit,
    lastWithMe: mine[0]?.at ?? null,
    warnings: warn,
    prefs,
    notes: (c.notes ?? '').trim() || null,
    favourites: profile.favourites,
    preferredStaff: profile.preferredStaff,
    recent: visits.slice(0, 5).map((v) => ({ at: v.at, services: v.services, staff: v.staff, withMe: v.withMe })),
    points: c.loyaltyPoints ?? 0,
    birthdaySoon: d2b != null && d2b <= 14,
    pastVisits,
  };
}
