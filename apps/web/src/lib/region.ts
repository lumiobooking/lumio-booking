/**
 * Which regional system this visitor belongs in.
 *
 * One brand, one address people are given — lumiobooking.com — but two entirely
 * separate systems behind it, each with its own server and its own database. So
 * the region choice here is a DOOR, never a switch: picking Vietnam sends the
 * browser to the Vietnamese system. Nothing in this file ever changes which
 * database is read. The two deployments still do not know each other exists,
 * and the address bar always says which one you are in.
 *
 * Why a subdomain instead of lumiobooking.com/vn, which would look tidier:
 *
 *   - The browser scopes localStorage by HOST. Both systems store the session
 *     under 'lumio_auth', so sharing one host means they overwrite each other:
 *     logging into Vietnam would quietly log you out of the US. Separate
 *     subdomains keep the two sessions apart, at no cost.
 *   - A path split needs the US service to forward Vietnamese traffic, which
 *     would send every Vietnamese request through Oregon before Singapore, and
 *     would take Vietnam down whenever the US is down.
 *
 * The most important property in this file: WITH FEWER THAN TWO REGIONS
 * CONFIGURED, NOTHING HAPPENS. The URLs come from env vars, so until the
 * Vietnamese one is set, lumiobooking.com behaves exactly as it does today —
 * no prompt, no redirect, no change to a system real salons are using.
 */

export const REGION_KEY = 'lumio_region';

export interface Region {
  code: string;
  /** Shown on the chooser. */
  label: string;
  flag: string;
  /** Where this region's system lives. Empty/unset = not configured. */
  url: string;
}

export type RegionDecision =
  /** Already in the right place, or the feature is not configured. */
  | { action: 'stay' }
  /** First visit: show the chooser. */
  | { action: 'ask' }
  /** Chose elsewhere last time: send them there. */
  | { action: 'go'; url: string; code: string };

export function decideRegion(args: {
  /** NEXT_PUBLIC_MARKET of the deployment currently being viewed. */
  currentMarket?: string | null;
  /** What they picked last time, from localStorage. */
  saved?: string | null;
  /** Regions with a URL configured. */
  regions: Region[];
  /** Host of the page being viewed, to refuse a redirect back to itself. */
  currentHost?: string | null;
}): RegionDecision {
  const configured = args.regions.filter((r) => cleanUrl(r.url));

  // Nothing to choose between: one region, or none. Never prompt. This is what
  // keeps the live US site untouched until the second URL is actually set.
  if (configured.length < 2) return { action: 'stay' };

  const here = normalise(args.currentMarket) || 'US';
  const saved = normalise(args.saved);

  // No choice yet — and no guessing. They asked to be asked once.
  if (!saved) return { action: 'ask' };

  // A saved value we no longer recognise (region removed, storage tampered
  // with, an old build) is not a reason to redirect somewhere arbitrary.
  const target = configured.find((r) => r.code === saved);
  if (!target) return { action: 'ask' };

  if (saved === here) return { action: 'stay' };

  // Refuse to redirect to the page we are already on. Without this, one
  // mistyped URL in the dashboard — Vietnam's entry pointing at the US — makes
  // an endless redirect loop that looks like the site is simply broken.
  const targetHost = hostOf(target.url);
  if (targetHost && targetHost === normaliseHost(args.currentHost)) return { action: 'stay' };

  return { action: 'go', url: cleanUrl(target.url), code: target.code };
}

/** Read the configured regions from build-time env vars. */
export function configuredRegions(): Region[] {
  return [
    { code: 'US', label: 'US / Canada', flag: '🇺🇸', url: process.env.NEXT_PUBLIC_REGION_US_URL ?? '' },
    { code: 'VN', label: 'Việt Nam', flag: '🇻🇳', url: process.env.NEXT_PUBLIC_REGION_VN_URL ?? '' },
  ];
}

function normalise(v: string | null | undefined): string {
  return String(v ?? '').trim().toUpperCase();
}

function cleanUrl(v: string | null | undefined): string {
  return String(v ?? '').trim().replace(/\/+$/, '');
}

function hostOf(url: string): string {
  try {
    return normaliseHost(new URL(cleanUrl(url)).host);
  } catch {
    return '';
  }
}

function normaliseHost(v: string | null | undefined): string {
  return String(v ?? '').trim().toLowerCase().replace(/^www\./, '');
}
