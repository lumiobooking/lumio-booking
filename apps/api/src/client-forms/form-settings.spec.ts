import { consentKindsFor, defaultFormSettings, missingClientKinds, sanitizeFormSettings, visitNeeds } from './form-settings';

const NOW = new Date('2026-10-17T15:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400_000).toISOString();

describe('the salon\'s forms settings', () => {
  it('massage and spa start with forms on; every other salon sees nothing new', () => {
    expect(defaultFormSettings('MASSAGE').enabled).toBe(true);
    expect(defaultFormSettings('SPA').enabled).toBe(true);
    expect(defaultFormSettings('NAIL').enabled).toBe(false);
    expect(defaultFormSettings(null).enabled).toBe(false);
    // Texting costs the salon money: off until the owner says so.
    expect(defaultFormSettings('MASSAGE').autoSend.enabled).toBe(false);
  });

  it('clamps numbers, drops junk and keeps what was not sent', () => {
    const base = defaultFormSettings('MASSAGE');
    const s = sanitizeFormSettings({ intakeValidMonths: 999, consentValidMonths: -3, autoSend: { hoursBefore: 500 }, hacker: 1, consents: { cupping: { serviceIds: ['s1', 's1', 7] } } }, base);
    expect(s.intakeValidMonths).toBe(60);
    expect(s.consentValidMonths).toBe(0);
    expect(s.autoSend).toEqual({ enabled: false, hoursBefore: 72 });
    expect(s.consents.cupping.serviceIds).toEqual(['s1']);
    expect(s.consents.hot_stone).toEqual(base.consents.hot_stone);
    expect((s as unknown as Record<string, unknown>).hacker).toBeUndefined();
  });

  it('keeps the salon\'s own questions tidy, with unique ids', () => {
    const s = sanitizeFormSettings({ extraQuestions: [{ id: 'tat', vi: 'Mới xăm?', en: '' }, { id: 'tat', vi: 'Dùng retinol?', en: 'Using retinol?', flag: false }, { vi: '', en: '' }] }, defaultFormSettings('SPA'));
    expect(s.extraQuestions).toHaveLength(2);
    expect(new Set(s.extraQuestions.map((q) => q.id)).size).toBe(2);
    expect(s.extraQuestions[0].flag).toBe(true);
    expect(s.extraQuestions[1].flag).toBe(false);
  });
});

describe('which consent a visit needs', () => {
  const s = defaultFormSettings('MASSAGE');
  it('reads the service name while nothing is ticked', () => {
    expect(consentKindsFor(s, [{ id: 'a', name: '60 min Swedish + Cupping' }])).toEqual(['cupping']);
    expect(consentKindsFor(s, [{ id: 'a', name: 'Massage đá nóng 90 phút' }])).toEqual(['hot_stone']);
    expect(consentKindsFor(s, [{ id: 'a', name: 'Giác hơi' }, { id: 'b', name: 'Hot Stone' }])).toEqual(['cupping', 'hot_stone']);
    expect(consentKindsFor(s, [{ id: 'a', name: 'Deep tissue' }])).toEqual([]);
  });

  it('once the owner ticks services, only those count', () => {
    const t = sanitizeFormSettings({ consents: { cupping: { serviceIds: ['s9'] } } }, s);
    expect(consentKindsFor(t, [{ id: 'a', name: 'Cupping' }])).toEqual([]);
    expect(consentKindsFor(t, [{ id: 's9', name: 'Signature therapy' }])).toEqual(['cupping']);
    const off = sanitizeFormSettings({ consents: { cupping: { enabled: false } } }, s);
    expect(consentKindsFor(off, [{ id: 'a', name: 'Cupping' }])).toEqual([]);
  });
});

describe('what a visit still needs', () => {
  const s = defaultFormSettings('MASSAGE');
  const visit = { appointmentId: 'ap1', walkInId: null, consentKinds: ['cupping' as const] };

  it('a new client needs everything', () => {
    const needs = visitNeeds(s, visit, [], NOW);
    expect(needs.map((n) => [n.kind, n.when, n.status])).toEqual([['intake', 'before', 'missing'], ['cupping', 'before', 'missing'], ['soap', 'after', 'missing']]);
    expect(missingClientKinds(needs)).toEqual(['intake', 'cupping']);
  });

  it('an intake from this year still counts; an old one has run out', () => {
    const fresh = visitNeeds(s, visit, [{ id: 'e1', kind: 'intake', signedAt: daysAgo(100) }], NOW);
    expect(fresh[0].status).toBe('signed');
    const old = visitNeeds(s, visit, [{ id: 'e1', kind: 'intake', signedAt: daysAgo(400) }], NOW);
    expect(old[0].status).toBe('expired');
  });

  it('"every visit": only this visit\'s form, or one signed in the last hours', () => {
    const each = sanitizeFormSettings({ consentValidMonths: 0 }, s);
    expect(visitNeeds(each, visit, [{ id: 'c', kind: 'cupping', signedAt: daysAgo(3) }], NOW)[1].status).toBe('expired');
    expect(visitNeeds(each, visit, [{ id: 'c', kind: 'cupping', signedAt: daysAgo(3), appointmentId: 'ap1' }], NOW)[1].status).toBe('signed');
    expect(visitNeeds(each, visit, [{ id: 'c', kind: 'cupping', signedAt: new Date(NOW.getTime() - 3600_000) }], NOW)[1].status).toBe('signed');
  });

  it('the SOAP note belongs to this visit only', () => {
    const last = visitNeeds(s, visit, [{ id: 'n', kind: 'soap', signedAt: daysAgo(1), appointmentId: 'old' }], NOW);
    expect(last[2].status).toBe('missing');
    const now = visitNeeds(s, { ...visit, walkInId: 'w1' }, [{ id: 'n', kind: 'soap', signedAt: daysAgo(0), walkInId: 'w1' }], NOW);
    expect(now[2].status).toBe('signed');
  });

  it('nothing at all when the salon has forms off', () => {
    expect(visitNeeds(defaultFormSettings('NAIL'), visit, [], NOW)).toEqual([]);
  });
});
