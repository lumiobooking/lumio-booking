'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { UsageCostsPanel } from '../../../components/UsageCostsPanel';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr, Lang } from '../../../lib/i18n';
import { usePaged, Pager } from '../../../components/ListFilter';

type BillTab = 'plan' | 'usage' | 'invoices';
interface InvoiceRow { id: string; number: string; type: string; status: string; totalCents: number; currency: string; periodStart: string | null; periodEnd: string | null; dueDate: string | null; token: string; createdAt: string }

interface PlanFlags { planName: string | null }
interface Subscription { status: string; provider: string | null; interval: string; currentPeriodStart: string | null; currentPeriodEnd: string | null; trialEndsAt: string | null; createdAt: string }
interface BillingSummary { planName: string | null; tenantStatus: string | null; billingExempt: boolean; accessUntil: string | null; subscription: Subscription | null }
interface PublicPlan {
  id: string; name: string; tagline: string | null; currency: string;
  priceMonthlyCents: number; priceYearlyCents: number; features: string[]; highlighted: boolean;
  providers: { stripe: boolean; paypal: boolean };
}

const money = (c: number, cur = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(c / 100);

export default function BillingPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [current, setCurrent] = useState<PlanFlags | null>(null);
  const [sum, setSum] = useState<BillingSummary | null>(null);
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [yearly, setYearly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<BillTab>('plan');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search).get('tab');
    if (q === 'usage' || q === 'invoices') setTab(q);
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [p, list, s] = await Promise.all([
        apiFetch<PlanFlags>('/me/plan', { token }),
        apiFetch<PublicPlan[]>('/billing/plans', { token }).catch(() => [] as PublicPlan[]),
        apiFetch<BillingSummary | null>('/billing/status', { token }).catch(() => null),
      ]);
      setCurrent(p);
      setPlans(Array.isArray(list) ? list : []);
      setSum(s);
    } catch { /* ignore */ }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('upgraded')) {
      setMsg(t('bl.upgraded'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function choose(planId: string, provider: 'stripe' | 'paypal') {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch<{ checkoutUrl: string }>('/billing/subscribe', { method: 'POST', token, body: { planId, interval: yearly ? 'year' : 'month', provider } });
      if (!r?.checkoutUrl) throw new Error(t('bl.noCheckout'));
      window.location.href = r.checkoutUrl;
    } catch (e) {
      const m = e instanceof Error ? e.message : t('bl.checkoutFail');
      setError(m);
      alert(t('bl.payAlert').replace('{m}', m));
      setBusy(false);
    }
  }

  async function portal() {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch<{ url: string }>('/billing/portal', { method: 'POST', token });
      window.location.href = r.url;
    } catch { setMsg(t('bl.noSub')); setBusy(false); }
  }

  const currentName = (current?.planName ?? '').toLowerCase();
  // Upgrade vs downgrade (by price tier) + proration from the current period.
  const currentPlan = plans.find((p) => p.name.toLowerCase() === currentName) ?? null;
  const currentTier = currentPlan ? currentPlan.priceMonthlyCents : -1;
  const sub = sum?.subscription ?? null;
  const nowMs = Date.now();
  const psMs = sub?.currentPeriodStart ? new Date(sub.currentPeriodStart).getTime() : 0;
  const peMs = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() : 0;
  const periodMs = peMs > psMs ? peMs - psMs : 0;
  const remainMs = peMs > nowMs ? peMs - nowMs : 0;
  const remainFrac = periodMs > 0 ? Math.min(1, Math.max(0, remainMs / periodMs)) : 0;
  const remainDays = Math.max(0, Math.ceil(remainMs / 86400000));
  const renewLabel = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

  return (
    <section style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{t('bl.title')}</h1>
      <p style={{ color: '#94a3b8', margin: '0 0 14px', fontSize: 14 }}>{t('bl.subtitle')}</p>

      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid #1f2937', marginBottom: 18, flexWrap: 'wrap' }}>
        {(([['plan', t('bl.tabPlan')], ['usage', t('bl.tabUsage')], ['invoices', t('bl.tabInvoices')]]) as [BillTab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            border: 'none', background: 'transparent', cursor: 'pointer', padding: '9px 14px',
            fontSize: 14, fontWeight: tab === id ? 700 : 500,
            color: tab === id ? '#e2e8f0' : '#94a3b8',
            borderBottom: tab === id ? '2px solid #6366f1' : '2px solid transparent', marginBottom: -1,
          }}>{label}</button>
        ))}
      </div>

      {msg && <div style={{ background: '#064e3b', color: '#a7f3d0', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>{msg}</div>}
      {error && <div style={ui.banner}>{error}</div>}

      {tab === 'plan' && (<>
      <div style={{ ...ui.card, marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: '#94a3b8' }}>{t('bl.currentPlan')}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{current?.planName ?? sum?.planName ?? '—'}</div>
          </div>
          <button onClick={portal} disabled={busy} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid #475569' }}>{t('bl.manageCard')}</button>
        </div>

        <div style={{ borderTop: '1px solid #334155', marginTop: 14, paddingTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          {sum?.subscription ? (
            <>
              <Detail label={t('bl.dStatus')} value={statusLabel(sum.subscription.status, lang)} />
              <Detail label={t('bl.dCycle')} value={sum.subscription.interval === 'YEARLY' ? t('bl.yearly') : t('bl.monthly')} />
              <Detail label={t('bl.dRegistered')} value={fmtDate(sum.subscription.createdAt)} />
              {sum.subscription.trialEndsAt && <Detail label={t('bl.dTrialEnds')} value={fmtDate(sum.subscription.trialEndsAt)} />}
              <Detail label={sum.subscription.status === 'CANCELLED' ? t('bl.dEndsOn') : t('bl.dRenewsOn')} value={fmtDate(sum.subscription.currentPeriodEnd)} />
            </>
          ) : sum?.billingExempt ? (
            <Detail label={t('bl.dAccess')} value={t('bl.freeNoExpiry')} />
          ) : sum?.accessUntil ? (
            <>
              <Detail label={t('bl.dAccessType')} value={t('bl.grantedByAdmin')} />
              <Detail label={t('bl.dValidUntil')} value={fmtDate(sum.accessUntil)} />
            </>
          ) : (
            <Detail label={t('bl.dSubscription')} value={t('bl.noneYet')} />
          )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
        <div style={{ display: 'inline-flex', background: '#1e293b', border: '1px solid #334155', borderRadius: 999, padding: 4 }}>
          <button onClick={() => setYearly(false)} style={toggle(!yearly)}>{t('bl.monthly')}</button>
          <button onClick={() => setYearly(true)} style={toggle(yearly)}>{t('bl.yearly')}</button>
        </div>
      </div>

      {plans.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 14 }}>{t('bl.noPlans')}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {plans.map((p) => {
            const isCurrent = p.name.toLowerCase() === currentName;
            const cents = yearly ? p.priceYearlyCents : p.priceMonthlyCents;
            const provider: 'stripe' | 'paypal' = p.providers.stripe ? 'stripe' : 'paypal';
            const canPay = p.providers.stripe || p.providers.paypal;
            const isUpgrade = !isCurrent && currentTier >= 0 && p.priceMonthlyCents > currentTier;
            const isDowngrade = !isCurrent && currentTier >= 0 && p.priceMonthlyCents < currentTier;
            const curCents = currentPlan ? (yearly ? currentPlan.priceYearlyCents : currentPlan.priceMonthlyCents) : 0;
            const prorateNow = isUpgrade && remainFrac > 0 ? Math.max(0, Math.round((cents - curCents) * remainFrac)) : 0;
            return (
              <div key={p.id} style={{ ...ui.card, border: p.highlighted ? '2px solid #6366f1' : '1px solid #334155' }}>
                {p.highlighted && <div style={{ display: 'inline-block', background: '#312e81', color: '#c7d2fe', fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 999, marginBottom: 8 }}>{t('bl.mostPopular')}</div>}
                <div style={{ fontSize: 18, fontWeight: 700 }}>{p.name}</div>
                {p.tagline && <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 2 }}>{p.tagline}</div>}
                <div style={{ margin: '12px 0' }}>
                  <span style={{ fontSize: 30, fontWeight: 800 }}>{money(cents, p.currency)}</span>
                  <span style={{ color: '#94a3b8', fontSize: 14 }}>/{yearly ? t('bl.perYr') : t('bl.perMo')}</span>
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {p.features.slice(0, 6).map((f) => (
                    <li key={f} style={{ fontSize: 13, color: '#cbd5e1', display: 'flex', gap: 8 }}><span style={{ color: '#22c55e' }}>✓</span>{f}</li>
                  ))}
                </ul>
                {isCurrent ? (
                  <button disabled style={{ ...ui.primaryBtn, width: '100%', background: '#334155', cursor: 'default' }}>{t('bl.currentPlan')}</button>
                ) : (
                  <>
                    <button onClick={() => choose(p.id, provider)} disabled={busy || !canPay}
                      style={{ ...ui.primaryBtn, width: '100%', ...(isDowngrade ? { background: 'transparent', border: '1px solid #475569', color: '#cbd5e1' } : {}) }}>
                      {!canPay ? t('bl.notAvailable') : busy ? t('bl.opening')
                        : isDowngrade ? (lang === 'vi' ? `Chuyển xuống ${p.name}` : `Downgrade to ${p.name}`)
                        : (lang === 'vi' ? `Nâng cấp lên ${p.name}` : `Upgrade to ${p.name}`)}
                    </button>
                    {(isUpgrade || isDowngrade) && (
                      <p style={{ fontSize: 11.5, color: '#94a3b8', margin: '8px 0 0', lineHeight: 1.5, textAlign: 'center' }}>
                        {isUpgrade
                          ? (lang === 'vi'
                              ? `Hiệu lực ngay — chỉ tính thêm phần chênh lệch cho ${remainDays} ngày còn lại của kỳ này${prorateNow > 0 ? ` (~${money(prorateNow, p.currency)})` : ''}.`
                              : `Takes effect now — you're only charged the difference for the ${remainDays} days left in this cycle${prorateNow > 0 ? ` (~${money(prorateNow, p.currency)})` : ''}.`)
                          : (lang === 'vi'
                              ? `Áp dụng từ kỳ sau${renewLabel ? ` (${renewLabel})` : ''} — giữ nguyên quyền lợi hiện tại đến lúc đó, không mất phí ngay.`
                              : `Applies next cycle${renewLabel ? ` (${renewLabel})` : ''} — you keep your current plan until then, no charge now.`)}
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p style={{ color: '#64748b', fontSize: 12, marginTop: 16 }}>
        {t('bl.footerNote')}
      </p>
      </>)}

      {tab === 'usage' && <UsageCostsPanel />}
      {tab === 'invoices' && <InvoicesList token={token ?? ''} lang={lang} />}
    </section>
  );
}

/** The salon's own invoices (overage + renewal). Each links to a hosted invoice
 *  page where they can view details and pay. */
function InvoicesList({ token, lang }: { token: string; lang: Lang }) {
  const t = (k: string) => tr(k, lang);
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  useEffect(() => {
    if (!token) return;
    apiFetch<InvoiceRow[]>('/billing/invoices', { token }).then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([]));
  }, [token]);
  const pg = usePaged(rows ?? [], 12);

  if (rows === null) return <p style={{ color: '#94a3b8', fontSize: 14 }}>{t('bl.loading')}</p>;
  if (rows.length === 0) return (
    <div style={{ ...ui.card }}>
      <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>{t('bl.invNone')}</p>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 4px' }}>{t('bl.invIntro')}</p>
      {pg.paged.map((iv) => {
        const paid = iv.status === 'PAID';
        const void_ = iv.status === 'VOID';
        return (
          <div key={iv.id} style={{ ...ui.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>
                {iv.type === 'RENEWAL' ? t('bl.invRenewal') : t('bl.invOverage')} · <span style={{ color: '#94a3b8', fontWeight: 500 }}>#{iv.number}</span>
              </div>
              <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 3 }}>
                {invMoney(iv.totalCents, iv.currency)} · {fmtInvDate(iv.createdAt)}
                {' · '}<span style={{ color: paid ? '#4ade80' : void_ ? '#94a3b8' : '#fbbf24', fontWeight: 600 }}>
                  {paid ? t('bl.invPaid') : void_ ? t('bl.invVoid') : t('bl.invDue')}
                </span>
              </div>
            </div>
            <a href={`/invoice/${iv.token}`} target="_blank" rel="noopener noreferrer"
              style={{ ...ui.primaryBtn, textDecoration: 'none', background: paid || void_ ? 'transparent' : undefined, border: paid || void_ ? '1px solid #475569' : undefined, whiteSpace: 'nowrap' }}>
              {paid || void_ ? t('bl.invViewer') : t('bl.invPay')}
            </a>
          </div>
        );
      })}
      <Pager paged={pg} />
    </div>
  );
}

const invMoney = (c: number, cur = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format((c || 0) / 100);
function fmtInvDate(s: string): string {
  try { return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; }
}

function toggle(active: boolean): React.CSSProperties {
  return { border: 'none', cursor: 'pointer', padding: '7px 18px', borderRadius: 999, fontSize: 14, fontWeight: 600, background: active ? '#6366f1' : 'transparent', color: active ? '#fff' : '#94a3b8' };
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return '—'; }
}

function statusLabel(s: string, lang: Lang): string {
  const map: Record<string, string> = { TRIALING: 'bl.stTrial', ACTIVE: 'bl.stActive', PAST_DUE: 'bl.stPastDue', CANCELLED: 'bl.stCancelled' };
  return map[s] ? tr(map[s], lang) : s;
}
