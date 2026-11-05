/**
 * Guest QR ordering helpers (/t/<token>). Pure, so the page's rules are
 * tested without a browser.
 */
import type { CartLine } from './restaurant-till';

/** How many of a dish without options are in the cart (the row's − n + stepper). */
export function quickQty(cart: CartLine[], menuItemId: string): number {
  return cart.filter((c) => c.menuItemId === menuItemId && !c.options.some((o) => o.choiceIds.length) && !c.note.trim()).reduce((s, c) => s + c.quantity, 0);
}

/** The menu as the guest scrolls it: one section per category when showing everything, else one flat list. */
export function menuSections<T extends { category: string | null }>(items: T[], grouped: boolean, otherLabel: string): Array<{ title: string; items: T[] }> {
  if (!grouped) return items.length ? [{ title: '', items }] : [];
  const by = new Map<string, T[]>();
  for (const it of items) { const k = it.category || ''; by.set(k, [...(by.get(k) ?? []), it]); }
  const out = [...by.entries()].map(([k, list]) => ({ title: k || otherLabel, items: list }));
  return out.length === 1 ? [{ title: '', items: out[0].items }] : out;
}

/** Where a dish is in the kitchen: a 4-step bar and its colours (orange → blue → green). */
export function guestProgress(status: 'waiting' | 'ordered' | 'cooking' | 'ready'): { step: number; bar: string; fg: string; bg: string } {
  switch (status) {
    case 'waiting': return { step: 0, bar: '#f59e0b', fg: '#9a3412', bg: '#fff4e5' };
    case 'ordered': return { step: 1, bar: '#3b82f6', fg: '#1d4ed8', bg: '#e8efff' };
    case 'cooking': return { step: 2, bar: '#3b82f6', fg: '#1d4ed8', bg: '#e8efff' };
    default: return { step: 3, bar: '#10b981', fg: '#047857', bg: '#ecfdf5' };
  }
}

const TINTS = [
  { bg: '#fde7d4', fg: '#9a3412' }, { bg: '#d9f2ea', fg: '#0f766e' }, { bg: '#e9e3fb', fg: '#5b21b6' },
  { bg: '#fde2e7', fg: '#9f1239' }, { bg: '#dde8fd', fg: '#1d4ed8' }, { bg: '#e6f2d6', fg: '#3f6212' },
];
/** A dish with no photo gets a calm tile in one of six tints, always the same for the same name. */
export function tintFor(name: string): { bg: string; fg: string } {
  let h = 0;
  for (const ch of String(name ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}
