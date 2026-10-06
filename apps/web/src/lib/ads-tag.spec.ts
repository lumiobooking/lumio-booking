import { readFileSync } from 'fs';
import { join } from 'path';
import { adsConfigFrom, canSendConversion, loadAdsTag, sendAdsConversion, conversionRoute, TagWindow, TagDocument } from './ads-tag';

function fakeDoc(existingGtagJs = false) {
  const appended: { async?: boolean; src?: string }[] = [];
  const d: TagDocument = {
    querySelector: () => (existingGtagJs ? {} : null),
    createElement: () => ({}),
    head: { appendChild: (el) => { appended.push(el as never); return el; } },
  };
  return { d, appended };
}
const calls = (w: TagWindow) => (w.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>));

describe('the salon’s Google Ads values', () => {
  it('keeps only well-formed values', () => {
    expect(adsConfigFrom({ adsId: ' aw-18473564020 ', adsLabel: 'AbC-12_xY' })).toEqual({ adsId: 'AW-18473564020', adsLabel: 'AbC-12_xY' });
    expect(adsConfigFrom({ adsId: "AW-1');alert(1)//", adsLabel: '<script>' })).toEqual({ adsId: '', adsLabel: '' });
    expect(adsConfigFrom(null)).toEqual({ adsId: '', adsLabel: '' });
    expect(canSendConversion({ adsId: 'AW-18473564020', adsLabel: '' })).toBe(false);
    expect(canSendConversion({ adsId: 'AW-18473564020', adsLabel: 'AbCdEf12' })).toBe(true);
  });
});

describe('loading the Ads tag on the booking page', () => {
  it('with nothing else on the page: consent defaults, gtag.js for the AW id, config', () => {
    const w: TagWindow = {}; const { d, appended } = fakeDoc(false);
    expect(loadAdsTag('AW-18473564020', w, d)).toBe('loaded');
    expect(appended[0].src).toBe('https://www.googletagmanager.com/gtag/js?id=AW-18473564020');
    const c = calls(w);
    expect(c[0][0]).toBe('consent');
    expect(c.some((x) => x[0] === 'js')).toBe(true);
    expect(c[c.length - 1]).toEqual(['config', 'AW-18473564020']);
    expect(typeof w.lumioConsentUpdate).toBe('function');
  });

  it('next to the salon’s GA4: reuses its gtag.js and consent, adds the Ads destination', () => {
    const dataLayer: unknown[] = [];
    const gtag = jest.fn();
    const w: TagWindow = { dataLayer, gtag, __lumioTag: 'G-ABC1234' }; const { d, appended } = fakeDoc(true);
    expect(loadAdsTag('AW-18473564020', w, d)).toBe('loaded');
    expect(appended).toHaveLength(0);
    expect(gtag.mock.calls).toEqual([['config', 'AW-18473564020']]);
  });

  it('runs once per page, and reloads rather than mix two salons', () => {
    const w: TagWindow = { location: { reload: jest.fn() } }; const { d } = fakeDoc();
    loadAdsTag('AW-111111111', w, d);
    expect(loadAdsTag('AW-111111111', w, d)).toBe('already');
    expect(loadAdsTag('AW-222222222', w, d)).toBe('reload');
    expect(w.location!.reload).toHaveBeenCalled();
    expect(w.__lumioAds).toBe('AW-111111111');
  });

  it('never injects a malformed id', () => {
    const w: TagWindow = {}; const { d, appended } = fakeDoc();
    expect(loadAdsTag('AW-1"><script>', w, d)).toBe('skipped');
    expect(appended).toHaveLength(0);
    expect(w.dataLayer).toBeUndefined();
  });
});

describe('sending a booking to Google Ads', () => {
  const p = { transaction_id: 'bk_1', value: 45, currency: 'USD' };

  it('one conversion event with send_to, value, currency and the booking id', () => {
    const gtag = jest.fn();
    const w: TagWindow = { gtag, __lumioAds: 'AW-18473564020' };
    expect(sendAdsConversion({ adsId: 'AW-18473564020', adsLabel: 'AbCdEf12' }, p, w)).toBe(true);
    expect(gtag).toHaveBeenCalledWith('event', 'conversion', { send_to: 'AW-18473564020/AbCdEf12', value: 45, currency: 'USD', transaction_id: 'bk_1' });
  });

  it('nothing without a label, without a booking id, or into another salon’s tag', () => {
    const gtag = jest.fn();
    expect(sendAdsConversion({ adsId: 'AW-18473564020', adsLabel: '' }, p, { gtag })).toBe(false);
    expect(sendAdsConversion({ adsId: 'AW-18473564020', adsLabel: 'AbCdEf12' }, { ...p, transaction_id: '' }, { gtag })).toBe(false);
    expect(sendAdsConversion({ adsId: 'AW-111111111', adsLabel: 'AbCdEf12' }, p, { gtag, __lumioAds: 'AW-222222222' })).toBe(false);
    expect(gtag).not.toHaveBeenCalled();
  });
});

describe('which analytics pipe a booking takes', () => {
  it('follows the tag the layout loaded, not whichever globals exist', () => {
    const gtag = jest.fn();
    expect(conversionRoute({ __lumioTag: 'GTM-ABCD12', google_tag_manager: {}, gtag })).toBe('gtm');
    // gtag.js (GA4 or Ads) also creates google_tag_manager — still GA4.
    expect(conversionRoute({ __lumioTag: 'G-ABC1234', google_tag_manager: {}, gtag })).toBe('ga4');
    // Only our Ads tag: no stray GA4 "purchase".
    expect(conversionRoute({ __lumioAds: 'AW-18473564020', google_tag_manager: {}, gtag })).toBe('none');
    expect(conversionRoute({})).toBe('none');
  });
});

describe('wired into the booking page and settings', () => {
  const page = readFileSync(join(__dirname, '..', 'app', 'book', '[slug]', 'page.tsx'), 'utf8');
  const integ = readFileSync(join(__dirname, '..', 'app', 'salon', 'integrations', 'page.tsx'), 'utf8');
  it('the booking page loads the tag and sends the conversion per salon', () => {
    expect(page).toMatch(/loadAdsTag\(/);
    expect(page).toMatch(/sendAdsConversion\(adsBySlug\.get\(data\.slug\)/);
    expect(page).toMatch(/conversionRoute\(/);
  });
  it('the owner can paste the ID and label', () => {
    expect(integ).toMatch(/adsId/);
    expect(integ).toMatch(/adsLabel/);
  });
});
