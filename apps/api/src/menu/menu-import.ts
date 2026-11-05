/**
 * IMPORT A WHOLE MENU FROM A SHEET (Nov 2026: "phần nhập thực đơn chưa có
 * template mẫu để làm theo và import").
 *
 * The screen reads the owner's Excel / CSV (template from the screen), turns
 * prices into minor units in the restaurant's currency and option text into
 * groups, and sends the rows here. This decides, per row, what happens:
 *
 *   new        — no dish by that name (in that category) yet → created
 *   update     — the restaurant has it → its price / description / photo /
 *                options / category are replaced by the sheet's
 *   same       — the sheet says exactly what the menu already says → untouched
 *   duplicate  — the same dish twice in the sheet → the second is skipped
 *   error      — no name, or no price
 *
 * Importing the same file twice therefore changes nothing, and correcting a
 * price in the sheet and importing again updates that one dish instead of
 * adding a copy of it. Pure — the service applies the plan, tenant-scoped.
 */
import { cleanOptionGroups, type OptionGroup } from '../restaurant/check-logic';

export const MAX_MENU_IMPORT = 500;

export interface MenuImportRow {
  name: string;
  category?: string | null;
  priceCents: number;
  description?: string | null;
  imageUrl?: string | null;
  options?: unknown;
  sortOrder?: number | null;
}

export interface MenuExisting {
  id: string;
  name: string;
  category: string | null;
  priceCents: number;
  description: string | null;
  imageUrl: string | null;
  options: unknown;
  sortOrder: number;
}

export interface MenuPlan {
  create: Array<{ name: string; category: string | null; priceCents: number; description: string | null; imageUrl: string | null; options: OptionGroup[]; sortOrder: number }>;
  update: Array<{ id: string; data: Partial<{ category: string | null; priceCents: number; description: string | null; imageUrl: string | null; options: OptionGroup[]; sortOrder: number }> }>;
  same: number;
  duplicate: number;
  error: number;
}

/** "Phở Bò Tái", "pho bo tai " → one key. */
export function dishKey(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const text = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return s ? s.slice(0, max) : null;
};

/** Only a web address is a photo here; anything else in the column is ignored, never stored. */
const photo = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^https?:\/\/\S+$/i.test(s) && s.length <= 2000 ? s : null;
};

/** Same groups, same choices, same prices, same rules — ids aside (the app's editor makes its own). */
export const optionsShape = (g: OptionGroup[]) => JSON.stringify(g.map((x) => [x.name, x.required, x.max, x.choices.map((c) => [c.name, c.priceCents])]));
const sameOptions = (a: unknown, b: OptionGroup[]) => optionsShape(cleanOptionGroups(a)) === optionsShape(b);

/**
 * The menu as it is + the sheet's rows → what to create, what to change.
 * A dish matches by name within its category; failing that, by name alone
 * when exactly one dish carries it (the sheet moved it to another category).
 */
export function planMenuImport(existing: MenuExisting[], rows: MenuImportRow[]): MenuPlan {
  const plan: MenuPlan = { create: [], update: [], same: 0, duplicate: 0, error: 0 };
  const seen = new Set<string>();
  const touched = new Set<string>();
  rows.slice(0, MAX_MENU_IMPORT).forEach((r, i) => {
    const name = text(r?.name, 120);
    const price = Math.round(Number(r?.priceCents));
    if (!name || !Number.isFinite(price) || price < 0) { plan.error += 1; return; }
    const category = text(r.category, 60);
    const key = `${dishKey(category)}|${dishKey(name)}`;
    if (seen.has(key)) { plan.duplicate += 1; return; }
    seen.add(key);
    const description = text(r.description, 500);
    const imageUrl = photo(r.imageUrl);
    const options = r.options === undefined || r.options === null ? null : cleanOptionGroups(r.options);
    const sortOrder = Number.isFinite(Number(r.sortOrder)) && r.sortOrder !== null && r.sortOrder !== undefined ? Math.round(Number(r.sortOrder)) : null;

    const byName = existing.filter((e) => dishKey(e.name) === dishKey(name) && !touched.has(e.id));
    const hit = byName.find((e) => dishKey(e.category) === dishKey(category)) ?? (byName.length === 1 ? byName[0] : undefined);
    if (!hit) {
      plan.create.push({ name, category, priceCents: price, description, imageUrl, options: options ?? [], sortOrder: sortOrder ?? i });
      return;
    }
    touched.add(hit.id);
    // A blank cell keeps what the dish has: an empty Description column does
    // not wipe the descriptions typed in the app, nor an empty photo column the photos.
    const data: MenuPlan['update'][number]['data'] = {};
    if ((hit.category ?? null) !== category) data.category = category;
    if (hit.priceCents !== price) data.priceCents = price;
    if (description !== null && description !== (hit.description ?? null)) data.description = description;
    if (imageUrl !== null && imageUrl !== (hit.imageUrl ?? null)) data.imageUrl = imageUrl;
    if (options !== null && !sameOptions(hit.options, options)) data.options = options;
    if (sortOrder !== null && sortOrder !== hit.sortOrder) data.sortOrder = sortOrder;
    if (Object.keys(data).length) plan.update.push({ id: hit.id, data });
    else plan.same += 1;
  });
  return plan;
}
