/**
 * GỌI MÓN TRƯỚC — dishes a guest orders with the reservation.
 *
 * The page sends only menu ids and quantities; names and prices come from
 * THIS restaurant's active menu on the server, so a guest can never invent a
 * dish, a price, or reach another restaurant's menu. Informational: the
 * kitchen and the host see it; the bill is still made at the table. Pure.
 */
export interface PreOrderIn { menuItemId: string; qty: number }
export interface MenuRow { id: string; name: string; priceCents: number }
export interface PreOrderLine { id: string; name: string; qty: number; priceCents: number }

export const MAX_LINES = 40;
export const MAX_QTY = 50;

export function buildPreOrder(input: PreOrderIn[] | null | undefined, menu: MenuRow[]): PreOrderLine[] {
  const byId = new Map(menu.map((m) => [m.id, m]));
  const qty = new Map<string, number>();
  for (const l of (input ?? []).slice(0, MAX_LINES * 2)) {
    const m = byId.get(String(l?.menuItemId ?? ''));
    const q = Math.round(Number(l?.qty));
    if (!m || !Number.isFinite(q) || q < 1) continue;
    qty.set(m.id, Math.min(MAX_QTY, (qty.get(m.id) ?? 0) + q));
  }
  return [...qty.entries()].slice(0, MAX_LINES).map(([id, q]) => {
    const m = byId.get(id) as MenuRow;
    return { id, name: m.name, qty: q, priceCents: m.priceCents };
  });
}

/** "2× Phở bò, 1× Gỏi cuốn" for the notes the desk already reads everywhere. */
export function preOrderText(lines: PreOrderLine[]): string {
  return lines.map((l) => `${l.qty}× ${l.name}`).join(', ');
}

export function preOrderTotal(lines: PreOrderLine[]): number {
  return lines.reduce((s, l) => s + l.qty * l.priceCents, 0);
}
