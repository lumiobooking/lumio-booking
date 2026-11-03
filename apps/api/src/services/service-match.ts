/**
 * IS THIS ROW A SERVICE THE SALON ALREADY HAS?
 *
 * Re-importing a menu (a new price list, a corrected file) must UPDATE the
 * services already on the menu, never add a second "Gel Pedicure" next to the
 * first. Two rules make that safe for a nail menu:
 *
 *  - Names compare loosely: case, accents, spacing and punctuation do not
 *    count — "Bio Gel – Full Set", "bio gel full set" and "Bio Gel Full Set "
 *    are one service.
 *  - The category is part of the identity: "Polish Change" under Manicure and
 *    "Polish Change" under Pedicure are two real services with two prices. A
 *    row without a category (or an existing service without one) matches by
 *    name alone, but only when that name is unambiguous.
 *
 * Pure; the web preview (lib/service-import.ts) applies the same rules so it
 * never promises something the import will not do. See service-match.spec.ts.
 */

export interface ExistingService {
  id: string;
  name: string;
  categoryName?: string | null;
  isActive?: boolean | null;
  archivedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

/** "Bio Gel – Full Set " → "bio gel full set". */
export function serviceKey(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Prefer the row the salon actually uses: on the menu, then not archived, then the oldest. */
function best<T extends ExistingService>(rows: T[]): T {
  const t = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() : 0);
  return rows.slice().sort((a, b) =>
    (Number(b.isActive !== false) - Number(a.isActive !== false))
    || (Number(!b.archivedAt) - Number(!a.archivedAt))
    || (t(a.createdAt) - t(b.createdAt)))[0];
}

/**
 * The existing service an import row stands for, or null (= create it).
 *  1. same name in the same category;
 *  2. the row names no category → the one service with that name, if only one;
 *  3. the row names a category the matching service never had (it has none) → that one, if only one.
 */
export function matchService<T extends ExistingService>(existing: T[], row: { name: string; category?: string | null }): T | null {
  const name = serviceKey(row.name);
  if (!name) return null;
  const cat = serviceKey(row.category);
  const same = existing.filter((s) => serviceKey(s.name) === name);
  if (!same.length) return null;
  const inCat = same.filter((s) => serviceKey(s.categoryName) === cat);
  if (inCat.length) return best(inCat);
  if (!cat) return same.length === 1 ? same[0] : null;
  const uncategorised = same.filter((s) => !serviceKey(s.categoryName));
  if (uncategorised.length === 1 && same.length === 1) return uncategorised[0];
  return null;
}

export interface ImportFields {
  priceCents?: number;
  durationMinutes?: number;
  priceFrom?: boolean;
  description?: string | null;
  imageUrl?: string | null;
  turnValue?: number;
  walkInOnly?: boolean;
}

/** What an update would change on a matched service — empty when the file says the same thing. */
export function serviceChanges(cur: ImportFields & { isActive?: boolean | null; archivedAt?: unknown; categoryId?: string | null }, next: ImportFields & { categoryId?: string | null }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (next.priceCents !== undefined && next.priceCents !== cur.priceCents) out.priceCents = next.priceCents;
  if (next.durationMinutes !== undefined && next.durationMinutes !== cur.durationMinutes) out.durationMinutes = next.durationMinutes;
  if (next.priceFrom !== undefined && Boolean(next.priceFrom) !== Boolean(cur.priceFrom)) out.priceFrom = Boolean(next.priceFrom);
  if (next.description && next.description !== (cur.description ?? null)) out.description = next.description;
  if (next.imageUrl && next.imageUrl !== (cur.imageUrl ?? null)) out.imageUrl = next.imageUrl;
  if (next.turnValue !== undefined && next.turnValue !== cur.turnValue) out.turnValue = next.turnValue;
  if (next.walkInOnly !== undefined && Boolean(next.walkInOnly) !== Boolean(cur.walkInOnly)) out.walkInOnly = Boolean(next.walkInOnly);
  if (next.categoryId && !cur.categoryId) out.categoryId = next.categoryId;
  // A service deleted earlier (archived because it had bookings) is back on the
  // menu when the file lists it again. One the owner merely switched off stays off.
  if (cur.archivedAt) { out.archivedAt = null; out.isActive = true; }
  return out;
}
