import { groupSalons, teamSummaries, cleanTeam, isNewSalon, NEW_SALON_DAYS, UNASSIGNED } from './support-teams';

const s = (id: string, name: string, supportTeam: string | null = null) => ({ id, name, supportTeam });

describe('groupSalons', () => {
  const salons = [
    s('1', 'Zen Nails', 'Nhóm 2'),
    s('2', 'Aura Nail Lab', 'Nhóm 1'),
    s('3', 'BK Nails', null),
    s('4', 'April\'s Nail & Spa', 'Nhóm 1'),
    s('5', 'Diva Nails', '  Nhóm 2 '),
  ];

  it('opens MY team first and folds everybody else, which is what shortens the list', () => {
    // Grouping alone does not fix thirty rows — thirty rows in five groups is
    // still thirty rows. The default is what fixes it.
    const g = groupSalons(salons, 'Nhóm 1');
    expect(g.map((x) => x.label)).toEqual(['Nhóm 1', 'Chưa phân nhóm', 'Nhóm 2']);
    expect(g.map((x) => x.open)).toEqual([true, true, false]);
    expect(g[0].mine).toBe(true);
    expect(g[0].salons.map((x) => x.name)).toEqual(["April's Nail & Spa", 'Aura Nail Lab']);
  });

  it('puts the salons nobody owns SECOND and open, not last and buried', () => {
    // A salon with no owner is the one that goes a fortnight without a post.
    const g = groupSalons(salons, 'Nhóm 1');
    expect(g[1].team).toBe(UNASSIGNED);
    expect(g[1].open).toBe(true);
    expect(g[1].salons.map((x) => x.name)).toEqual(['BK Nails']);
  });

  it('reads a team name the same however it was typed', () => {
    const g = groupSalons(salons, 'Nhóm 2');
    expect(g[0].salons.map((x) => x.name)).toEqual(['Diva Nails', 'Zen Nails']);
    expect(cleanTeam('  Nhóm   2 ')).toBe('Nhóm 2');
    expect(cleanTeam(null)).toBe('');
  });

  it('keeps my team as a heading even when its salons have all moved away', () => {
    // An empty "Nhóm 1" says the salons moved. A missing one says nothing.
    const g = groupSalons([s('3', 'BK Nails', null)], 'Nhóm 1');
    expect(g[0]).toMatchObject({ team: 'Nhóm 1', salons: [], mine: true, open: true });
  });

  it('gives the owner — who has no team — the unowned salons first and the rest folded', () => {
    const g = groupSalons(salons, null);
    expect(g[0].team).toBe(UNASSIGNED);
    expect(g.slice(1).every((x) => !x.open)).toBe(true);
  });
});

describe('teamSummaries', () => {
  it('counts a team that has people but no salons yet, and one that has salons but nobody', () => {
    const out = teamSummaries(
      [{ supportTeam: 'Nhóm 1' }, { supportTeam: 'Nhóm 1' }, { supportTeam: null }, { supportTeam: 'Nhóm 3' }],
      [{ firstName: 'Linh', supportTeam: 'Nhóm 1' }, { email: 'nam@lumio.vn', supportTeam: 'Nhóm 1' }, { firstName: 'Trâm', supportTeam: 'Nhóm 2' }],
    );
    expect(out.map((t) => [t.label, t.salons, t.members])).toEqual([
      ['Nhóm 1', 2, ['Linh', 'nam']],
      ['Nhóm 2', 0, ['Trâm']],   // people, no salons — still a team
      ['Nhóm 3', 1, []],         // salons, nobody on it — the one worth seeing
      ['Chưa phân nhóm', 1, []],
    ]);
  });
});

describe('a salon created just now', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-09-08T12:00:00Z');
  const at = (daysAgo: number) => new Date(now - daysAgo * DAY);
  const mark = <T extends { createdAt?: Date | string | null }>(r: T) => ({ ...r, isNew: isNewSalon(r.createdAt, now) });

  const rows = [
    mark({ id: '1', name: '5 Points Nails & Spa', supportTeam: null, createdAt: at(400) }),
    mark({ id: '2', name: '501 Nails & Spa', supportTeam: null, createdAt: at(300) }),
    mark({ id: '3', name: 'Zen Nails', supportTeam: null, createdAt: at(0.2) }),
    mark({ id: '4', name: 'Moon Spa', supportTeam: null, createdAt: at(3) }),
  ];

  it('SITS ON TOP OF ITS GROUP, above the alphabet', () => {
    // Alphabetical is what makes a known name findable. A salon signed up this
    // morning is the one whose name nobody knows yet — under "5 Points" it is
    // invisible, and it is the only row on the screen that needs doing.
    const g = groupSalons(rows, null);
    expect(g[0].salons.map((x) => x.name)).toEqual([
      'Zen Nails', 'Moon Spa', '5 Points Nails & Spa', '501 Nails & Spa',
    ]);
    expect(g[0].newCount).toBe(2);
  });

  it('settles back into the alphabet once the week is up', () => {
    const old = groupSalons([...rows.slice(0, 2), mark({ id: '5', name: 'Zen Nails', supportTeam: null, createdAt: at(NEW_SALON_DAYS + 1) })], null);
    expect(old[0].salons.map((x) => x.name)).toEqual(['5 Points Nails & Spa', '501 Nails & Spa', 'Zen Nails']);
    expect(old[0].newCount).toBe(0);
  });

  it('does not call a salon new because its date is missing or unreadable', () => {
    expect(isNewSalon(null, now)).toBe(false);
    expect(isNewSalon('not a date', now)).toBe(false);
    expect(isNewSalon(undefined, now)).toBe(false);
    // Nor one dated into next month, which is a clock problem, not an arrival.
    expect(isNewSalon(new Date(now + 30 * DAY), now)).toBe(false);
  });

  it('counts new arrivals per group, not across the whole screen', () => {
    const g = groupSalons([
      mark({ id: 'a', name: 'Aura', supportTeam: 'Nhóm 1', createdAt: at(1) }),
      mark({ id: 'b', name: 'Bee', supportTeam: 'Nhóm 1', createdAt: at(90) }),
      mark({ id: 'c', name: 'Cee', supportTeam: null, createdAt: at(90) }),
    ], 'Nhóm 1');
    expect(g[0].newCount).toBe(1);
    expect(g[1].newCount).toBe(0);
  });
});
