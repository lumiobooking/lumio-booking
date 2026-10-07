/**
 * The record each line of business keeps on a customer: validated against
 * the salon's own industry, written to that salon's customer only.
 */
import { cleanIndustryFields, fieldsFor, INDUSTRY_FIELDS, warnings } from './industry-fields';
import { INDUSTRIES } from './industry';
import { CustomersService } from '../customers/customers.service';

describe('fields per industry', () => {
  it('every industry has its own record', () => {
    for (const i of INDUSTRIES) expect(INDUSTRY_FIELDS[i.key]?.fields.length).toBeGreaterThan(0);
    expect(fieldsFor('DENTAL').title.vi).toBe('Hồ sơ bệnh nhân');
    expect(fieldsFor('REAL_ESTATE').pipeline).toBe('stage');
    expect(fieldsFor('nonsense')).toBe(INDUSTRY_FIELDS.NAIL);
  });

  it('keeps only the industry’s own keys, valid values, and clears on empty', () => {
    const cur = { allergies: 'latex', lashMap: 'C 11mm' }; // a lash key stays if the salon changed industry
    const out = cleanIndustryFields('DENTAL', {
      allergies: '  penicillin ', medical: 'x'.repeat(3000), recallMonths: '6', lastXray: '2026-09-01',
      stage: 'won', hacked: '<script>', insurance: '',
    }, cur);
    expect(out).toEqual({ allergies: 'penicillin', lashMap: 'C 11mm', medical: 'x'.repeat(2000), recallMonths: 6, lastXray: '2026-09-01' });
    expect(cleanIndustryFields('REAL_ESTATE', { stage: 'won', intent: 'steal' }, {})).toEqual({ stage: 'won' });
    expect(cleanIndustryFields('DENTAL', { lastXray: 'yesterday', recallMonths: -3 }, {})).toEqual({});
  });

  it('flags allergies and health notes that have something written', () => {
    expect(warnings('DENTAL', { allergies: 'latex', insurance: 'Delta' }).map((w) => w.value)).toEqual(['latex']);
    expect(warnings('REAL_ESTATE', { budget: '500k' })).toEqual([]);
  });
});

describe('saving it, per salon', () => {
  function make(industry: string) {
    const rows: Record<string, any> = { // eslint-disable-line @typescript-eslint/no-explicit-any
      c1: { id: 'c1', tenantId: 'A', industryFields: { allergies: 'old' } },
      c2: { id: 'c2', tenantId: 'B', industryFields: {} },
    };
    const prisma: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
      customer: {
        findFirst: jest.fn(async ({ where }: any) => { const r = rows[where.id]; return r && r.tenantId === where.tenantId ? r : null; }), // eslint-disable-line @typescript-eslint/no-explicit-any
        updateMany: jest.fn(async ({ where, data }: any) => { const r = rows[where.id]; if (r && r.tenantId === where.tenantId) Object.assign(r, data); return { count: r ? 1 : 0 }; }), // eslint-disable-line @typescript-eslint/no-explicit-any
      },
      tenant: { findUnique: jest.fn(async () => ({ businessType: industry === 'DENTAL' ? 'SERVICE' : 'SALON' })) },
      setting: { findUnique: jest.fn(async () => ({ value: { key: industry } })) },
    };
    const svc = new CustomersService(prisma, { log: jest.fn(async () => undefined) } as never, {} as never);
    (svc as unknown as { getById: () => Promise<unknown> }).getById = async () => ({});
    return { svc, rows };
  }
  const owner = (t: string) => ({ userId: `u-${t}`, role: 'SALON_ADMIN', tenantId: t }) as never;

  it('a clinic writes its patient record, validated', async () => {
    const { svc, rows } = make('DENTAL');
    await svc.update(owner('A'), 'c1', { industryFields: { allergies: 'penicillin', recallMonths: 6, bogus: 1 } });
    expect(rows.c1.industryFields).toEqual({ allergies: 'penicillin', recallMonths: 6 });
  });

  it('another salon’s customer is not found, and nothing is written', async () => {
    const { svc, rows } = make('DENTAL');
    await expect(svc.update(owner('A'), 'c2', { industryFields: { allergies: 'x' } })).rejects.toThrow(/not found/i);
    expect(rows.c2.industryFields).toEqual({});
  });

  it('the form fields come from the caller’s salon', async () => {
    const { svc } = make('REAL_ESTATE');
    const r = await svc.industryFieldDefs(owner('A'));
    expect(r.industry).toBe('NAIL'); // REAL_ESTATE stored but businessType SALON in this fake → resolves to the type's default
  });
});
