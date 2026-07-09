/**
 * Optional Cloudflare Turnstile (CAPTCHA) verification.
 *
 * DISABLED by default: if TURNSTILE_SECRET is not set, verifyCaptcha() always
 * returns true, so nothing changes for salons until you decide to turn it on.
 * When you set TURNSTILE_SECRET (and the frontend site key), the public booking,
 * signup and login endpoints will require a valid token — your "big red button"
 * if a competitor starts scripting the forms.
 *
 * Turnstile is free, privacy-friendly, and usually invisible (no puzzles).
 */
export async function verifyCaptcha(token: string | undefined, ip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return true; // feature off → never block legitimate traffic
  if (!token) return false;

  const fetchFn: ((url: string, init: Record<string, unknown>) => Promise<{ json: () => Promise<unknown> }>) | undefined =
    (globalThis as { fetch?: (url: string, init: Record<string, unknown>) => Promise<{ json: () => Promise<unknown> }> }).fetch;
  if (!fetchFn) return true; // no fetch runtime → don't hard-fail bookings

  try {
    const params = new URLSearchParams({ secret, response: token });
    if (ip) params.set('remoteip', ip);
    const res = await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = (await res.json()) as { success?: boolean };
    return data?.success === true;
  } catch {
    return false;
  }
}

/** True when CAPTCHA enforcement is switched on (secret present). */
export function captchaEnabled(): boolean {
  return !!process.env.TURNSTILE_SECRET;
}
