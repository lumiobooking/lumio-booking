/**
 * Menu categories as their own list (10/11/2026, Nẩu Chill: "thực đơn chưa
 * có mục tạo danh mục"). A dish still carries its category as text; this list
 * adds what text alone cannot: a category with no dish yet, and the ORDER the
 * menu, the till and the guest QR menu show them in.
 */

export const MENU_CATEGORIES_KEY = 'menu_categories';

/** Same rule as the till's station mapping: case, accents kept, spaces folded. */
export function catKey(cat: unknown): string {
  return String(cat ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
}

export function cleanCategoryName(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** A stored or sent list: names, no blanks, no duplicates (loosely), at most 200. */
export function cleanCategoryList(raw: unknown): string[] {
  const src = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && Array.isArray((raw as { names?: unknown }).names) ? (raw as { names: unknown[] }).names : []);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of src) {
    const n = cleanCategoryName(x);
    const k = catKey(n);
    if (!n || seen.has(k)) continue;
    seen.add(k); out.push(n);
    if (out.length >= 200) break;
  }
  return out;
}

/** Every category: the owner's list in its order, then any only dishes name (A–Z). */
export function allCategories(stored: string[], dishCategories: (string | null | undefined)[]): string[] {
  const out = [...stored];
  const seen = new Set(stored.map(catKey));
  const extra = [...new Set(dishCategories.map(cleanCategoryName).filter(Boolean))]
    .filter((c) => !seen.has(catKey(c)))
    .sort((a, b) => a.localeCompare(b, 'vi'));
  for (const c of extra) { if (!seen.has(catKey(c))) { seen.add(catKey(c)); out.push(c); } }
  return out;
}

/** Dishes in the menu's category order (dishes with no category last), keeping their order inside a category. */
export function orderByCategories<T extends { category: string | null }>(items: T[], order: string[]): T[] {
  const rank = new Map(order.map((c, i) => [catKey(c), i]));
  const at = (c: string | null) => (c && rank.has(catKey(c)) ? rank.get(catKey(c))! : c ? order.length : order.length + 1);
  return items.map((it, i) => ({ it, i })).sort((a, b) => at(a.it.category) - at(b.it.category) || a.i - b.i).map((x) => x.it);
}
