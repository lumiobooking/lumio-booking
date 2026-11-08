'use client';
/**
 * "Pay with Venmo" for a booking deposit, through the salon's own PayPal.
 *
 * PayPal's button script is loaded with the salon's PUBLIC client id and asked
 * for the Venmo button only. The order is created by OUR server
 * (online-checkout?sdk=1: the amount comes from the salon's deposit rule, not
 * from this page), and when the customer approves in Venmo our server reads
 * and captures the order (online-confirm) — the browser's word is never the
 * proof. If Venmo is not available to this customer (outside the US, a
 * browser PayPal does not support, no Venmo app), PayPal says so and nothing
 * is shown: the regular PayPal / card button below still works.
 */
import { useEffect, useRef, useState } from 'react';

export interface VenmoConfig { clientId: string; env: 'sandbox' | 'live'; currency: 'USD' }

type PaypalNs = {
  FUNDING: { VENMO: string };
  Buttons: (o: Record<string, unknown>) => { isEligible: () => boolean; render: (el: HTMLElement) => Promise<void>; close?: () => Promise<void> };
};

const loading = new Map<string, Promise<PaypalNs | null>>();

/** One PayPal script per client id (a page shows one salon). */
export function loadPaypalSdk(cfg: VenmoConfig): Promise<PaypalNs | null> {
  const key = `${cfg.clientId}|${cfg.currency}`;
  const had = loading.get(key);
  if (had) return had;
  const p = new Promise<PaypalNs | null>((resolve) => {
    if (typeof window === 'undefined') return resolve(null);
    const ns = `paypal_${cfg.clientId.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;
    const w = window as unknown as Record<string, PaypalNs | undefined>;
    if (w[ns]) return resolve(w[ns] ?? null);
    const el = document.createElement('script');
    const q = new URLSearchParams({ 'client-id': cfg.clientId, currency: cfg.currency, intent: 'capture', components: 'buttons', 'enable-funding': 'venmo' });
    el.src = `https://www.paypal.com/sdk/js?${q.toString()}`;
    el.setAttribute('data-namespace', ns);
    el.async = true;
    el.onload = () => resolve(w[ns] ?? null);
    el.onerror = () => resolve(null);
    document.head.appendChild(el);
  });
  loading.set(key, p);
  return p;
}

export function VenmoButton({ cfg, base, bookingId, onStart, onPaid, onFail, failText }: {
  cfg: VenmoConfig; base: string; bookingId: string;
  onStart: () => void; onPaid: () => void; onFail: (msg: string) => void;
  /** Shown when the payment could not be confirmed. */
  failText: { notCompleted: string; network: string };
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let btn: ReturnType<PaypalNs['Buttons']> | null = null;
    void loadPaypalSdk(cfg).then(async (pp) => {
      if (cancelled || !pp || !ref.current) return;
      btn = pp.Buttons({
        fundingSource: pp.FUNDING.VENMO,
        style: { shape: 'rect', height: 50, label: 'pay' },
        createOrder: async () => {
          const r = await fetch(`${base}/bookings/${bookingId}/online-checkout?sdk=1`, { method: 'POST' });
          const j = await r.json().catch(() => null);
          if (!r.ok || !j?.orderId) throw new Error(String((j && (Array.isArray(j.message) ? j.message.join(', ') : j.message)) || 'order'));
          return String(j.orderId);
        },
        onApprove: async () => {
          onStart();
          // Our server reads and captures the order; capture can lag a moment.
          for (let i = 0; i < 6; i++) {
            try {
              const c = await fetch(`${base}/bookings/${bookingId}/online-confirm`, { method: 'POST' });
              const cj = await c.json().catch(() => null);
              if (cj?.ok) { onPaid(); return; }
            } catch { /* retry */ }
            await new Promise((s) => setTimeout(s, 2000));
          }
          onFail(failText.notCompleted);
        },
        onError: () => onFail(failText.network),
      });
      if (!btn.isEligible()) return; // Venmo not available for this customer
      await btn.render(ref.current).then(() => { if (!cancelled) setShown(true); }).catch(() => undefined);
    });
    return () => { cancelled = true; void btn?.close?.().catch(() => undefined); };
    // The button is built once per booking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.clientId, bookingId]);

  return <div ref={ref} style={{ minHeight: shown ? 50 : 0 }} aria-live="polite" />;
}
