import * as fs from 'fs';
import * as path from 'path';
import { bookingChannel, channelCoverage, BOOKING_CHANNELS, PLATFORM_OF } from './booking-channel';

describe('the door decides, the tag only refines', () => {
  it('keeps a Messenger booking on Messenger despite a stray utm', () => {
    // The engine used to do `utmSource || source`, which is this rule
    // backwards. A thread is stronger evidence than a parameter someone pasted
    // into a link, and getting it wrong moves real bookings between channels.
    expect(bookingChannel({ source: 'messenger', utmSource: 'google_ads' })).toBe('messenger');
    expect(bookingChannel({ source: 'hotline', utmSource: 'facebook' })).toBe('hotline');
    expect(bookingChannel({ source: 'walkin', utmSource: 'ig' })).toBe('walkin');
  });

  it('reads Google under every name the platform stores it as', () => {
    for (const s of ['gmap', 'google', 'gbp', 'rwg', 'reserve_with_google']) {
      expect(bookingChannel({ source: s })).toBe('gmap');
    }
  });

  it('treats a raw source of "facebook" as a chat booking', () => {
    // Counter-intuitive and deliberate: the booking form never writes
    // 'facebook', the Messenger integration does.
    expect(bookingChannel({ source: 'facebook' })).toBe('messenger');
  });

  it('refines the anonymous web doors from the utm', () => {
    expect(bookingChannel({ source: 'plugin', utmSource: 'fb' })).toBe('facebook');
    expect(bookingChannel({ source: 'hosted', utmSource: 'gmb' })).toBe('gmap');
    expect(bookingChannel({ source: 'plugin' })).toBe('website');
    expect(bookingChannel({ source: 'hosted' })).toBe('lumiolink');
  });

  it('uses the referrer when nothing tagged the link — the organic case', () => {
    // A customer who found the salon on Google and tapped the booking link
    // carries no utm at all. Without this they were filed as "unknown", which
    // is how Google disappeared from the channel report.
    expect(bookingChannel({ source: 'hosted', attrReferrer: 'https://www.google.com/search?q=nails' })).toBe('gmap');
    expect(bookingChannel({ source: 'plugin', attrReferrer: 'https://m.facebook.com/' })).toBe('facebook');
    expect(bookingChannel({ source: 'plugin', attrReferrer: 'https://l.instagram.com/' })).toBe('instagram');
    expect(bookingChannel({ source: 'plugin', attrReferrer: 'not a url' })).toBe('website');
  });

  it('files a genuinely unknown web booking as online, not as a channel', () => {
    expect(bookingChannel({})).toBe('online');
    expect(bookingChannel({ source: 'web' })).toBe('online');
  });
});

describe('attribution coverage is reported, not assumed', () => {
  it('counts the unknown bucket separately', () => {
    const c = channelCoverage(['gmap', 'gmap', 'online', 'online', 'facebook']);
    expect(c).toEqual({ total: 5, attributed: 3, unknown: 2, pct: 60 });
  });

  it('survives an empty book without dividing by zero', () => {
    expect(channelCoverage([])).toEqual({ total: 0, attributed: 0, unknown: 0, pct: 0 });
  });
});

describe('every channel maps to something, and only real platforms are buyable', () => {
  it('has a platform for each channel', () => {
    for (const c of BOOKING_CHANNELS) expect(PLATFORM_OF[c]).toBeTruthy();
  });

  it('never routes a walk-in or the salon’s own link to an ad platform', () => {
    // Nobody sells advertising that produces walk-ins. Marking these 'offline'
    // and 'owned' is what stops the planner recommending a budget for them.
    expect(PLATFORM_OF.walkin).toBe('offline');
    expect(PLATFORM_OF.staff).toBe('offline');
    expect(PLATFORM_OF.hotline).toBe('offline');
    expect(PLATFORM_OF.lumiolink).toBe('owned');
    expect(PLATFORM_OF.website).toBe('owned');
    expect(PLATFORM_OF.online).toBe('owned');
  });
});

describe('this file and the calendar’s copy have not drifted apart', () => {
  /**
   * Two implementations of one rule is one too many, and the alternative here
   * was a third divergent tally, which is what the ads engine had been. This
   * guard is deliberately shallow — it reads the web module as TEXT and checks
   * that every channel name and every raw alias appears in both. It cannot
   * prove the logic matches; it does catch someone adding TikTok to one side.
   */
  const web = path.join(__dirname, '../../../web/src/lib/booking-sources.ts');
  const src = fs.existsSync(web) ? fs.readFileSync(web, 'utf8') : null;

  it('finds the web module at all — a missing file must not pass silently', () => {
    expect(src).not.toBeNull();
  });

  it('knows the same channels', () => {
    for (const c of BOOKING_CHANNELS) expect(src).toContain(`'${c}'`);
  });

  it('knows the same raw source aliases', () => {
    for (const alias of [
      'instagram', 'ig', 'messenger', 'facebook', 'fb', 'chat', 'zalo',
      'hotline', 'voice', 'call', 'phone', 'walkin', 'walk-in',
      'admin', 'staff', 'manual', 'gmap', 'google', 'gbp', 'rwg',
      'reserve_with_google', 'plugin', 'website', 'wordpress', 'hosted', 'lumiolink', 'link',
    ]) {
      expect(src).toContain(`'${alias}'`);
    }
  });
});
