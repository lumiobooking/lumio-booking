/**
 * GOOGLE ADS CONVERSIONS WITHOUT GTM.
 *
 * A salon pastes two values from Google Ads into Lumio — the conversion ID
 * (AW-…) and the conversion label — and the booking page does the rest: it
 * loads that salon's Google Ads tag and reports each booking ONCE, with the
 * booking id as transaction_id (Google Ads drops a repeat of the same id).
 *
 * Rules kept here, not in the page:
 *  - Only well-formed values are ever used: they end up inside a tag URL and a
 *    send_to, so a typo can never become script.
 *  - Top window only. An embedded form leaves measurement to the salon's own
 *    website (the page already hands the conversion up via postMessage).
 *  - One salon per document. If a different salon's Ads tag is already on the
 *    page, the page reloads rather than mix two salons' accounts.
 *  - Our gtag stub must never turn into a stray GA4 "purchase": which pipe a
 *    booking goes through is decided from the tag WE loaded (conversionRoute).
 */

export const ADS_ID_RE = /^AW-\d{6,15}$/;
export const ADS_LABEL_RE = /^[A-Za-z0-9_-]{4,64}$/;

export interface AdsConfig { adsId: string; adsLabel: string }

/** Only the valid parts of what the salon saved ('' for anything else). */
export function adsConfigFrom(a: { adsId?: string | null; adsLabel?: string | null } | null | undefined): AdsConfig {
  const id = String(a?.adsId ?? '').trim().toUpperCase();
  const label = String(a?.adsLabel ?? '').trim();
  return { adsId: ADS_ID_RE.test(id) ? id : '', adsLabel: ADS_LABEL_RE.test(label) ? label : '' };
}

/** A conversion needs both halves; the tag alone (no label) still loads. */
export function canSendConversion(c: AdsConfig | null | undefined): c is AdsConfig {
  return !!c && ADS_ID_RE.test(c.adsId) && ADS_LABEL_RE.test(c.adsLabel);
}

type Gtag = (...a: unknown[]) => void;
export interface TagWindow {
  dataLayer?: unknown[];
  gtag?: Gtag;
  google_tag_manager?: unknown;
  __lumioTag?: string;
  __lumioAds?: string;
  lumioConsentUpdate?: (c: Record<string, string>) => void;
  location?: { reload: () => void };
}
export interface TagDocument {
  querySelector: (sel: string) => unknown;
  createElement: (tag: string) => { async?: boolean; src?: string };
  head: { appendChild: (el: unknown) => unknown };
}

/**
 * Load this salon's Google Ads tag. Returns what happened, for tests.
 * Safe to call on every render — a second call for the same id does nothing.
 */
export function loadAdsTag(adsId: string, w: TagWindow, d: TagDocument): 'loaded' | 'already' | 'reload' | 'skipped' {
  if (!ADS_ID_RE.test(adsId)) return 'skipped';
  if (w.__lumioAds === adsId) return 'already';
  if (w.__lumioAds && w.__lumioAds !== adsId) { w.location?.reload(); return 'reload'; }
  w.__lumioAds = adsId;
  const dl = (w.dataLayer = w.dataLayer || []);
  const ownStub = typeof w.gtag !== 'function';
  if (ownStub) {
    w.gtag = function gtag() {
      // gtag.js reads the Arguments object itself, not an array.
      // eslint-disable-next-line prefer-rest-params
      dl.push(arguments);
    };
  }
  const g = w.gtag as Gtag;
  // No GA4/GTM tag on this page set the consent defaults — set the same ones
  // they would (US/CA default; an EU salon's CMP calls lumioConsentUpdate).
  if (!w.__lumioTag) {
    g('consent', 'default', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted', wait_for_update: 500 });
    if (!w.lumioConsentUpdate) w.lumioConsentUpdate = (c) => g('consent', 'update', c);
  }
  // gtag.js is already on the page when the salon's GA4 is — it handles any
  // number of destinations. With GTM only (or nothing), load it for Ads.
  if (!d.querySelector('script[src*="googletagmanager.com/gtag/js"]')) {
    const s = d.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${adsId}`;
    d.head.appendChild(s);
  }
  if (ownStub) g('js', new Date());
  g('config', adsId);
  return 'loaded';
}

/**
 * The same tag, but IN THE HTML. Rendered by the booking page's server
 * layout right after the salon's GA4/GTM snippet, so the Ads tag is on the
 * page from the first byte — not a second or two later, once React has
 * hydrated and the page's effect has run. Two reasons that matters:
 *  - Google Ads judges "is the Google tag on this site" from tag ACTIVITY
 *    and from what it finds on the landing page. A visitor who clicks the ad
 *    and leaves in a second never reached the effect, so the page view was
 *    never reported — and the campaign showed "your website is missing the
 *    Google tag".
 *  - A crawler-style check reads the HTML; a tag injected by script after
 *    the fact is invisible to it.
 * Same rules as loadAdsTag: top window only, one salon per document (reload
 * rather than mix), reuse gtag.js when GA4 already loaded it, consent
 * defaults only when no GA4/GTM set them. Marks `__lumioAds`, so the later
 * effect call returns 'already' and nothing runs twice.
 * Returns '' for anything but a well-formed id — the string goes into the
 * page verbatim, so it is built only from a value that matched ADS_ID_RE.
 */
export function adsInlineSnippet(adsId: string): string {
  const id = String(adsId ?? '').trim().toUpperCase();
  if (!ADS_ID_RE.test(id)) return '';
  return `(function(){try{if(window.self!==window.top)return}catch(e){return}`
    + `if(window.__lumioAds==='${id}')return;`
    + `if(window.__lumioAds&&window.__lumioAds!=='${id}'){location.reload();return}`
    + `window.__lumioAds='${id}';`
    + `var dl=window.dataLayer=window.dataLayer||[];var own=typeof window.gtag!=='function';`
    + `if(own){window.gtag=function(){dl.push(arguments)}}`
    + `if(!window.__lumioTag){window.gtag('consent','default',{ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted',analytics_storage:'granted',wait_for_update:500});`
    + `if(!window.lumioConsentUpdate){window.lumioConsentUpdate=function(c){window.gtag('consent','update',c)}}}`
    + `if(!document.querySelector('script[src*="googletagmanager.com/gtag/js"]')){var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=${id}';document.head.appendChild(s)}`
    + `if(own){window.gtag('js',new Date())}`
    + `window.gtag('config','${id}');})();`;
}

/** Send ONE booking to Google Ads. Returns true when it was handed to gtag. */
export function sendAdsConversion(
  c: AdsConfig | null | undefined,
  p: { transaction_id: string; value: number; currency: string },
  w: TagWindow,
): boolean {
  if (!canSendConversion(c) || !p.transaction_id || typeof w.gtag !== 'function') return false;
  if (w.__lumioAds && w.__lumioAds !== c.adsId) return false; // never into another salon's account
  w.gtag('event', 'conversion', {
    send_to: `${c.adsId}/${c.adsLabel}`,
    value: p.value,
    currency: p.currency,
    transaction_id: p.transaction_id,
  });
  return true;
}

/**
 * Which analytics pipe a booking goes through, decided by the tag the layout
 * loaded (window.__lumioTag), not by which globals happen to exist — gtag.js
 * (GA4 or the Ads tag) creates window.google_tag_manager too.
 */
export function conversionRoute(w: TagWindow): 'gtm' | 'ga4' | 'none' {
  const tag = String(w.__lumioTag ?? '');
  if (/^GTM-/.test(tag)) return 'gtm';
  if (/^G-/.test(tag)) return typeof w.gtag === 'function' ? 'ga4' : 'none';
  if (w.__lumioAds) return 'none'; // only our Ads tag is here: no GA4/GTM event
  // Older pages without the marker: the original behaviour.
  if (w.google_tag_manager) return 'gtm';
  if (typeof w.gtag === 'function') return 'ga4';
  return 'none';
}
