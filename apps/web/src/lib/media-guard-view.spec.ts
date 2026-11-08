import { guardLines, mergeGuards, type MediaGuardView } from './media-guard-view';

const g: MediaGuardView = {
  sha256: 's',
  warnings: [
    { kind: 'same-file', salon: 'Lux Nail Spa', at: '2026-11-01T10:00:00Z' },
    { kind: 'phone', found: '407-555-0101', salon: 'Lux Nail Spa' },
  ],
  checked: { fingerprint: true, picture: true },
};

describe('wrong-salon warning wording', () => {
  it('Lumio staff are told which salon', () => {
    const l = guardLines(g, true, true);
    expect(l[0]).toContain('tiệm Lux Nail Spa');
    expect(l[1]).toContain('407-555-0101');
    expect(l[1]).toContain('Lux Nail Spa');
  });
  it('a salon is never told another salon’s name, even if one slipped through', () => {
    const l = guardLines(g, false, false);
    expect(l.join(' ')).not.toContain('Lux');
    expect(l[0]).toContain('another salon');
  });
  it('a clip and its frame merge without repeating a warning', () => {
    const m = mergeGuards(g, { sha256: 'x', warnings: [g.warnings[0], { kind: 'name', found: 'LUX', salon: 'Lux Nail Spa' }], checked: { fingerprint: true, picture: false } });
    expect(m.warnings.map((w) => w.kind)).toEqual(['same-file', 'phone', 'name']);
    expect(m.sha256).toBe('s');
  });
});
