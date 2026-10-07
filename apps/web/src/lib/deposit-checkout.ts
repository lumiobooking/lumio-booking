/**
 * Pay a booking's deposit in the salon's real online provider (HelcimPay
 * modal, or a hosted payment-link page such as Square). The browser never
 * decides: after the payment we ask our own server, which verifies it with the
 * provider (`/online-confirm`). Resolves true only when the server says paid.
 *
 * Same flow as the salon booking page; used by the restaurant reservation
 * page for the per-guest party deposit.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

function loadHelcimPay(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return resolve();
    if ((window as any).appendHelcimPayIframe) return resolve();
    const el = document.createElement('script');
    el.src = 'https://secure.helcim.app/helcim-pay/services/start.js';
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('helcimpay-load-failed'));
    document.head.appendChild(el);
  });
}

async function confirmed(base: string, bookingId: string): Promise<boolean> {
  try {
    const c = await fetch(`${base}/bookings/${bookingId}/online-confirm`, { method: 'POST' });
    const cj = await c.json().catch(() => null);
    return !!cj?.ok;
  } catch { return false; }
}

export async function payDepositOnline(base: string, bookingId: string): Promise<boolean> {
  try {
    const r = await fetch(`${base}/bookings/${bookingId}/online-checkout`, { method: 'POST' });
    const j = await r.json().catch(() => null);
    if (!r.ok) return false;
    if (j?.url && !j?.checkoutToken) {
      window.open(String(j.url), '_blank', 'noopener');
      // Public confirm is rate-limited (12/min): poll every 6s, for up to 10 minutes.
      for (let i = 0; i < 100; i++) {
        await new Promise((s) => setTimeout(s, 6000));
        if (await confirmed(base, bookingId)) return true;
      }
      return false;
    }
    if (!j?.checkoutToken) return false;
    await loadHelcimPay();
    const w = window as any;
    if (typeof w.appendHelcimPayIframe !== 'function') return false;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; window.removeEventListener('message', onMsg); resolve(); } };
      const onMsg = (ev: MessageEvent) => {
        const d: any = ev.data;
        if (d && typeof d === 'object' && String(d.eventName || '').includes(String(j.checkoutToken))) finish();
      };
      window.addEventListener('message', onMsg);
      w.appendHelcimPayIframe(j.checkoutToken);
      setTimeout(finish, 5 * 60_000);
    });
    for (let i = 0; i < 5; i++) {
      if (await confirmed(base, bookingId)) return true;
      await new Promise((s) => setTimeout(s, 2000));
    }
    return false;
  } catch { return false; }
}
