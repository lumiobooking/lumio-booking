import { moveItem, orderSignature, sameOrder } from './reorder';

const L = ['a', 'b', 'c', 'd'];

describe('moving a row', () => {
  it('drags one item up', () => {
    expect(moveItem(L, 2, 0)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('drags one item down', () => {
    expect(moveItem(L, 0, 3)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('handles a one-step nudge, which is what the arrows do', () => {
    expect(moveItem(L, 1, 0)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveItem(L, 1, 2)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('never loses or duplicates an item', () => {
    for (let from = 0; from < L.length; from += 1) {
      for (let to = 0; to < L.length; to += 1) {
        const out = moveItem(L, from, to);
        expect(out).toHaveLength(L.length);
        expect([...out].sort()).toEqual([...L].sort());
      }
    }
  });

  it('ignores a move that goes off either end', () => {
    expect(moveItem(L, 0, -1)).toEqual(L);
    expect(moveItem(L, 3, 4)).toEqual(L);
    expect(moveItem(L, -1, 2)).toEqual(L);
  });

  it('does not mutate the list it was given', () => {
    const original = [...L];
    moveItem(L, 0, 3);
    expect(L).toEqual(original);
  });
});

describe('knowing when the list underneath really changed', () => {
  it('gives a new array with the same ids the SAME signature', () => {
    // THE BUG. The panel re-seeded on `[services]`, and `services` was rebuilt
    // by .filter() on every render — a new reference holding identical items.
    // The effect fired constantly and wiped whatever had just been dragged.
    const first = ['a', 'b', 'c'];
    const rebuilt = ['a', 'b', 'c'].filter(Boolean);
    expect(rebuilt).not.toBe(first);
    expect(orderSignature(rebuilt)).toBe(orderSignature(first));
  });

  it('changes the signature when the order changes', () => {
    // So the panel DOES re-seed once the server sends the saved order back.
    expect(orderSignature(['a', 'b'])).not.toBe(orderSignature(['b', 'a']));
  });

  it('changes the signature when the category filter changes the set', () => {
    expect(orderSignature(['a', 'b', 'c'])).not.toBe(orderSignature(['a', 'b']));
  });

  it('sameOrder agrees with the signature', () => {
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameOrder(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('a drag across several rows ends where it was dropped', () => {
  it('walks item by item, as the pointer passes each row', () => {
    // The pointer handler moves one place at a time as it crosses each row,
    // so the composition of those small moves must equal the big one.
    let cur = [...L];
    for (let i = 0; i < 3; i += 1) cur = moveItem(cur, i, i + 1);
    expect(cur).toEqual(moveItem(L, 0, 3));
  });
});
