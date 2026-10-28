import { arrange, dropIndex, moveTo } from './staff-order';

const S = (id: string, firstName = id) => ({ id, firstName });
const staff = [S('tu', 'Tú'), S('kim', 'Kim'), S('lisa', 'Lisa'), S('mai', 'Mai'), S('hoa', 'Hoa')];

describe('technician columns order', () => {
  it('nothing saved: A → Z, as before', () => {
    expect(arrange(staff, null).map((s) => s.id)).toEqual(['hoa', 'kim', 'lisa', 'mai', 'tu']);
  });

  it('the saved line-up first, newcomers after A → Z', () => {
    expect(arrange(staff, { order: ['lisa', 'mai', 'kim'], hidden: [] }).map((s) => s.id)).toEqual(['lisa', 'mai', 'kim', 'hoa', 'tu']);
  });

  it('a hidden technician is left off — unless she has a booking that day', () => {
    const lay = { order: ['lisa', 'mai'], hidden: ['hoa'] };
    expect(arrange(staff, lay).map((s) => s.id)).not.toContain('hoa');
    expect(arrange(staff, lay, new Set(['hoa'])).map((s) => s.id)).toContain('hoa');
  });

  it('moving a column (board 3A: Mai dropped between Lisa and Kim)', () => {
    expect(moveTo(['lisa', 'kim', 'tu', 'mai'], 'mai', 1)).toEqual(['lisa', 'mai', 'kim', 'tu']);
    expect(moveTo(['a', 'b', 'c'], 'a', 9)).toEqual(['b', 'c', 'a']);
    expect(moveTo(['a', 'b'], 'zz', 0)).toEqual(['a', 'b']);
    expect(dropIndex(1, false)).toBe(1);
    expect(dropIndex(1, true)).toBe(2);
  });
});
