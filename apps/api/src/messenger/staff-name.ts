/**
 * The name a teammate's reply carries in the inbox.
 *
 * "Nhân viên" on every bubble a person typed told the owner nothing: with
 * three people answering the same Page, the question is always WHICH of them
 * promised the 2pm slot. The answer is a first name - the one the shop calls
 * them by - never an id and never a full email address.
 *
 * Order: the account's first name, else the technician profile's first name,
 * else the part of the email before the @. Capped, single-spaced, and null
 * when there is nothing usable, so the screen can fall back to "Nhân viên".
 */
export interface StaffNameSource {
  firstName?: string | null;
  staffFirstName?: string | null;
  email?: string | null;
}

const MAX = 24;

function tidy(v: unknown): string {
  return String(v ?? '').trim().replace(/\s+/g, ' ');
}

export function staffLabel(u: StaffNameSource | null | undefined): string | null {
  if (!u) return null;
  const first = tidy(u.firstName) || tidy(u.staffFirstName);
  if (first) return first.slice(0, MAX);
  const local = tidy(u.email).split('@')[0] ?? '';
  return local ? local.slice(0, MAX) : null;
}
