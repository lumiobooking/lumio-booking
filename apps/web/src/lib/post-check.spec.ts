import { checkPost, applyFix, phoneKey, type ShopFacts } from './post-check';

/**
 * The same rule the server enforces, run as the person types. One writer, eight
 * salons, eight tabs: last week's post from salon A is copied, the caption is
 * rewritten for salon B, and A's phone number and Instagram handle stay at the
 * bottom. It publishes on B's Page and sends B's customers to a shop two
 * hundred miles away.
 */
const LUX: ShopFacts = {
  name: 'Lux Nail Spa',
  phone: '(830) 257-8888',
  address: '1204 Sidney Baker St, Kerrville TX 78028',
  city: 'Kerrville',
  instagram: 'luxnailspa_tx',
  bookingUrl: 'https://lumiobooking.com/book/lux-nail-spa',
};

const COPIED = `Dip powder mới về 12 màu mùa thu 💅

📍 2451 Beach Blvd, Huntington Beach, CA
📞 (714) 892-3355
📷 @rosenails_hb`;

describe('what does not belong to this salon', () => {
  it('finds the phone, the handle and the address in a copied post', () => {
    const kinds = checkPost(COPIED, LUX).findings.map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(['phone', 'instagram', 'address']));
  });

  it('stays silent on a correct post', () => {
    const good = `Dip powder mới về 💅\n\n📍 1204 Sidney Baker St, Kerrville TX 78028\n📞 (830) 257-8888\n📷 @luxnailspa_tx`;
    expect(checkPost(good, LUX).findings).toEqual([]);
  });

  it('accepts the salon’s own number written another way', () => {
    // Flagging 830.257.8888 against (830) 257-8888 would teach everybody to
    // click past the warnings within a week.
    expect(checkPost('Gọi 830.257.8888', LUX).findings).toEqual([]);
    expect(checkPost('Call +1 830 257 8888', LUX).findings).toEqual([]);
  });

  it('does not mistake a price or a date for a phone number', () => {
    expect(checkPost('Chỉ 250.000 hôm nay, tới 20:00 ngày 09/05/2026', LUX).findings).toEqual([]);
  });

  it('judges an address by its town, not its street', () => {
    expect(checkPost('Ghé 900 Water St, Kerrville TX', LUX).findings).toEqual([]);
    expect(checkPost('Ghé 900 Water St, Austin TX', LUX).findings.map((f) => f.kind)).toContain('address');
  });

  it('names each wrong thing once, however often it appears', () => {
    const twice = `${COPIED}\n\nGọi lại (714) 892-3355 nha`;
    expect(checkPost(twice, LUX).findings.filter((f) => f.kind === 'phone')).toHaveLength(1);
  });

  it('says which checks it could not run, instead of passing quietly', () => {
    // A checker silent for lack of data reads exactly like one that found
    // nothing wrong. That is how a shop with no phone on file publishes a
    // rival's number for a year and nobody notices.
    const r = checkPost(COPIED, { name: 'A' });
    expect(r.findings).toEqual([]);
    expect(r.unchecked).toEqual(expect.arrayContaining(['phone', 'instagram', 'address', 'bookingUrl']));
  });

  it('adds no information the draft did not already contain', () => {
    // The property worth pinning is not "the words 'Rose Nails' are absent" —
    // the draft itself names them, and the screen has to quote them to point at
    // them. It is that every value in the result came from one of two places:
    // the text the writer typed, or THIS salon's own record. No other tenant is
    // read, so no other client's details can reach this screen.
    const r = checkPost(COPIED, LUX);
    const mine = Object.values(LUX).filter(Boolean).map(String);
    for (const f of r.findings) {
      expect(COPIED).toContain(f.found.replace(/^📍\s*/, ''));
      // The handle is offered as "@name" while the record stores "name" — a
      // rendering of the same fact, not a new one.
      if (f.expected) expect(mine).toContain(f.expected.replace(/^@/, ''));
    }
  });
});

describe('the one-tap fix', () => {
  it('swaps the wrong value for this salon’s own', () => {
    const f = checkPost(COPIED, LUX).findings.find((x) => x.kind === 'phone')!;
    const fixed = applyFix(COPIED, f);
    expect(fixed).toContain('(830) 257-8888');
    expect(fixed).not.toContain('(714) 892-3355');
  });

  it('replaces every copy of it, not just the first', () => {
    const twice = `${COPIED}\nGọi lại (714) 892-3355`;
    const f = checkPost(twice, LUX).findings.find((x) => x.kind === 'phone')!;
    expect(applyFix(twice, f)).not.toContain('892-3355');
  });

  it('leaves the text alone when there is nothing to offer', () => {
    const f = { kind: 'phone' as const, found: '(714) 892-3355', expected: null };
    expect(applyFix(COPIED, f)).toBe(COPIED);
  });
});

describe('comparing two written phone numbers', () => {
  it('ignores punctuation and country code', () => {
    expect(phoneKey('(830) 257-8888')).toBe(phoneKey('+1 830.257.8888'));
    expect(phoneKey('0912 345 678')).toBe(phoneKey('0912-345-678'));
  });
});
