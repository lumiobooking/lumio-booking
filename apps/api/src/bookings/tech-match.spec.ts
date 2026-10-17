/**
 * "I want to book with Sang" — the phone assistant finds the technician the
 * way a receptionist would, and still asks when two people could fit.
 */
import { foldName, matchTech } from './tech-match';

const TEAM = [
  { id: 'c', firstName: 'Cindy ', lastName: null },
  { id: 's', firstName: 'Sang', lastName: 'Nguyen' },
  { id: 'i', firstName: 'Ivy ', lastName: null },
];
const id = (r: ReturnType<typeof matchTech>) => (r.tech ? r.tech.id : null);

describe('which technician the caller meant', () => {
  it('ignores case, accents and the trailing space a name was saved with', () => {
    expect(foldName('  Ngọc  Ánh ')).toBe('ngoc anh');
    expect(id(matchTech('cindy', TEAM))).toBe('c');
    expect(id(matchTech('SANG', TEAM))).toBe('s');
    expect(id(matchTech('Sang Nguyen', TEAM))).toBe('s');
    expect(id(matchTech('sang.', TEAM))).toBe('s');
  });

  it('hears a name the way speech recognition writes it', () => {
    expect(id(matchTech('Sung', TEAM))).toBe('s');
    expect(id(matchTech('Song', TEAM))).toBe('s');
    expect(id(matchTech('Cindi', TEAM))).toBe('c');
    expect(id(matchTech('Ivie', TEAM))).toBe('i');
  });

  it('never guesses between two people, and says no when nobody fits', () => {
    const twins = [{ id: 'a', firstName: 'Kim' }, { id: 'b', firstName: 'Kimmy' }];
    const r = matchTech('Kimm', twins);
    expect(r.tech).toBeNull();
    expect('candidates' in r && r.candidates.map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(matchTech('Peter', TEAM).tech).toBeNull();
    expect(matchTech('', TEAM).tech).toBeNull();
  });
});
