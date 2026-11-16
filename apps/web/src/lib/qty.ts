/** Most a single restaurant bill line can hold (the API's cap). */
export const QTY_MAX = 999;

/** A typed quantity, cleaned: whole number 0–999, or null when nothing numeric was typed. 0 removes the dish. */
export function cleanQty(raw: string): number | null {
  const t = raw.replace(/[^0-9]/g, '');
  if (!t) return null;
  return Math.min(QTY_MAX, Number(t));
}
