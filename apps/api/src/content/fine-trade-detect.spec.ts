import { detectIndustry, pickTrade } from './industry-detect';
import { knownTrades } from './trends/trend-feed';

// Four business types is the right size for a database column and the wrong
// size for writing a post. "RESTAURANT" is true of a phở house, a bakery and a
// boba shop, and the content engine cannot write a caption from it. These
// tests are about the second, finer answer — and about the two ways it is
// allowed to be silent, which matter more than the ways it speaks.
const known = knownTrades();

describe('the fine trade under the business type', () => {
  it('reads a coffee shop as a CAFE while the business type stays RESTAURANT', () => {
    const d = detectIndustry({
      tenantName: 'Ben Thanh Coffee House',
      menuItemCount: 14,
      menuItemNames: ['Latte', 'Cold Brew', 'Cappuccino', 'Americano'],
      tableCount: 6,
      currentIndustry: 'SALON',
    });
    // The enum column is unchanged and stays one of four values.
    expect(d.detected).toBe('RESTAURANT');
    expect(d.trade).toBe('CAFE');
    expect(d.tradeEvidence.join(' ')).toMatch(/Latte|Cold Brew/i);
  });

  it('reads a bakery as a BAKERY, not as generic food', () => {
    const d = detectIndustry({
      tenantName: 'Golden Crust',
      menuItemCount: 20,
      menuItemNames: ['Butter Croissant', 'Sourdough Loaf', 'Birthday Cake', 'Cupcakes'],
      currentIndustry: 'SALON',
    });
    expect(d.detected).toBe('RESTAURANT');
    expect(d.trade).toBe('BAKERY');
  });

  it('reads a boba shop as BUBBLE_TEA', () => {
    const d = detectIndustry({
      tenantName: 'Sunrise Tea',
      menuItemCount: 30,
      menuItemNames: ['Brown Sugar Boba', 'Classic Milk Tea', 'Taro Tapioca'],
      currentIndustry: 'SALON',
    });
    expect(d.trade).toBe('BUBBLE_TEA');
  });

  it('reads a phở house as RESTAURANT proper, not as one of its neighbours', () => {
    const d = detectIndustry({
      declaredWhatWeDo: 'Nhà hàng phở và bún bò Huế, nấu tươi mỗi ngày',
      menuItemCount: 25,
      menuItemNames: ['Phở bò tái', 'Bún bò Huế', 'Cơm tấm sườn'],
      tableCount: 12,
      currentIndustry: 'SALON',
    });
    expect(d.detected).toBe('RESTAURANT');
    expect(d.trade).toBe('RESTAURANT');
  });

  // THE REGRESSION THIS FILE EXISTS FOR. `\b` is defined on ASCII, so every
  // accented term in the tables — phở, cà phê, bánh mì, chân mày — matched
  // nothing at all, silently, in a product whose owners write their menus in
  // Vietnamese. A shop with no English on its menu was simply invisible.
  it('reads a menu written entirely in Vietnamese', () => {
    const d = detectIndustry({
      tenantName: 'Quán Cà Phê Sài Gòn',
      menuItemCount: 18,
      menuItemNames: ['Cà phê sữa đá', 'Bạc xỉu', 'Cà phê đen đá'],
      tableCount: 8,
      currentIndustry: 'SALON',
    });
    expect(d.detected).toBe('RESTAURANT');
    expect(d.trade).toBe('CAFE');
    expect(d.tradeEvidence.join(' ')).toMatch(/Cà phê|Bạc xỉu/i);
  });

  it('tells a lash studio apart from the nail salon it used to be filed as', () => {
    const d = detectIndustry({
      tenantName: 'Mimi Lash Studio',
      serviceNames: ['Volume Lash Full Set', 'Lash Lift', 'Nối mi classic'],
      currentIndustry: 'SALON',
    });
    expect(d.detected).toBe('SALON');
    expect(d.trade).toBe('LASH');
  });

  it('tells a hair salon apart from a nail salon', () => {
    const d = detectIndustry({
      tenantName: 'Ruby Hair',
      serviceNames: ['Balayage', 'Keratin Treatment', 'Haircut & Blowout'],
      currentIndustry: 'SALON',
    });
    expect(d.trade).toBe('HAIR');
  });
});

// Silence is a feature here. A wrong business type is obvious the moment
// anyone opens the screen; a wrong trade quietly writes plausible content for
// the shop next door. So the bar to name a trade is deliberately higher than
// the bar to name an industry, and "I don't know" leaves the owner's own
// choice in place.
describe('when it refuses to guess', () => {
  it('says nothing about a café that sells as much pastry as coffee', () => {
    const d = detectIndustry({
      tenantName: 'Corner Shop',
      menuItemCount: 12,
      menuItemNames: ['Latte', 'Butter Croissant'],
      tableCount: 4,
      currentIndustry: 'SALON',
    });
    expect(d.detected).toBe('RESTAURANT');
    expect(d.trade).toBeNull();
    expect(d.tradeEvidence).toEqual([]);
  });

  it('says nothing when a word honestly belongs to two trades', () => {
    // Microblading is a brow service AND permanent makeup. It is listed under
    // both on purpose, so that it cancels out instead of picking whichever
    // came first in the table.
    const d = detectIndustry({
      tenantName: 'Anna Beauty Bar',
      serviceNames: ['Microblading', 'Waxing'],
      currentIndustry: 'SALON',
    });
    expect(d.detected).toBe('SALON');
    expect(d.trade).toBeNull();
  });

  it('never lets a fine trade cross into another business type', () => {
    // "Latte Nails" is a nail salon with a cute name. The café words are not
    // even candidates once the coarse pass has settled on SALON.
    const d = detectIndustry({
      tenantName: 'Latte Nails & Spa',
      serviceNames: ['Gel X Full Set', 'Deluxe Pedicure', 'Dipping Powder'],
      currentIndustry: 'SALON',
    });
    expect(d.detected).toBe('SALON');
    expect(d.trade).toBe('NAIL');
  });

  it('has no fine trades to offer outside salons and food', () => {
    const d = detectIndustry({
      tenantName: 'Family Smart Homes',
      serviceNames: ['Home Valuation', 'Property Tour', 'Open House'],
      currentIndustry: 'SALON',
    });
    expect(d.detected).toBe('REAL_ESTATE');
    expect(d.trade).toBeNull();
  });

  it('says nothing about a shop it could not place at all', () => {
    const d = detectIndustry({ tenantName: 'ABC LLC', currentIndustry: 'SALON' });
    expect(d.detected).toBeNull();
    expect(d.trade).toBeNull();
    expect(d.tradeEvidence).toEqual([]);
  });
});

describe('pickTrade — the fine trade reaches the profile', () => {
  const boba = detectIndustry({
    tenantName: 'Sunrise Tea',
    menuItemCount: 30,
    menuItemNames: ['Brown Sugar Boba', 'Classic Milk Tea', 'Taro Tapioca'],
    currentIndustry: 'SALON',
  });

  it('writes BUBBLE_TEA rather than RESTAURANT when the model said nothing usable', () => {
    // Before the detector learned the fine trades this shop got "RESTAURANT",
    // which aliases to a menu playbook written for a dinner house.
    expect(pickTrade({ modelTrade: '', detection: boba, manual: false, known })).toBe('BUBBLE_TEA');
  });

  it('still lets the model — which read the shop itself — have the first word', () => {
    expect(pickTrade({ modelTrade: 'BAKERY', detection: boba, manual: false, known })).toBe('BAKERY');
  });

  it('falls back to the business type when the engine has no playbook for the fine trade', () => {
    const narrow = ['SALON', 'RESTAURANT', 'REAL_ESTATE', 'SERVICE'];
    expect(pickTrade({ modelTrade: '', detection: boba, manual: false, known: narrow })).toBe('RESTAURANT');
  });

  it('never touches a trade a person chose by hand', () => {
    expect(pickTrade({ modelTrade: '', detection: boba, manual: true, known })).toBeNull();
  });

  it('every trade it can name has a playbook behind it', () => {
    // A detected trade the engine cannot write for is worse than none: it
    // silently buckets the shop into SALON downstream.
    for (const t of ['NAIL', 'HAIR', 'LASH', 'BROW', 'SPA', 'MASSAGE', 'PMU',
      'RESTAURANT', 'CAFE', 'BAKERY', 'BUBBLE_TEA', 'FAST_FOOD']) {
      expect(known).toContain(t);
    }
  });
});
