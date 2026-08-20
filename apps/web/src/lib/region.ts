/**
 * One address — lumiobooking.com — in front of two completely separate systems.
 *
 * WHAT IS AND IS NOT SHARED
 *
 * Shared: this web app. It is a shell — HTML, JavaScript, styling. It holds no
 * salon's data of its own.
 *
 * Not shared, and this is the part that matters: the API and the database.
 * The US API can only reach the US database and the Vietnamese API can only
 * reach the Vietnamese one. Neither process has so much as a connection string
 * for the other. Choosing a region here changes which SERVER this browser
 * talks to; it can no more expose the other market's data than typing a
 * different address into the URL bar could.
 *
 * The tenant isolation the platform depends on lives where it always did —
 * every query scoped by the authenticated tenant, on a server that only knows
 * one database. Nothing in this file participates in that, by design.
 *
 * WHY THE BROWSER STORAGE IS SPLIT TOO
 *
 * One origin means one localStorage. Both systems store the session under
 * 'lumio_auth', so without scoping, signing into Vietnam would overwrite the US
 * session and a stale token would be sent to the wrong server. So every key
 * holding data FROM a system is suffixed with that system's code — except for
 * the US, which keeps the bare key so sessions that already exist keep working.
 *
 * THE PROPERTY THAT PROTECTS THE LIVE SITE
 *
 * Until a second region has BOTH a label and an API URL configured, every
 * function here returns exactly what the app did before this file existed: the
 * NEXT_PUBLIC_API_URL constant and unsuffixed storage keys. No prompt, no
 * switch, no behaviour change. The Vietnamese URL ships empty on purpose, so
 * this reaches lumiobooking.com as a no-op and stays one until someone fills
 * in a value on purpose.
 */

export const REGION_KEY = 'lumio_region';

export interface Region {
  code: string;
  label: string;
  flag: string;
  /** Which API this region's data lives behind. Empty = not configured. */
  apiUrl: string;
}

/** The compiled-in default: what the app used before regions existed. */
export function defaultApiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';
}

/**
 * Regions declared at build time. A region without an API URL does not count.
 *
 * THE US REGION IS NEVER CONFIGURED BY HAND, and that is deliberate.
 *
 * I originally wrote its URL into render.yaml from memory and got it wrong —
 * the live API is lumio-api-uqm6.onrender.com, with a suffix Render added
 * because the plain name was taken. Switching regions on would have pointed
 * every US salon's browser at a host that does not exist.
 *
 * So it is not written down anywhere any more. The US region resolves to
 * NEXT_PUBLIC_API_URL: the value this build is ALREADY using successfully for
 * every request it makes. It cannot disagree with itself, so the whole class of
 * mistake is gone rather than corrected.
 */
export function configuredRegions(): Region[] {
  return [
    // Override exists only for unusual setups; unset is the correct normal case.
    { code: 'US', label: 'US / Canada', flag: '🇺🇸', apiUrl: clean(process.env.NEXT_PUBLIC_REGION_US_API) || defaultApiUrl() },
    { code: 'VN', label: 'Việt Nam', flag: '🇻🇳', apiUrl: clean(process.env.NEXT_PUBLIC_REGION_VN_API) },
  ].filter((r) => r.apiUrl);
}

/** True only when there is a real choice to make. Everything else keys off this. */
export function regionChoiceEnabled(regions: Region[] = configuredRegions()): boolean {
  return regions.length >= 2;
}

/**
 * Which region this browser is currently working in.
 *
 * '' means "no choice has been made", which is deliberately different from
 * 'US': it is what every existing visitor to lumiobooking.com has, and it must
 * keep behaving exactly as before.
 */
export function activeRegion(
  saved?: string | null,
  regions: Region[] = configuredRegions(),
  legacySession: boolean | undefined = undefined,
): string {
  if (!regionChoiceEnabled(regions)) return '';
  const code = norm(saved ?? read(REGION_KEY));
  if (regions.some((r) => r.code === code)) return code;

  const legacy = legacySession ?? hasLegacySession();

  // Nobody who is ALREADY SIGNED IN should be asked which region they are in.
  //
  // A session sitting under the unsuffixed 'lumio_auth' key can only have been
  // written before regions existed, which means it belongs to the original US
  // system. Answering for them matters: without this, the day this is switched
  // on, every US salon owner working in the dashboard is interrupted by a
  // dialog asking whether they are in Vietnam.
  if (legacy && regions.some((r) => r.code === 'US')) return 'US';

  return '';
}

/** A session written before regions existed — therefore a US one. */
export function hasLegacySession(): boolean {
  return !!read('lumio_auth');
}

/** The API this browser should be talking to right now. */
export function apiBaseUrl(
  saved?: string | null,
  regions: Region[] = configuredRegions(),
  legacySession?: boolean,
): string {
  const code = activeRegion(saved, regions, legacySession);
  if (!code) return defaultApiUrl();
  const region = regions.find((r) => r.code === code);
  // A code with no URL should never reach here, but falling back to the
  // compiled-in default beats sending requests to an empty string.
  return region?.apiUrl || defaultApiUrl();
}

/**
 * Namespace a localStorage key so two systems on one origin cannot overwrite
 * each other's data.
 *
 * The US keeps the bare key. That is not tidiness — it means every salon
 * currently signed in to lumiobooking.com stays signed in when this deploys.
 */
export function scopedKey(
  base: string,
  saved?: string | null,
  regions: Region[] = configuredRegions(),
  legacySession?: boolean,
): string {
  const code = activeRegion(saved, regions, legacySession);
  if (!code || code === 'US') return base;
  return `${base}::${code}`;
}

/**
 * Record the region and forget everything belonging to the previous one.
 *
 * A full reload follows in the caller, because the app reads its API URL and
 * its session once on mount; leaving a half-switched page alive is how you end
 * up sending one system's token to the other and puzzling over the 401.
 */
export function rememberRegion(code: string): void {
  try {
    window.localStorage.setItem(REGION_KEY, norm(code));
  } catch {
    // Storage blocked (private mode). The choice will not survive this visit,
    // which is worth an extra prompt but not an exception on the landing page.
  }
}

function norm(v: string | null | undefined): string {
  return String(v ?? '').trim().toUpperCase();
}

function clean(v: string | null | undefined): string {
  return String(v ?? '').trim().replace(/\/+$/, '');
}

function read(key: string): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
