import { SettingsService } from './settings.service';
import { currencyCode, formatMoney, moneyLookOnChange, salonMoneyCurrency } from '../common/money';

/**
 * One currency per salon (13/11/2026). Fremantle Nail Spa is set to AUD, its
 * 56 services were still labelled USD, and a client's confirmation read
 * "USD 75.00". The label follows the salon; no amount ever moves.
 */
type Row = Record<string, unknown>;

describe('the currency a booking is made and shown in', () => {
  it("is the salon's when only the label differs", () => {
    expect(salonMoneyCurrency('USD', 'AUD')).toBe('AUD');
    expect(salonMoneyCurrency('USD', 'cad')).toBe('CAD');
    expect(formatMoney(7500, salonMoneyCurrency('USD', 'AUD'), 'en-AU')).toBe('$75.00');
    // What the client used to get:
    expect(formatMoney(7500, 'USD', 'en-AU')).toMatch(/^USD\s75\.00$/);
  });
  it('stays as stored when the salon has no usable setting', () => {
    expect(salonMoneyCurrency('USD', undefined)).toBe('USD');
    expect(salonMoneyCurrency('USD', 'dollars')).toBe('USD');
    expect(salonMoneyCurrency(null, null)).toBe('USD');
    expect(currencyCode(' aud ')).toBe('AUD');
  });
  it("is the salon's across different minor units too — the menu is typed in the salon's currency", () => {
    // A đồng salon types 350000 on its menu; the row is stored 350000 with a
    // stale USD label. The client must read 350.000 ₫, never $3,500.00.
    expect(salonMoneyCurrency('USD', 'VND')).toBe('VND');
    expect(salonMoneyCurrency('VND', 'USD')).toBe('USD');
    expect(formatMoney(350000, salonMoneyCurrency('USD', 'VND'), 'vi-VN')).toMatch(/^350\.000\s₫$/);
  });
});

describe('the price display when the currency is changed in Settings', () => {
  const aud = { currency: 'AUD', currencySymbol: '$', symbolPosition: 'before' as const, priceDecimals: 2 };
  it('drops the old symbol and decimals when the form sends them along untouched', () => {
    expect(moneyLookOnChange(aud, { currency: 'VND', currencySymbol: '$', symbolPosition: 'before', priceDecimals: 2 }))
      .toEqual({ currency: 'VND', currencySymbol: '', symbolPosition: 'after', priceDecimals: 0 });
    expect(moneyLookOnChange({ currency: 'VND', currencySymbol: '₫', symbolPosition: 'after', priceDecimals: 0 }, { currency: 'AUD', currencySymbol: '₫', symbolPosition: 'after', priceDecimals: 0 }))
      .toEqual({ currency: 'AUD', currencySymbol: '', symbolPosition: 'before', priceDecimals: 2 });
  });
  it('keeps the decimals and the side between two-decimal currencies, and what the owner changed in the same save', () => {
    expect(moneyLookOnChange({ ...aud, currency: 'USD', priceDecimals: 0 }, { currency: 'AUD', currencySymbol: '$', priceDecimals: 0 }))
      .toEqual({ currency: 'AUD', currencySymbol: '', symbolPosition: 'before', priceDecimals: 0 });
    expect(moneyLookOnChange(aud, { currency: 'EUR', currencySymbol: '€', symbolPosition: 'after', priceDecimals: 2 }))
      .toEqual({ currency: 'EUR', currencySymbol: '€', symbolPosition: 'after', priceDecimals: 2 });
  });
  it('changes nothing when the currency stays', () => {
    expect(moneyLookOnChange(aud, { currencySymbol: '$', priceDecimals: 2 })).toEqual(aud);
    expect(moneyLookOnChange(aud, {})).toEqual(aud);
    expect(moneyLookOnChange(aud, { currency: 'nonsense' })).toEqual(aud);
  });
});

function world() {
  const past = new Date(Date.now() - 86_400_000), ahead = new Date(Date.now() + 86_400_000);
  const tables: Record<string, Row[]> = {
    service: [
      { id: 's1', tenantId: 'A', currency: 'USD', priceCents: 7500 },
      { id: 's2', tenantId: 'A', currency: 'AUD', priceCents: 4000 },
      { id: 's3', tenantId: 'B', currency: 'USD', priceCents: 5000 },
      { id: 's4', tenantId: 'V', currency: 'USD', priceCents: 20000000 },
    ],
    serviceAddon: [{ id: 'a1', tenantId: 'A', currency: 'USD', priceCents: 500 }],
    product: [{ id: 'r1', tenantId: 'A', currency: 'USD', priceCents: 1800 }, { id: 'rb', tenantId: 'B', currency: 'USD', priceCents: 900 }],
    payment: [
      { id: 'y1', tenantId: 'A', currency: 'USD', priceCents: 2000, status: 'PENDING', appointment: { startTime: ahead } },
      { id: 'y2', tenantId: 'A', currency: 'USD', priceCents: 2000, status: 'PAID', appointment: { startTime: ahead } },
      { id: 'y3', tenantId: 'A', currency: 'USD', priceCents: 2000, status: 'PENDING', appointment: { startTime: past } },
      { id: 'y4', tenantId: 'A', currency: 'USD', priceCents: 2000, status: 'PENDING', appointment: null },
    ],
    appointment: [
      { id: 'p1', tenantId: 'A', currency: 'USD', priceCents: 7500, startTime: ahead },
      { id: 'p0', tenantId: 'A', currency: 'USD', priceCents: 7500, startTime: past },
      { id: 'pb', tenantId: 'B', currency: 'USD', priceCents: 5000, startTime: ahead },
    ],
  };
  const hit = (r: Row | null, where: Row): boolean => !!r && Object.entries(where).every(([k, v]) => {
    const o = v as { not?: unknown; in?: unknown[]; gte?: Date } | null;
    if (o && typeof o === 'object' && 'not' in o) return r[k] !== o.not;
    if (o && typeof o === 'object' && 'in' in o) return o.in!.includes(r[k]);
    if (o && typeof o === 'object' && 'gte' in o) return (r[k] as Date) >= o.gte!;
    if (o && typeof o === 'object' && !(o instanceof Date)) return hit(r[k] as Row | null, o as Row);
    return r[k] === v;
  });
  const model = (name: string) => ({
    findMany: async ({ where }: { where: Row }) => [...new Set(tables[name].filter((r) => hit(r, where)).map((r) => r.currency))].map((currency) => ({ currency })),
    updateMany: async ({ where, data }: { where: Row; data: Row }) => { const rows = tables[name].filter((r) => hit(r, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length }; },
  });
  const settings: Row[] = [
    { tenantId: 'A', key: 'booking_rules', value: { currency: 'AUD' } },
    { tenantId: 'B', key: 'booking_rules', value: {} },
    { tenantId: 'V', key: 'booking_rules', value: { currency: 'VND' } },
  ];
  const prisma = { service: model('service'), serviceAddon: model('serviceAddon'), product: model('product'), payment: model('payment'), appointment: model('appointment'), setting: { findMany: async () => settings } };
  const logged: Row[] = [];
  const svc = new SettingsService(prisma as never, { log: async (x: Row) => { logged.push(x); } } as never);
  return { svc, tables, logged };
}
const cur = (rows: Row[], id: string) => rows.find((r) => r.id === id)!.currency;

describe("aligning a salon's currency labels with its setting", () => {
  it("relabels that salon's services, extras, products, bookings ahead and their unpaid rows — and nothing else", async () => {
    const { svc, tables, logged } = world();
    const before = JSON.stringify(Object.values(tables).flat().map((r) => r.priceCents));
    expect(await svc.alignMoneyLabels('A', 'AUD', 'u1')).toBe(5);
    expect(cur(tables.service, 's1')).toBe('AUD');
    expect(cur(tables.serviceAddon, 'a1')).toBe('AUD');
    expect(cur(tables.product, 'r1')).toBe('AUD');
    expect(cur(tables.appointment, 'p1')).toBe('AUD');
    expect(cur(tables.payment, 'y1')).toBe('AUD');
    // A booking already past, money already taken, and rows tied to no coming booking keep theirs.
    expect(cur(tables.appointment, 'p0')).toBe('USD');
    expect(cur(tables.payment, 'y2')).toBe('USD');
    expect(cur(tables.payment, 'y3')).toBe('USD');
    expect(cur(tables.payment, 'y4')).toBe('USD');
    // Another salon is not touched.
    expect(cur(tables.service, 's3')).toBe('USD');
    expect(cur(tables.product, 'rb')).toBe('USD');
    expect(cur(tables.appointment, 'pb')).toBe('USD');
    // No amount moved.
    expect(JSON.stringify(Object.values(tables).flat().map((r) => r.priceCents))).toBe(before);
    expect(logged).toEqual([expect.objectContaining({ tenantId: 'A', action: 'settings.currency_labels_aligned', metadata: expect.objectContaining({ currency: 'AUD', rows: 5, service: 1, product: 1 }) })]);
    // Running it again changes nothing and logs nothing.
    expect(await svc.alignMoneyLabels('A', 'AUD')).toBe(0);
    expect(logged).toHaveLength(1);
  });

  it('switching again follows again — AUD, then CAD, then back', async () => {
    const { svc, tables } = world();
    await svc.alignMoneyLabels('A', 'AUD');
    expect(await svc.alignMoneyLabels('A', 'CAD')).toBe(6);
    expect(tables.service.filter((r) => r.tenantId === 'A').map((r) => r.currency)).toEqual(['CAD', 'CAD']);
    await svc.alignMoneyLabels('A', 'AUD');
    expect(tables.service.filter((r) => r.tenantId === 'A').map((r) => r.currency)).toEqual(['AUD', 'AUD']);
  });

  it('the start-up pass fixes every salon that names a currency, leaves the one with no setting, and never changes an amount', async () => {
    const { svc, tables } = world();
    expect(await svc.alignAllMoneyLabels()).toBe(2);
    expect(cur(tables.service, 's1')).toBe('AUD');
    expect(cur(tables.service, 's3')).toBe('USD');
    expect(cur(tables.service, 's4')).toBe('VND');
    expect(tables.service.find((r) => r.id === 's4')!.priceCents).toBe(20000000);
  });

  it('a table that fails does not stop the others', async () => {
    const { svc, tables } = world();
    (svc as unknown as { prisma: Record<string, { updateMany: () => Promise<never> }> }).prisma.product.updateMany = async () => { throw new Error('boom'); };
    expect(await svc.alignMoneyLabels('A', 'AUD')).toBe(4);
    expect(cur(tables.service, 's1')).toBe('AUD');
  });
});
