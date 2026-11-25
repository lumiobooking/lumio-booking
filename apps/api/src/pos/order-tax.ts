/**
 * rt238 — VAT / sales tax per salon, on retail and (when the salon charges it) on services.
 *
 * Until now Lumio taxed retail only, because nail services are tax-exempt
 * in many US states. But some salons have to charge it on services too:
 * VAT in Vietnam, services taxed in a few US states, GST/HST in Canada. Each
 * salon sets two rates of its own (Settings › Payments › Tax / VAT):
 *   - taxRatePercent         retail products (unchanged)
 *   - serviceTaxRatePercent  services; 0 = services are not taxed (the default)
 * Tax is worked out on each line after its own discount, as before. It is
 * never charged on the tip.
 *
 * Pure — the till screen (apps/web pos page) uses the same sums.
 */
export interface TaxLine { kind: 'SERVICE' | 'PRODUCT' | string; lineTotalCents: number }

export function cleanRate(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(30, Math.round(n * 1000) / 1000);
}

export function orderTax(lines: TaxLine[], productRate: number, serviceRate: number): { taxCents: number; productTaxCents: number; serviceTaxCents: number } {
  let product = 0;
  let service = 0;
  for (const l of lines) {
    const v = Math.max(0, Math.round(l.lineTotalCents || 0));
    if (l.kind === 'PRODUCT') product += v; else if (l.kind === 'SERVICE') service += v;
  }
  const productTaxCents = Math.round((product * cleanRate(productRate)) / 100);
  const serviceTaxCents = Math.round((service * cleanRate(serviceRate)) / 100);
  return { taxCents: productTaxCents + serviceTaxCents, productTaxCents, serviceTaxCents };
}
