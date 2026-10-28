/**
 * How the salon lines its technicians up on the calendar (the approved
 * "Lịch — sắp xếp thợ" boards 3A / 3B): the order of the columns, and who is
 * left off the calendar. One answer per salon, so the desk, the iPad and the
 * owner's phone all show the same columns in the same order.
 *
 * A hidden technician still takes bookings; the calendar shows her column
 * again on any day she has one (the web decides that — this only stores).
 */
export const STAFF_LAYOUT_KEY = 'calendar_staff_layout';
/** More than any salon has technicians; keeps a stored row small. */
export const MAX_STAFF = 200;

export interface StaffLayout {
  /** Staff ids, left to right. Anyone not listed comes after, A → Z. */
  order: string[];
  /** Staff ids not drawn on the calendar unless they have a booking that day. */
  hidden: string[];
}

export const EMPTY_LAYOUT: StaffLayout = { order: [], hidden: [] };

const ids = (v: unknown, allowed: ReadonlySet<string> | null): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') continue;
    const id = x.trim();
    if (!id || id.length > 64 || out.includes(id)) continue;
    if (allowed && !allowed.has(id)) continue;
    out.push(id);
    if (out.length >= MAX_STAFF) break;
  }
  return out;
};

/**
 * Clean what was sent or stored. With `allowed` (this salon's own staff ids),
 * anything else is dropped — another salon's ids can never be written here.
 */
export function cleanLayout(raw: unknown, allowed: ReadonlySet<string> | null = null): StaffLayout {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { order: ids(r.order, allowed), hidden: ids(r.hidden, allowed) };
}
