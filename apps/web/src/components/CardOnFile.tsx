'use client';

import { useCallback, useEffect, useRef, useState, CSSProperties } from 'react';
import { apiFetch } from '../lib/api';

/**
 * The salon's card, saved in Lumio's own page.
 *
 * The number never touches Lumio: PayPal's Card Fields or Stripe's Payment
 * Element are gateway-hosted iframes that render inside this box, hand the
 * gateway a token, and the API keeps the token plus brand / last 4 / expiry.
 * Which gateway draws the form is the server's call (GET /billing/card →
 * formGateway); this component only knows how to mount either.
 */

export interface CardView {
  card: { id: string; provider: 'paypal' | 'stripe'; status: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; lastChargeAt: string | null; lastError: string | null } | null;
  label: string | null;
  lastErrorText: string | null;
  formGateway: 'paypal' | 'stripe' | null;
  gateways: { stripe: boolean; paypal: boolean };
}
interface StartPaypal { provider: 'paypal'; paypal: { clientId: string; env: string; setupToken: string } }
interface StartStripe { provider: 'stripe'; stripe: { publishableKey: string; clientSecret: string; customerId: string } }

type Lg = 'en' | 'vi';
const T = {
  title: { en: 'Payment card', vi: 'Thẻ thanh toán' },
  none: { en: 'No card saved yet. Add one and your plan fee and usage charges are taken automatically each month — nothing to click.', vi: 'Chưa lưu thẻ. Thêm thẻ để phí gói và phí phát sinh tự trừ hàng tháng — không cần bấm gì.' },
  add: { en: 'Add a card', vi: 'Thêm thẻ' },
  replace: { en: 'Replace card', vi: 'Đổi thẻ' },
  remove: { en: 'Remove', vi: 'Xoá thẻ' },
  removeAsk: { en: 'Remove this card? Charges then come as invoices by email.', vi: 'Xoá thẻ này? Sau đó phí sẽ gửi hoá đơn qua email.' },
  save: { en: 'Save card', vi: 'Lưu thẻ' },
  saving: { en: 'Saving…', vi: 'Đang lưu…' },
  cancel: { en: 'Cancel', vi: 'Huỷ' },
  held: { en: 'Card details are held by', vi: 'Thông tin thẻ do' },
  heldTail: { en: ', never by Lumio.', vi: ' giữ, Lumio không lưu.' },
  notReady: { en: 'The card form is not available yet (the payment gateway has not enabled in-page cards). Use the plan buttons below to pay through the gateway\'s page, or contact Lumio.', vi: 'Form nhập thẻ chưa sẵn sàng (cổng thanh toán chưa bật nhập thẻ trong trang). Dùng nút gói bên dưới để thanh toán qua trang của cổng, hoặc liên hệ Lumio.' },
  loadFail: { en: 'Could not load the card form. Check your connection and try again.', vi: 'Không tải được form thẻ. Kiểm tra mạng và thử lại.' },
  failed: { en: 'Last charge failed', vi: 'Lần trừ gần nhất thất bại' },
  saved: { en: 'Card saved. Anything already due is being charged now.', vi: 'Đã lưu thẻ. Khoản nào đến hạn sẽ được trừ ngay.' },
  cardholder: { en: 'Name on card', vi: 'Tên trên thẻ' },
  number: { en: 'Card number', vi: 'Số thẻ' },
  expiry: { en: 'Expiry', vi: 'Hết hạn' },
  cvv: { en: 'CVV', vi: 'CVV' },
};

const card: CSSProperties = { background: 'var(--c111827)', border: '1px solid var(--c1f2937)', borderRadius: 14, padding: 20, marginTop: 16 };
const head: CSSProperties = { fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 6 };
const line: CSSProperties = { fontSize: 13.5, color: 'var(--ccbd5e1)', lineHeight: 1.6 };
const btn: CSSProperties = { minHeight: 34, padding: '0 14px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
const primary: CSSProperties = { ...btn, background: '#6366f1', border: 'none', color: '#fff', fontWeight: 700 };
const field: CSSProperties = { minHeight: 40, padding: '0 10px', borderRadius: 8, border: '1px solid var(--c334155)', background: '#fff', color: '#0f172a' };
const label: CSSProperties = { fontSize: 12, color: 'var(--c94a3b8)', marginBottom: 4, display: 'block' };

function loadScript(src: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing) { if (existing.dataset.ready === '1') resolve(); else { existing.addEventListener('load', () => resolve()); existing.addEventListener('error', () => reject(new Error('script'))); } return; }
    const s = document.createElement('script');
    s.id = id; s.src = src; s.async = true;
    s.onload = () => { s.dataset.ready = '1'; resolve(); };
    s.onerror = () => reject(new Error('script'));
    document.head.appendChild(s);
  });
}

export function CardOnFile({ token, lang, onChanged }: { token: string; lang: Lg; onChanged?: (v: CardView) => void }) {
  const t = (k: keyof typeof T) => T[k][lang];
  const [view, setView] = useState<CardView | null | undefined>(undefined);
  const [mode, setMode] = useState<'idle' | 'form'>('idle');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [start, setStart] = useState<StartPaypal | StartStripe | null>(null);
  const submitRef = useRef<null | (() => Promise<void>)>(null);
  const mountedRef = useRef(false);

  const load = useCallback(async () => {
    try { const v = await apiFetch<CardView>('/billing/card', { token }); setView(v); onChanged?.(v); }
    catch { setView(null); }
  }, [token, onChanged]);
  useEffect(() => { void load(); }, [load]);

  const openForm = async () => {
    setErr(null); setOk(null); setBusy(true);
    try {
      const s = await apiFetch<StartPaypal | StartStripe>('/billing/card/start', { method: 'POST', token, body: {} });
      setStart(s); setMode('form');
    } catch (e) { setErr(e instanceof Error ? e.message : t('notReady')); }
    finally { setBusy(false); }
  };

  const finish = async (body: Record<string, string>) => {
    const v = await apiFetch<CardView>('/billing/card/confirm', { method: 'POST', token, body });
    setView(v); onChanged?.(v); setMode('idle'); setStart(null); setOk(t('saved'));
  };

  // Mount the gateway's fields once the form box is on screen.
  useEffect(() => {
    if (mode !== 'form' || !start || mountedRef.current) return;
    mountedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        if (start.provider === 'paypal') {
          const p = start.paypal;
          await loadScript(`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(p.clientId)}&components=card-fields&currency=USD`, 'paypal-sdk-card-fields');
          const paypal = (window as unknown as { paypal?: { CardFields: (o: unknown) => { isEligible: () => boolean; NameField: () => { render: (s: string) => void }; NumberField: () => { render: (s: string) => void }; ExpiryField: () => { render: (s: string) => void }; CVVField: () => { render: (s: string) => void }; submit: () => Promise<void> } } }).paypal;
          if (!paypal) throw new Error('sdk');
          const fields = paypal.CardFields({
            createVaultSetupToken: () => p.setupToken,
            onApprove: async (data: { vaultSetupToken: string }) => { await finish({ provider: 'paypal', setupToken: data.vaultSetupToken }); },
            onError: (e: unknown) => { setErr(String((e as Error)?.message ?? e)); setBusy(false); },
            style: { input: { 'font-size': '14px', color: '#0f172a' } },
          });
          if (!fields.isEligible()) { setErr(t('notReady')); setMode('idle'); return; }
          if (cancelled) return;
          fields.NameField().render('#cof-name');
          fields.NumberField().render('#cof-number');
          fields.ExpiryField().render('#cof-expiry');
          fields.CVVField().render('#cof-cvv');
          submitRef.current = async () => { await fields.submit(); };
        } else {
          const s = start.stripe;
          await loadScript('https://js.stripe.com/v3/', 'stripe-js');
          const Stripe = (window as unknown as { Stripe?: (k: string) => { elements: (o: unknown) => { create: (k: string, o?: unknown) => { mount: (s: string) => void } }; confirmSetup: (o: unknown) => Promise<{ error?: { message?: string }; setupIntent?: { id: string; status: string } }> } }).Stripe;
          if (!Stripe) throw new Error('sdk');
          const stripe = Stripe(s.publishableKey);
          const elements = stripe.elements({ clientSecret: s.clientSecret, appearance: { theme: 'stripe' } });
          if (cancelled) return;
          elements.create('payment', { layout: 'tabs' }).mount('#cof-stripe');
          submitRef.current = async () => {
            const r = await stripe.confirmSetup({ elements, redirect: 'if_required' });
            if (r.error) throw new Error(r.error.message ?? 'declined');
            if (!r.setupIntent) throw new Error('setup');
            await finish({ provider: 'stripe', setupIntentId: r.setupIntent.id });
          };
        }
      } catch (e) {
        if (!cancelled) { setErr(e instanceof Error && e.message !== 'script' && e.message !== 'sdk' ? e.message : t('loadFail')); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, start]);

  const closeForm = () => { setMode('idle'); setStart(null); submitRef.current = null; mountedRef.current = false; setErr(null); };
  const submit = async () => {
    if (!submitRef.current) return;
    setBusy(true); setErr(null);
    try { await submitRef.current(); mountedRef.current = false; }
    catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(t('removeAsk'))) return;
    setBusy(true); setErr(null);
    try { const v = await apiFetch<CardView>('/billing/card', { method: 'DELETE', token }); setView(v); onChanged?.(v); }
    catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(false); }
  };

  if (view === undefined) return <div style={card}><div style={head}>💳 {t('title')}</div><div style={line}>…</div></div>;
  const c = view?.card ?? null;
  const gwName = (g: string | null | undefined) => (g === 'stripe' ? 'Stripe' : g === 'paypal' ? 'PayPal' : '');
  return (
    <div id="cof-box" style={card}>
      <div style={head}>💳 {t('title')}</div>
      {c ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{view!.label}</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: c.status === 'failed' ? 'rgba(239,68,68,.14)' : 'rgba(34,197,94,.14)', color: c.status === 'failed' ? 'var(--cfca5a5)' : 'var(--c4ade80)', border: `1px solid ${c.status === 'failed' ? 'rgba(239,68,68,.4)' : 'rgba(34,197,94,.35)'}` }}>
              {c.status === 'failed' ? t('failed') : 'ACTIVE'}
            </span>
          </div>
          {c.status === 'failed' && view!.lastErrorText && <div style={{ ...line, color: 'var(--cfca5a5)', marginTop: 4 }}>⚠ {view!.lastErrorText}</div>}
          <div style={{ ...line, color: 'var(--c64748b)', fontSize: 12.5, marginTop: 4 }}>{t('held')} {gwName(c.provider)}{t('heldTail')}</div>
        </>
      ) : (
        <div style={line}>{t('none')}</div>
      )}
      {ok && <div style={{ ...line, color: 'var(--c4ade80)', marginTop: 6 }}>✓ {ok}</div>}
      {err && mode === 'idle' && <div style={{ ...line, color: 'var(--cfca5a5)', marginTop: 6 }}>{err}</div>}

      {mode === 'idle' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {view?.formGateway ? (
            <button type="button" onClick={openForm} disabled={busy} style={c ? btn : primary}>{c ? t('replace') : t('add')}</button>
          ) : (
            <span style={{ ...line, color: 'var(--cfcd34d)', fontSize: 12.5 }}>{t('notReady')}</span>
          )}
          {c && <button type="button" onClick={remove} disabled={busy} style={{ ...btn, color: 'var(--cfca5a5)' }}>{t('remove')}</button>}
        </div>
      )}

      {mode === 'form' && start && (
        <div style={{ marginTop: 12, padding: 14, borderRadius: 10, background: '#f8fafc', border: '1px solid var(--c334155)' }}>
          {start.provider === 'paypal' ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <div><span style={{ ...label, color: '#475569' }}>{t('cardholder')}</span><div id="cof-name" style={field} /></div>
              <div><span style={{ ...label, color: '#475569' }}>{t('number')}</span><div id="cof-number" style={field} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div><span style={{ ...label, color: '#475569' }}>{t('expiry')}</span><div id="cof-expiry" style={field} /></div>
                <div><span style={{ ...label, color: '#475569' }}>{t('cvv')}</span><div id="cof-cvv" style={field} /></div>
              </div>
            </div>
          ) : (
            <div id="cof-stripe" />
          )}
          {err && <div style={{ fontSize: 13, color: '#b91c1c', marginTop: 8 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <button type="button" onClick={submit} disabled={busy} style={primary}>{busy ? t('saving') : t('save')}</button>
            <button type="button" onClick={closeForm} disabled={busy} style={{ ...btn, color: '#475569', borderColor: '#cbd5e1' }}>{t('cancel')}</button>
            <span style={{ fontSize: 11.5, color: '#64748b', marginLeft: 'auto' }}>🔒 {gwName(start.provider)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
