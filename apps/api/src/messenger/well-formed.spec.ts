import { cleanTurns, cutText, wellFormed } from './well-formed';

describe('text the database accepts (half emoji)', () => {
  const kiss = '😘'; // two code units
  it('cutting never leaves half an emoji', () => {
    const s = 'ab' + kiss;
    expect(cutText(s, 3)).toBe('ab');
    expect(cutText(s, 4)).toBe('ab' + kiss);
    expect(JSON.stringify(cutText(s, 3))).not.toMatch(/\\ud/i);
  });
  it('a lone half is dropped, whole emoji kept', () => {
    expect(wellFormed('x\uD83Dy' + kiss)).toBe('xy' + kiss);
    expect(wellFormed('\uDE18z')).toBe('z');
  });
  it('turns are cleaned, other fields untouched', () => {
    const t = cleanTurns([{ role: 'user', content: 'hi\uD83D', at: '1' }, { role: 'user', content: 'ok', at: '2' }]);
    expect(t[0]).toEqual({ role: 'user', content: 'hi', at: '1' });
    expect(t[1].content).toBe('ok');
  });
});
