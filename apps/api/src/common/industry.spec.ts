/**
 * The line of business a salon is in: Nail, Mi, Tóc, Spa, Massage, Nha khoa,
 * Nhà hàng, Quán ăn, Cà phê, Bất động sản, Dịch vụ khác. It decides the words
 * and menu of the salon's own screens, and always agrees with businessType.
 */
import { BadRequestException } from '@nestjs/common';
import { defaultIndustryFor, INDUSTRIES, industryDef, isIndustry, resolveIndustry, writeIndustry } from './industry';
import { personaFor } from './business-persona';
import { SettingsService } from '../settings/settings.service';

function db() {
  const settings = new Map<string, unknown>();
  const tenants = new Map<string, { businessType: string }>([['A', { businessType: 'SALON' }], ['B', { businessType: 'SALON' }]]);
  const services: { tenantId: string; name: string }[] = [];
  const k = (w: any) => `${w.tenantId_key.tenantId}:${w.tenantId_key.key}`; // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    settings, tenants, services,
    setting: {
      findUnique: jest.fn(async ({ where }: any) => (settings.has(k(where)) ? { value: settings.get(k(where)) } : null)), // eslint-disable-line @typescript-eslint/no-explicit-any
      upsert: jest.fn(async ({ where, update, create }: any) => { settings.set(k(where), settings.has(k(where)) ? update.value : create.value); return {}; }), // eslint-disable-line @typescript-eslint/no-explicit-any
    },
    tenant: {
      update: jest.fn(async ({ where, data }: any) => { Object.assign(tenants.get(where.id)!, data); return {}; }), // eslint-disable-line @typescript-eslint/no-explicit-any
      findUnique: jest.fn(async ({ where }: any) => tenants.get(where.id) ?? null), // eslint-disable-line @typescript-eslint/no-explicit-any
    },
    service: {
      count: jest.fn(async ({ where }: any) => services.filter((s) => s.tenantId === where.tenantId).length), // eslint-disable-line @typescript-eslint/no-explicit-any
      create: jest.fn(async ({ data }: any) => { services.push(data); return data; }), // eslint-disable-line @typescript-eslint/no-explicit-any
    },
  };
}

describe('the industry list', () => {
  it('offers every line of business the owner asked for, each on one businessType', () => {
    expect(INDUSTRIES.map((i) => i.key)).toEqual(['NAIL', 'LASH', 'HAIR', 'SPA', 'MASSAGE', 'DENTAL', 'RESTAURANT', 'FAST_FOOD', 'CAFE', 'REAL_ESTATE', 'SERVICE']);
    expect(industryDef('DENTAL')!.businessType).toBe('SERVICE');
    expect(industryDef('CAFE')!.businessType).toBe('RESTAURANT');
    expect(industryDef('LASH')!.businessType).toBe('SALON');
    expect(isIndustry('lash')).toBe(true);
    expect(isIndustry('PLUMBER')).toBe(false);
  });

  it('a salon that never chose stays NAIL — today’s screens, unchanged', () => {
    expect(defaultIndustryFor('SALON')).toBe('NAIL');
    expect(resolveIndustry(null, 'SALON')).toBe('NAIL');
    expect(resolveIndustry(null, 'RESTAURANT')).toBe('RESTAURANT');
  });

  it('a stored choice that no longer matches the businessType gives way to the type', () => {
    expect(resolveIndustry({ key: 'LASH' }, 'SALON')).toBe('LASH');
    expect(resolveIndustry({ key: 'LASH' }, 'RESTAURANT')).toBe('RESTAURANT'); // type changed elsewhere
    expect(resolveIndustry({ key: 'nonsense' }, 'SERVICE')).toBe('SERVICE');
  });

  it('a dental clinic’s AI is a dental clinic, never a nail salon', () => {
    expect(personaFor('SERVICE', 'DENTAL').identity).toBe('a dental clinic');
    expect(personaFor('SERVICE', 'DENTAL').voiceGoal).not.toMatch(/nail/i);
  });
});

describe('putting a salon in an industry', () => {
  it('moves the setting, the businessType and the marketing trade — for that salon only', async () => {
    const d = db();
    d.settings.set('A:business_profile', { whatWeDo: 'We fix teeth', trade: 'NAIL', tradeSource: 'auto' });
    await writeIndustry(d as never, 'A', 'DENTAL');
    expect(d.settings.get('A:industry')).toEqual({ key: 'DENTAL' });
    expect(d.tenants.get('A')!.businessType).toBe('SERVICE');
    expect(d.settings.get('A:business_profile')).toEqual({ whatWeDo: 'We fix teeth', trade: 'DENTAL', tradeSource: 'manual' });
    expect(d.tenants.get('B')!.businessType).toBe('SALON');
    expect(d.settings.has('B:industry')).toBe(false);
  });

  it('a restaurant with no services gets a first bookable one', async () => {
    const d = db();
    await writeIndustry(d as never, 'A', 'CAFE');
    expect(d.services).toEqual([expect.objectContaining({ tenantId: 'A', name: 'Table reservation' })]);
  });
});

describe('the owner changes it in Settings', () => {
  const make = () => {
    const d = db();
    const audit = { log: jest.fn(async () => undefined) };
    return { d, audit, svc: new SettingsService(d as never, audit as never) };
  };
  const owner = (t: string) => ({ userId: `u-${t}`, role: 'SALON_ADMIN', tenantId: t }) as never;

  it('saves THEIR salon (tenant from the token) and audits it', async () => {
    const { d, audit, svc } = make();
    const r = await svc.updateIndustry(owner('A'), 'lash');
    expect(r.industry).toBe('LASH');
    expect(d.settings.get('A:industry')).toEqual({ key: 'LASH' });
    expect(d.settings.has('B:industry')).toBe(false);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'A', action: 'settings.industry_updated' }));
    expect((await svc.getIndustryFor(owner('B'))).industry).toBe('NAIL');
  });

  it('refuses an unknown industry', async () => {
    const { svc } = make();
    await expect(svc.updateIndustry(owner('A'), 'PLUMBER')).rejects.toThrow(BadRequestException);
  });
});
