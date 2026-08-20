/**
 * Which URLs this instance should ping to stay warm.
 *
 * Pulled out of KeepaliveService as a pure function because it had a bug that
 * only appears once there is more than one market, and a bug you cannot write a
 * test for is a bug that comes back.
 *
 * The old code ended each lookup with a hardcoded US URL:
 *
 *     KEEPALIVE_WEB_URL ?? 'https://lumio-web-1xqk.onrender.com'
 *
 * which was right when there was one deployment and quietly wrong the moment
 * there were two. The Vietnamese API, with that variable unset, would spend all
 * day pinging the US web service: burning the US instance's resources, leaving
 * the Vietnamese one to fall asleep on its own customers, and re-introducing a
 * thread between two systems that were deliberately separated.
 *
 * So the rule is: a fallback may only ever point at the market it belongs to.
 * Anywhere else, an unset URL means ping nothing. Pinging nothing costs a cold
 * start; pinging the wrong market costs the isolation.
 */

/** Defaults that are only correct for the original US deployment. */
const US_FALLBACK_API = 'https://lumio-api-uqm6.onrender.com';
const US_FALLBACK_WEB = 'https://lumio-web-1xqk.onrender.com';

export function keepaliveTargets(env: {
  /** MARKET. Absent means the original deployment, which is US. */
  market?: string | null;
  /** KEEPALIVE_SELF_URL, or Render's injected RENDER_EXTERNAL_URL. */
  selfUrl?: string | null;
  /** KEEPALIVE_WEB_URL — the web service that belongs to THIS market. */
  webUrl?: string | null;
}): string[] {
  // `||`, not `??`, and the distinction is not pedantry: an env var that is
  // PRESENT BUT BLANK is a real state on Render (someone clears the box rather
  // than deleting the row), and `??` would let it through as a market named "".
  // health.controller.ts already reads it as `MARKET || 'US'`, so anything else
  // here would have one instance calling itself US on /api/health while the
  // keep-alive treated it as somewhere else.
  const isUS = String(env.market || 'US').trim().toUpperCase() === 'US';

  const self = clean(env.selfUrl) ?? (isUS ? US_FALLBACK_API : null);
  const web = clean(env.webUrl) ?? (isUS ? US_FALLBACK_WEB : null);

  const urls: string[] = [];
  if (self) urls.push(`${self}/api/health`);
  if (web) urls.push(`${web}/healthz`);
  return urls;
}

/** Trim, drop a trailing slash, and treat blank as absent. */
function clean(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim().replace(/\/+$/, '');
  return v ? v : null;
}
