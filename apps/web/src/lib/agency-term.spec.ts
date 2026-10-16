import {
  addDays, addMonthsDay, dayDiff, fmtDay, needsRenewal, renewBucket, renewState, termPhrase, termProgress, termStatus, todayKey, whoShort,
  type ServiceTerm,
} from './agency-term';
import {
  activeGroups, applyFilters, clearGroup, facetCounts, groupSummary, NO_FILTERS, rememberedFilters, toggleValue, type FilterFacts,
} from './agency-filters';

const TODAY = '2026-10-14';
const term = (end: string, extra: Partial<ServiceTerm> = {}): ServiceTerm => ({ start: null, end, months: null, alertDays: 14, renew: null, ...extra });

describe('agency service term', () => {
  it('days and dates', () => {
    expect(todayKey(new Date(2026, 9, 14, 23, 50))).toBe('2026-10-14');
    expect(dayDiff('2026-10-14', '2026-10-19')).toBe(5);
    expect(addMonthsDay('2026-01-31', 1)).toBe('2026-02-28');
    expect(addDays('2026-10-19', -14)).toBe('2026-10-05');
    expect(fmtDay('2026-10-19', TODAY)).toBe('19/10');
    expect(fmtDay('2027-01-14', TODAY)).toBe('14/01/2027');
    expect(whoShort('lan@lumio.vn')).toBe('lan');
  });

  it('expired / soon / ok / none, with the end day still counting as service', () => {
    expect(termStatus(term('2026-10-11'), TODAY)).toMatchObject({ state: 'expired', daysLeft: -3 });
    expect(termStatus(term('2026-10-14'), TODAY)).toMatchObject({ state: 'soon', daysLeft: 0 });
    expect(termStatus(term('2026-10-28'), TODAY).state).toBe('soon'); // 14 days
    expect(termStatus(term('2026-10-29'), TODAY).state).toBe('ok');
    expect(termStatus(term('2026-10-29', { alertDays: 30 }), TODAY).state).toBe('soon');
    expect(termStatus(null, TODAY).state).toBe('none');
    expect(termPhrase(termStatus(term('2026-10-11'), TODAY), TODAY)).toBe('Hết hạn 3 ngày');
    expect(termPhrase(termStatus(term('2026-10-19'), TODAY), TODAY)).toBe('Còn 5 ngày');
    expect(termPhrase(termStatus(term('2027-01-14'), TODAY), TODAY)).toBe('Đến 14/01/2027');
  });

  it('a renewal mark only counts for its own cycle', () => {
    const told = term('2026-10-19', { renew: { state: 'told', by: 'lan@x', at: '2026-10-14T02:00:00Z', forEnd: '2026-10-19' } });
    expect(renewState(told)).toBe('told');
    expect(needsRenewal(told, TODAY)).toBe(false);
    // The end date was edited by hand after the warning: the warning is stale.
    expect(renewState({ ...told, end: '2026-10-25' })).toBe('untold');
    expect(needsRenewal({ ...told, end: '2026-10-25' }, TODAY)).toBe(true);
    const renewed = term('2027-04-19', { start: '2026-10-19', renew: { state: 'renewed', by: 'lan@x', at: '2026-10-14T03:00:00Z', renewedTo: '2027-04-19' } });
    expect(renewBucket(renewed, TODAY)).toBe('renewed');
    expect(renewBucket(renewed, '2026-11-02')).toBeNull(); // last month's renewal leaves the view
    expect(renewBucket(term('2027-01-01'), TODAY)).toBeNull();
    expect(renewBucket(term('2026-10-11'), TODAY)).toBe('untold');
  });

  it('progress through the term', () => {
    expect(termProgress(term('2026-10-19', { start: '2026-07-19' }), TODAY)).toBeCloseTo(87 / 92, 3);
    expect(termProgress(term('2026-10-19'), TODAY)).toBeNull();
  });
});

describe('agency filters', () => {
  const row = (id: string, o: Partial<FilterFacts>): FilterFacts => ({
    id, term: 'ok', renew: null, team: 'Team 1', pkg: 'scale', stage: 'running', market: 'US', growth: 'flat', ads: 'none', flags: [], ...o,
  });
  const ROWS = [
    row('a', { term: 'expired', renew: 'untold' }),
    row('b', { term: 'expired', renew: 'told', team: 'Team 2', market: 'CA', pkg: 'boost' }),
    row('c', { term: 'soon', renew: 'untold', pkg: '' }),
    row('d', { term: 'soon', renew: 'told', team: 'Team 2', flags: ['waiting'] }),
    row('e', { term: 'ok', team: '', flags: ['new'] }),
    row('f', { term: 'none', stage: 'setup', market: 'VN', growth: 'down', ads: 'warn' }),
  ];

  it('OR inside a group, AND across groups', () => {
    expect(applyFilters(ROWS, NO_FILTERS)).toBe(ROWS);
    const f = { ...NO_FILTERS, term: ['expired', 'soon'] };
    expect(applyFilters(ROWS, f).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(applyFilters(ROWS, { ...f, team: ['Team 1'] }).map((r) => r.id)).toEqual(['a', 'c']);
    expect(applyFilters(ROWS, { ...NO_FILTERS, team: ['none'] }).map((r) => r.id)).toEqual(['e']);
    expect(applyFilters(ROWS, { ...NO_FILTERS, pkg: ['none'] }).map((r) => r.id)).toEqual(['c']);
    expect(applyFilters(ROWS, { ...NO_FILTERS, renew: ['told'] }).map((r) => r.id)).toEqual(['b', 'd']);
    expect(applyFilters(ROWS, { ...NO_FILTERS, flag: ['waiting', 'new'] }).map((r) => r.id)).toEqual(['d', 'e']);
    // The pulse groups: the one salon falling, and the one spending on ads with nothing back.
    expect(applyFilters(ROWS, { ...NO_FILTERS, growth: ['down'] }).map((r) => r.id)).toEqual(['f']);
    expect(applyFilters(ROWS, { ...NO_FILTERS, ads: ['warn', 'on'] }).map((r) => r.id)).toEqual(['f']);
    expect(applyFilters(ROWS, { ...NO_FILTERS, growth: ['down'], ads: ['none'] })).toHaveLength(0);
  });

  it('each count is what ticking that option would leave', () => {
    const f = { ...NO_FILTERS, term: ['expired', 'soon'], team: ['Team 1'] };
    const c = facetCounts(ROWS, f);
    expect(c.term).toEqual({ expired: 1, soon: 1, none: 1 }); // "Còn hạn" would leave 0: absent, shown dimmed
    expect(c.team).toEqual({ 'Team 1': 2, 'Team 2': 2 });
    for (const [k, n] of Object.entries(c.team)) {
      expect(applyFilters(ROWS, { ...f, team: [k] })).toHaveLength(n);
    }
    expect(c.market).toEqual({ US: 2 });
  });

  it('toggles, clears, summarises, remembers only market and package', () => {
    let f = toggleValue(NO_FILTERS, 'term', 'expired');
    f = toggleValue(f, 'term', 'soon');
    expect(activeGroups(f)).toEqual(['term']);
    expect(groupSummary(f.term, (v) => (v === 'expired' ? 'Hết hạn' : 'Sắp hết hạn'))).toBe('Hết hạn, Sắp hết hạn');
    expect(groupSummary(['a', 'b', 'c'], (v) => v.toUpperCase())).toBe('A +2');
    expect(clearGroup(f, 'term').term).toEqual([]);
    expect(toggleValue(f, 'term', 'soon').term).toEqual(['expired']);
    expect(rememberedFilters({ market: ['CA'], pkg: ['scale', 3], term: ['expired'] })).toEqual({ ...NO_FILTERS, market: ['CA'], pkg: ['scale'] });
    expect(rememberedFilters(null)).toEqual(NO_FILTERS);
  });
});
