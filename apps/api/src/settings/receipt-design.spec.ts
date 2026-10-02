import { SettingsService } from './settings.service';
import { cleanReceiptDesign, DEFAULT_RECEIPT_DESIGN } from './settings.constants';

/**
 * The printed bill is the owner's to design — within limits: the salon's
 * name, address and phone are always on it, and one salon's design never
 * reaches another salon's till.
 */

type Row = { tenantId: string; key: string; value: unknown };

function makeSvc(rows: Row[] = []) {
  const db = [...rows];
  const tenants: Record<string, { name: string; slug: string; contactPhone: string | null; branding: unknown }> = {
    t1: { name: 'Lumio Nails', slug: 'lumio-nails', contactPhone: '(631) 320-3255', branding: { logoUrl: 'https://cdn.test/logo.png' } },
    t2: { name: 'Other Spa', slug: 'other-spa', contactPhone: '(212) 555-0000', branding: {} },
  };
  const prisma = {
    setting: {
      findUnique: async ({ where }: { where: { tenantId_key: { tenantId: string; key: string } } }) =>
        db.find((r) => r.tenantId === where.tenantId_key.tenantId && r.key === where.tenantId_key.key) ?? null,
      upsert: async ({ where, update, create }: { where: { tenantId_key: { tenantId: string; key: string } }; update: { value: unknown }; create: Row }) => {
        const hit = db.find((r) => r.tenantId === where.tenantId_key.tenantId && r.key === where.tenantId_key.key);
        if (hit) hit.value = update.value; else db.push({ ...create });
        return {};
      },
    },
    tenant: { findUnique: async ({ where }: { where: { id: string } }) => tenants[where.id] ?? null },
  };
  const svc = new SettingsService(prisma as never, { log: jest.fn() } as never);
  (svc as unknown as { get: unknown }).get = async () => ({});
  return { svc, db };
}
const owner = (tenantId: string) => ({ userId: 'u-' + tenantId, tenantId, role: 'SALON_ADMIN' } as never);

describe('cleaning a design', () => {
  it('keeps only known fields, trims text and rejects bad choices', () => {
    const d = cleanReceiptDesign({ title: '  HOÁ ĐƠN  ', language: 'fr', paper: '110', fontSize: 'large', showLogo: false, hacker: 'x', headerNote: 'a'.repeat(999) });
    expect(d.title).toBe('HOÁ ĐƠN');
    expect(d.language).toBe('en');
    expect(d.paper).toBe('80');
    expect(d.fontSize).toBe('large');
    expect(d.showLogo).toBe(false);
    expect(d.headerNote).toHaveLength(300);
    expect((d as unknown as Record<string, unknown>).hacker).toBeUndefined();
  });
  it('a salon that never opened the editor gets the full default bill', () => {
    expect(cleanReceiptDesign(undefined)).toEqual(DEFAULT_RECEIPT_DESIGN);
  });
});

describe('the till’s receipt profile', () => {
  it('always carries the salon’s name, address and phone', async () => {
    const { svc } = makeSvc([{ tenantId: 't1', key: 'company_extra', value: { address: '12 Main St, Islip NY', website: 'lumionails.com' } }]);
    const p = await svc.receiptProfile('t1');
    expect(p.shop).toMatchObject({ name: 'Lumio Nails', address: '12 Main St, Islip NY', phone: '(631) 320-3255', website: 'lumionails.com', logoUrl: 'https://cdn.test/logo.png', bookingSlug: 'lumio-nails' });
  });

  it('saving the design writes the footer to the ONE footer the till prints', async () => {
    const { svc, db } = makeSvc();
    await svc.updateReceipt(owner('t1'), { language: 'vi', paper: '58', showTechnician: false, footer: ' Cảm ơn quý khách! ' });
    const p = await svc.receiptProfile('t1');
    expect(p.design).toMatchObject({ language: 'vi', paper: '58', showTechnician: false, footer: 'Cảm ơn quý khách!' });
    expect((db.find((r) => r.key === 'pos_settings')!.value as { receiptFooter: string }).receiptFooter).toBe('Cảm ơn quý khách!');
  });

  it('one salon’s design never reaches another salon’s till', async () => {
    const { svc } = makeSvc();
    await svc.updateReceipt(owner('t1'), { title: 'LUMIO BILL', footer: 'Lumio only' });
    const other = await svc.receiptProfile('t2');
    expect(other.design.title).toBe('');
    expect(other.design.footer).toBe('');
    expect(other.shop.name).toBe('Other Spa');
  });
});
