/**
 * Notes and coins a drawer is counted in, per currency, in minor units
 * (đồng have none, dollars are in cents), and the total of a count.
 */

const NOTES: Record<string, number[]> = {
  // minor units: đồng have none, dollars are in cents
  VND: [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000],
  USD: [10000, 5000, 2000, 1000, 500, 100, 25, 10, 5, 1],
  CAD: [10000, 5000, 2000, 1000, 500, 200, 100, 25, 10, 5],
};

export function denominationsFor(currency: string): number[] {
  return NOTES[(currency || 'USD').toUpperCase()] ?? NOTES.USD;
}

export function countTotal(counts: Record<number, number>): number {
  return Object.entries(counts).reduce((s, [v, n]) => s + Number(v) * (Number(n) || 0), 0);
}
