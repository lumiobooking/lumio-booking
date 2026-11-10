import { allCategories, cleanCategoryList, orderByCategories } from './menu-categories';

describe('menu categories (Nẩu Chill)', () => {
  it('a list of names, loosely de-duplicated', () => {
    expect(cleanCategoryList(['Lẩu', ' lẩu ', '', 'Đồ  uống', 7])).toEqual(['Lẩu', 'Đồ uống', '7']);
    expect(cleanCategoryList({ names: ['Nướng'] })).toEqual(['Nướng']);
    expect(cleanCategoryList('x')).toEqual([]);
  });
  it('the owner’s order first — including empty categories — then categories only dishes name', () => {
    expect(allCategories(['Món mới', 'Lẩu'], ['Bia', 'lẩu', null, 'Ăn vặt'])).toEqual(['Món mới', 'Lẩu', 'Ăn vặt', 'Bia']);
  });
  it('dishes follow that order; no category goes last', () => {
    const items = [{ id: 1, category: 'Bia' }, { id: 2, category: null }, { id: 3, category: 'Lẩu' }, { id: 4, category: 'lẩu' }, { id: 5, category: 'Khác' }];
    expect(orderByCategories(items, ['Lẩu', 'Bia']).map((x) => x.id)).toEqual([3, 4, 1, 5, 2]);
  });
});
