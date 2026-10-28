import { NAME_MAX, splitSalonName, typeInto } from './kiosk-name';

const typed = (keys: string[]) => keys.reduce((v, k) => typeInto(v, k), '');

describe('kiosk salon name', () => {
  it('puts the branch on its own line', () => {
    expect(splitSalonName('Friendly Nails – Sylvan Lake')).toEqual({ name: 'Friendly Nails', place: 'Sylvan Lake' });
    expect(splitSalonName('Bella Nail Spa - Downtown')).toEqual({ name: 'Bella Nail Spa', place: 'Downtown' });
    expect(splitSalonName('Lux | Austin')).toEqual({ name: 'Lux', place: 'Austin' });
  });
  it('leaves a plain name, or a hyphen inside a word, alone', () => {
    expect(splitSalonName('Lumio Salon')).toEqual({ name: 'Lumio Salon', place: null });
    expect(splitSalonName('Mani-Pedi Bar')).toEqual({ name: 'Mani-Pedi Bar', place: null });
  });
});

describe('kiosk salon keys', () => {
  it('capitalises each word, after a space, hyphen or apostrophe', () => {
    expect(typed('mary-jane o\'neil'.split(''))).toBe("Mary-Jane O'Neil");
    expect(typed(['V', 'I', 'E', 'T'])).toBe('Viet');
  });
  it('no leading or doubled space and punctuation; delete removes one letter', () => {
    expect(typed([' ', '-', 'a', ' ', ' ', 'b'])).toBe('A B');
    expect(typed(['a', 'b', 'del'])).toBe('A');
    expect(typeInto('', 'del')).toBe('');
  });
  it('ignores anything that is not a letter, and stops at the cap', () => {
    expect(typed(['a', '1', '@', 'b'])).toBe('Ab');
    const long = typed(Array.from({ length: 60 }, () => 'a'));
    expect(long.length).toBe(NAME_MAX);
  });
});
