import { readFileSync } from 'fs';
import { join } from 'path';

/* Joining tables at the till (16/11): open several free tables as one bill,
 * add tables to a bill, join two tables that are eating (button or drag). */
describe('restaurant till — join tables', () => {
  const src = readFileSync(join(__dirname, '..', 'components', 'RestaurantTill.tsx'), 'utf8');
  const map = readFileSync(join(__dirname, '..', 'components', 'TillFloorMap.tsx'), 'utf8');
  it('opens several free tables as ONE bill', () => {
    expect(src).toMatch(/call<CheckView>\('\/restaurant\/checks', 'POST', \{ tableIds: ids, guests \}\)/);
    expect(src).toMatch(/Mở bàn ghép/);
  });
  it('adds tables to an open bill through move, keeping its own tables', () => {
    expect(src).toMatch(/tableIds: \[\.\.\.check\.tableIds, \.\.\.ids\]/);
  });
  it('joins two eating tables only after a confirm that shows both bills', () => {
    expect(src).toMatch(/function MergeConfirm/);
    expect(src).toMatch(/setMergePick\(\{ intoId: check\.id, into: check, from: c \}\)/);
    expect(src).not.toMatch(/onClick=\{async \(\) => \{ const v = await call<CheckView>\(`\/restaurant\/checks\/\$\{check\.id\}\/merge`/);
  });
  it('the floor map lets a table with guests be dragged onto another', () => {
    expect(map).toMatch(/onDropOn\?\.\(from, p\.id\)/);
    expect(src).toMatch(/onDropOn=\{dropTable\}/);
  });
});
