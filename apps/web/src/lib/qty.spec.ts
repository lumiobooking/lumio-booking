import { cleanQty, QTY_MAX } from './qty';

describe('cleanQty (typed dish quantity)', () => {
  it('keeps a plain whole number', () => { expect(cleanQty('24')).toBe(24); });
  it('drops anything that is not a digit', () => { expect(cleanQty(' 1 2x')).toBe(12); });
  it('caps at the API limit', () => { expect(cleanQty('250')).toBe(250); expect(cleanQty('1500')).toBe(QTY_MAX); });
  it('0 means remove the dish', () => { expect(cleanQty('0')).toBe(0); expect(cleanQty('007')).toBe(7); });
  it('nothing numeric gives null (keep the old amount)', () => { expect(cleanQty('')).toBeNull(); expect(cleanQty('abc')).toBeNull(); });
});
