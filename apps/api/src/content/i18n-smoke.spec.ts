/**
 * One end-to-end look at the shape the screen actually receives.
 *
 * The per-file specs prove each builder speaks both languages. This one proves
 * the ASSEMBLY does: that a plan-sized object rendered with localizeDeep comes
 * out as strings on both sides, with no `{vi,en}` pair left embedded and no
 * `[object Object]` where a template literal met a bilingual value.
 */
import { localizeDeep, isBi } from './i18n';
import { pickStage } from './roadmap';
import { buildWeekPlan } from './weekly-plan';
import { resolveIdentity } from './business-profile';
import { regionEvents } from './region-events';
import { resolveShopLocation } from './shop-location';
import { weekLabel } from './week-key';

function leaves(v: unknown, path = '', out: { path: string; value: unknown }[] = []) {
  if (v === null || v === undefined) return out;
  if (Array.isArray(v)) { v.forEach((x, i) => leaves(x, `${path}[${i}]`, out)); return out; }
  if (v instanceof Date) return out;
  if (typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) leaves(val, `${path}.${k}`, out);
    return out;
  }
  out.push({ path, value: v });
  return out;
}

const VIETNAMESE = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđĐ]/;

describe('the plan renders whole in either language', () => {
  const stage = pickStage({ reviewCount: 3, postedLast30: 1, lapsedCount: 40, customerCount: 120, hasQuietSlot: true });
  const events = regionEvents(new Date('2026-09-01T12:00:00Z'), { market: 'US', city: 'Austin', region: 'TX' }, { horizonDays: 60 }).events;
  const identity = resolveIdentity({
    tenantName: 'Lumio Agency', industry: 'SERVICE', website: 'https://lumioagency.com',
    serviceNames: ['a', 'b', 'c'],
  });
  const loc = resolveShopLocation({ city: 'Austin', region: 'TX' });
  const week = buildWeekPlan({
    industry: 'SALON', todayWeekday: 2, loads: [], events, stage, dataThin: true,
  } as unknown as Parameters<typeof buildWeekPlan>[0]);

  const payload = { region: { source: loc.sourceLabel, fix: loc.fix }, identity, events, week, label: weekLabel('2026-W36') };

  it('leaves no bilingual pair unrendered, in either language', () => {
    for (const lang of ['vi', 'en'] as const) {
      const done = localizeDeep(payload, lang);
      const found: string[] = [];
      const walk = (v: unknown, p = '') => {
        if (v === null || v === undefined) return;
        if (isBi(v)) { found.push(p); return; }
        if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${p}[${i}]`));
        if (typeof v === 'object' && !(v instanceof Date)) {
          for (const [k, val] of Object.entries(v as Record<string, unknown>)) walk(val, `${p}.${k}`);
        }
      };
      walk(done);
      expect(found).toEqual([]);
    }
  });

  it('never prints a bilingual value into a sentence', () => {
    for (const lang of ['vi', 'en'] as const) {
      const bad = leaves(localizeDeep(payload, lang)).filter((l) => String(l.value).includes('[object Object]'));
      expect(bad).toEqual([]);
    }
  });

  it('has no Vietnamese left in the English rendering, except the salon own words', () => {
    const en = leaves(localizeDeep(payload, 'en'))
      .filter((l) => typeof l.value === 'string' && VIETNAMESE.test(l.value))
      // Tết is the English name of Tết.
      .filter((l) => !/Tết|Hùng/.test(String(l.value)));
    expect(en).toEqual([]);
  });

  it('still reads Vietnamese on the Vietnamese side', () => {
    const vi = leaves(localizeDeep(payload, 'vi')).filter((l) => typeof l.value === 'string' && VIETNAMESE.test(l.value));
    expect(vi.length).toBeGreaterThan(10);
  });
});
