import { SettingsService } from './settings.service';
import { currencyCode, formatMoney, salonMoneyCurrency, sameMinorUnits } from '../common/money';

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
  it('is never swapped across different minor units — the amount would change meaning', () => {
    expect(sameMinorUnits('USD', 'VND')).toBe(false);
    expect(salonMoneyCurrency('USD', 'VND')).toBe('USD');
    expect(salonMoneyCurrency('VND', 'USD')).toBe('VND');
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
    appointment: [
      { id: 'p1', tenantId: 'A', currency: 'USD', priceCents: 7500, startTime: ahead },
      { id: 'p0', tenantId: 'A', currency: 'USD', priceCents: 7500, startTime: past },
      { id: 'pb', tenantId: 'B', currency: 'USD', priceCents: 5000, startTime: ahead },
    ],
  };
  const hit = (r: Row, where: Row) => Object.entries(where).every(([k, v]) => {
    const o = v as { not?: unknown; in?: unknown[]; gte?: Date } | null;
    if (o && typeof o === 'object' && 'not' in o) return r[k] !== o.not;
    if (o && typeof o === 'object' && 'in' in o) return o.in!.includes(r[k]);
    if (o && typeof o === 'object' && 'gte' in o) return (r[k] as Date) >= o.gte!;
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
  const prisma = { service: model('service'), serviceAddon: model('serviceAddon'), appointment: model('appointment'), setting: { findMany: async () => settings } };
  const logged: Row[] = [];
  const svc = new SettingsService(prisma as never, { log: async (x: Row) => { logged.push(x); } } as never);
  return { svc, tables, logged };
}
const cur = (rows: Row[], id: string) => rows.find((r) => r.id === id)!.currency;

describe("aligning a salon's stale currency labels", () => {
  it("relabels that salon's services, extras and bookings ahead — and nothing else", async () => {
    const { svc, tables, logged } = world();
    const before = JSON.stringify(Object.values(tables).flat().map((r) => r.priceCents));
    expect(await svc.alignMoneyLabels('A', 'AUD', 'u1')).toBe(3);
    expect(cur(tables.service, 's1')).toBe('AUD');
    expect(cur(tables.serviceAddon, 'a1')).toBe('AUD');
    expect(cur(tables.appointment, 'p1')).toBe('AUD');
    // A booking already past keeps the currency it was made in.
    expect(cur(tables.appointment, 'p0')).toBe('USD');
    // Another salon is not touched.
    expect(cur(tables.service, 's3')).toBe('USD');
    expect(cur(tables.appointment, 'pb')).toBe('USD');
    // No amount moved.
    expect(JSON.stringify(Object.values(tables).flat().map((r) => r.priceCents))).toBe(before);
    expect(logged).toEqual([expect.objectContaining({ tenantId: 'A', action: 'settings.currency_labels_aligned', metadata: { currency: 'AUD', rows: 3 } })]);
    // Running it again changes nothing and logs nothing.
    expect(await svc.alignMoneyLabels('A', 'AUD')).toBe(0);
    expect(logged).toHaveLength(1);
  });

  it('the start-up pass fixes the AUD salon, leaves the salon with no setting, and never relabels USD → VND', async () => {
    const { svc, tables } = world();
    expect(await svc.alignAllMoneyLabels()).toBe(1);
    expect(cur(tables.service, 's1')).toBe('AUD');
    expect(cur(tables.service, 's3')).toBe('USD');
    expect(cur(tables.service, 's4')).toBe('USD');
    expect(tables.service.find((r) => r.id === 's4')!.priceCents).toBe(20000000);
  });
});
