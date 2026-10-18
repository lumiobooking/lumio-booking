/**
 * "People: 3" on the online booking form, with nobody named.
 *
 * The page used to send that number alone: ONE appointment marked "party of
 * 3", priced for one person, holding one technician — the salon found three
 * people at the door and a bill for one. A salon serves people, not a table,
 * so the other two become guests with the booker's services: their own
 * appointment, their own technician, their own price — the same thing the
 * page's "Bringing friends?" flow sends.
 *
 * A restaurant books a TABLE for the party; its number is left as it is.
 *
 * Pure (tested in party-guests.spec.ts).
 */
export interface PartyGuest { firstName: string; serviceIds: string[] }

export const MAX_GUESTS = 9;

export function partyGuests(
  dto: { guests?: PartyGuest[] | null; partySize?: number | null; serviceId?: string | null; serviceIds?: string[] | null },
  seatsAtTables: boolean,
): PartyGuest[] {
  const named = Array.isArray(dto.guests) ? dto.guests.slice(0, MAX_GUESTS) : [];
  if (named.length || seatsAtTables) return named;
  const n = Math.max(1, Math.min(MAX_GUESTS + 1, Math.round(Number(dto.partySize) || 1)));
  if (n < 2) return [];
  const ids = [...new Set([dto.serviceId, ...(Array.isArray(dto.serviceIds) ? dto.serviceIds : [])].filter((x): x is string => typeof x === 'string' && x.length > 0))];
  if (!ids.length) return [];
  return Array.from({ length: n - 1 }, () => ({ firstName: '', serviceIds: [...ids] }));
}
