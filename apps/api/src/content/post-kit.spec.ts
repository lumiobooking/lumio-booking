import { buildPostKit, contactBlock, hashtagsFor, checkPost, phoneKey, DIVIDER, type ShopFacts } from './post-kit';

/**
 * One person writes posts for eight salons with eight tabs open. They copy last
 * week's post from salon A, rewrite the caption for salon B, and leave A's phone
 * number and A's Instagram handle sitting at the bottom. It publishes on B's
 * Page and tells B's customers to ring a shop two hundred miles away.
 *
 * These tests pin both halves of the answer: the contact block is BUILT so the
 * common path cannot be wrong, and anything typed that is not this salon's is
 * found and named before the post can go out.
 */
const LUX: ShopFacts = {
  name: 'Lux Nail Spa',
  phone: '(830) 257-8888',
  address: '1204 Sidney Baker St, Kerrville TX 78028',
  city: 'Kerrville',
  instagram: 'luxnailspa_tx',
  website: 'https://luxnailspa.com',
  bookingUrl: 'https://lumiobooking.com/book/lux-nail-spa',
};

/** A post copied from another salon and half-rewritten — the real failure. */
const COPIED = `Dip powder mới về 12 màu mùa thu 💅 cuối tuần này còn chỗ nha cả nhà!

📍 2451 Beach Blvd, Huntington Beach, CA
📞 (714) 892-3355
📷 @rosenails_hb`;

describe('the contact block is built, never typed', () => {
  it('carries every fact the salon has on file', () => {
    const { text, missing } = contactBlock(LUX);
    expect(text).toContain('(830) 257-8888');
    expect(text).toContain('1204 Sidney Baker St');
    expect(text).toContain('@luxnailspa_tx');
    // The SITE, not the booking link: some shops take no bookings through
    // Lumio, and the ones that do would rather write their own call to action
    // than have a link stapled to every post.
    expect(text).toContain('luxnailspa.com');
    expect(text).not.toContain('lumiobooking.com');
    expect(missing).toEqual([]);
  });

  it('omits a missing fact rather than inventing a placeholder', () => {
    // "📞 (chưa có số)" would be published exactly as written by somebody in a
    // hurry, and a placeholder in a customer's feed is worse than a gap.
    const { text, missing } = contactBlock({ name: 'A', city: 'Kerrville', address: '1 Main St' });
    expect(text).not.toMatch(/📞/);
    expect(text).not.toMatch(/📷/);
    expect(text).toContain('📍 1 Main St');
    expect(missing).toEqual(expect.arrayContaining(['phone', 'instagram', 'website']));
  });

  it('produces nothing at all for a salon with nothing on file', () => {
    // Not an empty scaffold of emoji with blanks after them.
    expect(buildPostKit('NAIL', 'US', { name: 'A' }).contactBlock).toBe('');
  });

  it('leaves the writer\'s cursor above its own words', () => {
    const kit = buildPostKit('NAIL', 'US', LUX);
    expect(kit.starter.startsWith('\n\n')).toBe(true);
  });

  it('rules a line between the caption and the contact block', () => {
    // Without it the address reads as the last sentence of the post. This block
    // sits under every post the shop publishes, and a wall with no seams is
    // where a writer's eye slides past the one line that is wrong.
    const kit = buildPostKit('NAIL', 'US', LUX);
    expect(kit.starter).toContain(DIVIDER);
    expect(kit.starter.indexOf(DIVIDER)).toBeLessThan(kit.starter.indexOf('📍'));
  });

  it('puts a blank line between the contact block and the hashtags', () => {
    // Otherwise the tags read as part of the address.
    const kit = buildPostKit('NAIL', 'US', LUX);
    expect(kit.starter).toMatch(/🌐[^\n]*\n\n#/);
  });

  it('never emits a hashtag made of url escaping', () => {
    // "#20tutorial" — the %20 of a space in a YouTube search url — was
    // published on a real salon's post.
    for (const mk of ['US', 'VN']) {
      for (const t of hashtagsFor('NAIL', mk, LUX)) {
        expect(t).not.toMatch(/^#\d/);
        expect(t).not.toMatch(/%/);
      }
    }
  });
});

describe('the hashtags a post opens with', () => {
  it('leads with the two tags only this shop can own', () => {
    const tags = hashtagsFor('NAIL', 'US', LUX);
    // The brand tag is the only one no competitor shares and the one a
    // returning customer searches; the town is how a stranger finds a local
    // business at all.
    expect(tags[0]).toBe('#luxnailspa');
    expect(tags).toContain('#kerrville');
  });

  it('adds the phrase a person actually types for this service in this town', () => {
    expect(hashtagsFor('NAIL', 'US', LUX)).toContain('#kerrvillenailart');
  });

  it('brings the trade’s real tags, not three typed from memory', () => {
    const tags = hashtagsFor('NAIL', 'US', LUX);
    expect(tags).toContain('#nailsofinstagram');
    expect(tags.length).toBeGreaterThan(8);
  });

  it('switches vocabulary with the market', () => {
    const vn = hashtagsFor('NAIL', 'VN', { name: 'Nail Bé Ba', city: 'Đà Nẵng' });
    expect(vn.join(' ')).toMatch(/naildep|nailvietnam|maunaildep/);
    // Vietnamese diacritics cannot survive in a hashtag, so they are folded.
    expect(vn).toContain('#danang');
  });

  it('stops well short of a wall of tags', () => {
    // Instagram allows thirty. Thirty reads as spam to a person even where the
    // platform permits it, and the tail is tags nobody follows.
    expect(hashtagsFor('NAIL', 'US', LUX).length).toBeLessThanOrEqual(14);
  });

  it('never repeats a tag', () => {
    const tags = hashtagsFor('NAIL', 'US', LUX);
    expect(new Set(tags.map((t) => t.toLowerCase())).size).toBe(tags.length);
  });
});

describe('what does not belong to this salon', () => {
  it('catches the copied post, all three ways', () => {
    const { findings } = checkPost(COPIED, LUX);
    const kinds = findings.map((f) => f.kind);
    expect(kinds).toContain('phone');
    expect(kinds).toContain('instagram');
    expect(kinds).toContain('address');
  });

  it('offers this salon’s own value for the one-tap fix', () => {
    const phone = checkPost(COPIED, LUX).findings.find((f) => f.kind === 'phone');
    expect(phone?.found).toContain('714');
    expect(phone?.expected).toBe('(830) 257-8888');
  });

  it('passes a correct post silently', () => {
    const good = `Dip powder mới về 💅${buildPostKit('NAIL', 'US', LUX).starter}`;
    expect(checkPost(good, LUX).findings).toEqual([]);
  });

  it('accepts the salon’s own number written differently', () => {
    // 830-257-8888 and (830) 257-8888 are the same shop. Flagging the second
    // spelling would train everybody to click past the warnings.
    expect(checkPost('Gọi 830.257.8888 nhé', LUX).findings).toEqual([]);
    expect(checkPost('Call +1 830 257 8888', LUX).findings).toEqual([]);
  });

  it('does not mistake a price or a date for a phone number', () => {
    expect(checkPost('Chỉ 250.000 hôm nay, mở tới 20:00 ngày 09/05/2026', LUX).findings).toEqual([]);
  });

  it('judges an address by its town, not by its street', () => {
    // Two shops on Beach Blvd are two different shops, and comparing whole
    // address strings would flag "St" against "Street" until nobody read the
    // warnings any more.
    expect(checkPost('Ghé 900 Water St, Kerrville TX nha', LUX).findings).toEqual([]);
    expect(checkPost('Ghé 900 Water St, Austin TX nha', LUX).findings.map((f) => f.kind)).toContain('address');
  });

  it('says which checks it could NOT run', () => {
    // A checker silent for lack of data reads exactly like one that found
    // nothing wrong, and the person trusting it cannot tell the difference —
    // which is how a shop with no phone on file publishes a rival's number
    // for a year.
    const bare: ShopFacts = { name: 'A' };
    const r = checkPost(COPIED, bare);
    expect(r.findings).toEqual([]);
    expect(r.unchecked).toEqual(expect.arrayContaining(['phone', 'instagram', 'address', 'website']));
  });

  it('names each wrong thing once, however often it appears', () => {
    const twice = `${COPIED}\n\nGọi lại (714) 892-3355 nha`;
    const phones = checkPost(twice, LUX).findings.filter((f) => f.kind === 'phone');
    expect(phones).toHaveLength(1);
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

describe('comparing two written phone numbers', () => {
  it('ignores punctuation and country code', () => {
    expect(phoneKey('(830) 257-8888')).toBe(phoneKey('+1 830.257.8888'));
    expect(phoneKey('0912 345 678')).toBe(phoneKey('0912-345-678'));
  });
});
