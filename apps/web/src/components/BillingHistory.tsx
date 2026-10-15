'use client';

import { useCallback, useEffect, useState, CSSProperties } from 'react';
import { fmtInTz, uiLocale } from '../lib/datetime';
import { apiFetch } from '../lib/api';

/**
 * The three cards under the month-to-date statement on Billing → Usage:
 *   · how the salon pays, and whether month-end charges are taken by themselves;
 *   · the last months side by side (used / sent / failed / invoiced);
 *   · every SMS of one month and what became of it.
 *
 * Numbers come from /billing/usage-history and /billing/sms-log — the same
 * rows the invoices are built from — so this table and the invoice agree.
 */

export interface PaymentInfo {
  provider: 'stripe' | 'paypal' | null; status: string | null; interval: 'month' | 'year' | null;
  nextChargeAt: string | null; autoPlan: boolean; autoUsage: boolean; billingExempt: boolean;
  /** Where the card is managed when it is not a Stripe portal link (PayPal's autopay page). */
  manageUrl?: string | null;
  gateways?: { stripe: boolean; paypal: boolean };
  /** The card saved in Lumio's own page, when there is one. */
  card?: { provider: 'stripe' | 'paypal' | null; label: string; status: string; lastError: string | null } | null;
}
interface MonthInvoice { number: string; type: string; status: string; totalCents: number; currency: string; paidAt: string | null; provider: string | null; token: string; dueDate: string | null }
interface MonthRow { month: string; current: boolean; smsSent: number; smsFailed: number; aiMinutes: number; aiCalls: number; chatReplies: number; invoices: MonthInvoice[] }
interface History { asOf: string; months: MonthRow[] }
interface SmsRow { id: string; to: string; status: string; provider: string; error: string | null; preview: string; at: string; sentAt: string | null; deliveredAt: string | null; relatedType: string | null }
interface SmsLog { month: string; counts: { sent: number; delivered: number; failed: number; pending: number }; rows: SmsRow[] }

type Lg = 'en' | 'vi';
const T = {
  payTitle: { en: 'How you pay', vi: 'Cách thanh toán' },
  payNone: { en: 'No payment method on file — your plan is billed by invoice email. To have charges taken automatically, subscribe under the Plan tab.', vi: 'Chưa có phương thức thanh toán — gói được gửi hoá đơn qua email. Để hệ thống tự trừ tiền, đăng ký gói ở tab Gói dịch vụ.' },
  payExempt: { en: 'This salon is not billed (arranged with Lumio).', vi: 'Tiệm này không bị tính phí (theo thoả thuận với Lumio).' },
  payPaypal: { en: 'PayPal subscription', vi: 'Đăng ký qua PayPal' },
  payCard: { en: 'Saved card', vi: 'Thẻ đã lưu' },
  manageCard: { en: 'Change or remove the card under Plan & payment.', vi: 'Đổi hoặc xoá thẻ ở tab Gói & thanh toán.' },
  payStripe: { en: 'Card on file (Stripe)', vi: 'Thẻ đã lưu (Stripe)' },
  planAuto: { en: 'Plan fee: charged automatically', vi: 'Phí gói: tự động trừ' },
  usageAuto: { en: 'Usage charges: added at month end and charged automatically to the same PayPal subscription — no link to click.', vi: 'Phí phát sinh: chốt cuối tháng và tự trừ qua đúng đăng ký PayPal này — không cần bấm link.' },
  usageAutoStripe: { en: 'Usage charges: added at month end and charged to the card on file.', vi: 'Phí phát sinh: chốt cuối tháng và trừ vào thẻ đã lưu.' },
  usageManual: { en: 'Usage charges: invoiced by email at month end.', vi: 'Phí phát sinh: gửi hoá đơn email cuối tháng.' },
  pastDue: { en: 'Last payment failed — PayPal retries; please check your PayPal account.', vi: 'Lần trừ gần nhất thất bại — PayPal sẽ thử lại; vui lòng kiểm tra tài khoản PayPal.' },
  next: { en: 'Next plan charge', vi: 'Lần trừ phí gói tiếp theo' },
  cardNote: { en: 'Your card details are held by PayPal, never by Lumio.', vi: 'Thông tin thẻ do PayPal giữ, Lumio không lưu.' },
  cardNoteStripe: { en: 'Your card details are held by Stripe, never by Lumio.', vi: 'Thông tin thẻ do Stripe giữ, Lumio không lưu.' },
  manage: { en: 'Update card', vi: 'Cập nhật thẻ' },
  histTitle: { en: 'Previous months', vi: 'Các tháng trước' },
  histSub: { en: 'What was used, what went out, and what was billed — month by month.', vi: 'Đã dùng bao nhiêu, gửi được bao nhiêu, và đã tính tiền thế nào — theo từng tháng.' },
  hMonth: { en: 'Month', vi: 'Tháng' },
  hSms: { en: 'SMS sent', vi: 'SMS gửi' },
  hFail: { en: 'failed', vi: 'thất bại' },
  hMin: { en: 'AI min', vi: 'Phút AI' },
  hChat: { en: 'Bot replies', vi: 'Tin bot' },
  hBill: { en: 'Usage bill', vi: 'Hoá đơn phát sinh' },
  thisMonth: { en: 'this month', vi: 'tháng này' },
  noBill: { en: 'within plan', vi: 'trong hạn mức' },
  paid: { en: 'paid', vi: 'đã trả' },
  open: { en: 'unpaid', vi: 'chưa trả' },
  void: { en: 'cancelled', vi: 'đã huỷ' },
  smsTitle: { en: 'SMS delivery log', vi: 'Nhật ký gửi SMS' },
  smsSub: { en: 'Every text this month and whether it went out. "Failed" texts are not billed.', vi: 'Từng tin nhắn trong tháng và kết quả gửi. Tin "thất bại" không tính tiền.' },
  onlyFailed: { en: 'Only failed', vi: 'Chỉ xem thất bại' },
  sSent: { en: 'sent', vi: 'đã gửi' },
  sDelivered: { en: 'confirmed delivered', vi: 'xác nhận đã tới máy' },
  sFailed: { en: 'failed', vi: 'thất bại' },
  sPending: { en: 'sending', vi: 'đang gửi' },
  when: { en: 'When', vi: 'Lúc' },
  to: { en: 'To', vi: 'Gửi tới' },
  result: { en: 'Result', vi: 'Kết quả' },
  empty: { en: 'No SMS this month.', vi: 'Tháng này chưa gửi SMS nào.' },
  emptyFailed: { en: 'Nothing failed this month.', vi: 'Tháng này không có tin thất bại.' },
  mock: { en: 'not a real send (SMS not connected)', vi: 'chưa gửi thật (chưa kết nối SMS)' },
  showAll: { en: 'Show all', vi: 'Xem tất cả' },
  asOf: { en: 'As of', vi: 'Số liệu lúc' },
  loading: { en: 'Loading…', vi: 'Đang tải…' },
};

/** "2026-10" → "October 2026" / "tháng 10 2026", read as a UTC month (the platform's billing convention). */
export function monthName(ym: string, locale = uiLocale()): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  try { return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }); }
  catch { return ym; }
}

const money = (c: number, cur = 'USD') => {
  const nf = new Intl.NumberFormat(uiLocale(), { style: 'currency', currency: cur });
  const digits = nf.resolvedOptions().maximumFractionDigits ?? 2;
  return nf.format(digits === 0 ? Math.round(c || 0) : (c || 0) / 10 ** digits);
};

export function PaymentMethodCard({ pay, lang, onPortal }: { pay: PaymentInfo | null | undefined; lang: Lg; onPortal?: () => void }) {
  const t = (k: keyof typeof T) => T[k][lang];
  if (!pay) return null;
  let body: React.ReactNode;
  if (pay.billingExempt) body = <div style={line}>{t('payExempt')}</div>;
  else if (!pay.provider) body = <div style={line}>{t('payNone')}</div>;
  else {
    const past = pay.status === 'PAST_DUE';
    body = (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{pay.card ? `${t('payCard')} · ${pay.card.label}` : pay.provider === 'paypal' ? t('payPaypal') : t('payStripe')}</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: past ? 'rgba(239,68,68,.14)' : 'rgba(34,197,94,.14)', color: past ? 'var(--cfca5a5)' : 'var(--c4ade80)', border: `1px solid ${past ? 'rgba(239,68,68,.4)' : 'rgba(34,197,94,.35)'}` }}>
            {past ? 'PAST DUE' : pay.status === 'TRIALING' ? 'TRIAL' : 'ACTIVE'}
          </span>
        </div>
        <div style={{ ...line, marginTop: 8 }}>✓ {t('planAuto')}{pay.nextChargeAt ? ` · ${t('next')}: ${fmtInTz(pay.nextChargeAt, { dateStyle: 'medium' })}` : ''}</div>
        <div style={line}>{pay.autoUsage ? '✓ ' : '· '}{pay.autoUsage ? (pay.provider === 'paypal' ? t('usageAuto') : t('usageAutoStripe')) : t('usageManual')}</div>
        {past && <div style={{ ...line, color: 'var(--cfca5a5)' }}>⚠ {t('pastDue')}</div>}
        <div style={{ ...line, color: 'var(--c64748b)', fontSize: 12.5 }}>{pay.provider === 'paypal' ? t('cardNote') : t('cardNoteStripe')}</div>
        {pay.card ? (
          <div style={{ ...line, color: 'var(--c64748b)', fontSize: 12.5 }}>{t('manageCard')}</div>
        ) : pay.manageUrl ? (
          <a href={pay.manageUrl} target="_blank" rel="noreferrer" style={manageBtn}>{t('manage')} ↗</a>
        ) : onPortal ? (
          <button type="button" onClick={onPortal} style={manageBtn}>{t('manage')}</button>
        ) : null}
      </>
    );
  }
  return (
    <div className="card" style={card}>
      <div style={head}>💳 {t('payTitle')}</div>
      {body}
    </div>
  );
}

export function UsageHistoryCard({ token, lang, onPickMonth }: { token: string; lang: Lg; onPickMonth?: (ym: string) => void }) {
  const t = (k: keyof typeof T) => T[k][lang];
  const [h, setH] = useState<History | null | undefined>(undefined);
  useEffect(() => {
    if (!token) return;
    apiFetch<History>('/billing/usage-history?months=6', { token }).then(setH).catch(() => setH(null));
  }, [token]);
  if (h === undefined) return <div className="card" style={card}><div style={head}>📅 {t('histTitle')}</div><div style={line}>{t('loading')}</div></div>;
  if (!h) return null;
  const st = (i: MonthInvoice) => i.status === 'PAID' ? { txt: t('paid'), c: 'var(--c4ade80)' } : i.status === 'VOID' ? { txt: t('void'), c: 'var(--c64748b)' } : { txt: t('open'), c: 'var(--cfca5a5)' };
  return (
    <div className="card" style={card}>
      <div style={head}>📅 {t('histTitle')}</div>
      <div style={{ ...line, color: 'var(--c94a3b8)', marginBottom: 10 }}>{t('histSub')} <span style={{ color: 'var(--c64748b)' }}>· {t('asOf')} {fmtInTz(h.asOf, { dateStyle: 'short', timeStyle: 'short' })}</span></div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 520 }}>
          <thead>
            <tr style={{ color: 'var(--c94a3b8)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.3 }}>
              <th style={th}>{t('hMonth')}</th><th style={{ ...th, textAlign: 'right' }}>{t('hSms')}</th><th style={{ ...th, textAlign: 'right' }}>{t('hMin')}</th><th style={{ ...th, textAlign: 'right' }}>{t('hChat')}</th><th style={{ ...th, textAlign: 'right' }}>{t('hBill')}</th>
            </tr>
          </thead>
          <tbody>
            {h.months.map((m) => {
              const bills = m.invoices.filter((i) => i.type === 'OVERAGE');
              return (
                <tr key={m.month} style={{ borderTop: '1px solid var(--c1f2937)', opacity: m.current ? 1 : 0.92 }}>
                  <td style={td}>
                    <button type="button" onClick={() => onPickMonth?.(m.month)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--ce2e8f0)', fontWeight: 600, cursor: onPickMonth ? 'pointer' : 'default', textDecoration: onPickMonth ? 'underline dotted' : 'none', font: 'inherit' }}>
                      {monthName(m.month)}
                    </button>
                    {m.current && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--c818cf8)' }}>· {t('thisMonth')}</span>}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {m.smsSent}
                    {m.smsFailed > 0 && <span style={{ color: 'var(--cfca5a5)', fontSize: 12, marginLeft: 6 }}>· {m.smsFailed} {t('hFail')}</span>}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>{m.aiMinutes}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{m.chatReplies}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {bills.length === 0
                      ? <span style={{ color: 'var(--c64748b)', fontSize: 12.5 }}>{m.current ? '—' : t('noBill')}</span>
                      : bills.map((i) => {
                        const s = st(i);
                        return (
                          <div key={i.number}>
                            <a href={`/invoice/${i.token}`} target="_blank" rel="noreferrer" style={{ color: 'var(--ce2e8f0)', fontWeight: 600 }}>{money(i.totalCents, i.currency)}</a>
                            <span style={{ color: s.c, fontSize: 12, marginLeft: 6 }}>{s.txt}{i.status === 'PAID' && i.provider ? ` · ${i.provider === 'paypal' ? 'PayPal' : i.provider}` : ''}</span>
                          </div>
                        );
                      })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SmsLogCard({ token, lang, month }: { token: string; lang: Lg; month: string }) {
  const t = (k: keyof typeof T) => T[k][lang];
  const [log, setLog] = useState<SmsLog | null | undefined>(undefined);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const load = useCallback(() => {
    if (!token) return;
    setLog(undefined);
    apiFetch<SmsLog>(`/billing/sms-log?month=${encodeURIComponent(month)}`, { token }).then(setLog).catch(() => setLog(null));
  }, [token, month]);
  useEffect(() => { load(); }, [load]);
  if (log === undefined) return <div className="card" style={card}><div style={head}>📨 {t('smsTitle')}</div><div style={line}>{t('loading')}</div></div>;
  if (!log) return null;
  const rows = (onlyFailed ? log.rows.filter((r) => r.status === 'FAILED') : log.rows);
  const shown = showAll ? rows : rows.slice(0, 25);
  const tone = (s: string) => s === 'FAILED' ? 'var(--cfca5a5)' : s === 'PENDING' ? 'var(--cfcd34d)' : 'var(--c4ade80)';
  return (
    <div className="card" style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={head}>📨 {t('smsTitle')} · {monthName(log.month)}</div>
        <label style={{ fontSize: 13, color: 'var(--ccbd5e1)', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} /> {t('onlyFailed')}
        </label>
      </div>
      <div style={{ ...line, color: 'var(--c94a3b8)' }}>{t('smsSub')}</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '8px 0 10px', fontSize: 13 }}>
        <span style={{ color: 'var(--c4ade80)' }}>● {log.counts.sent} {t('sSent')}</span>
        {log.counts.delivered > 0 && <span style={{ color: 'var(--c4ade80)' }}>✓ {log.counts.delivered} {t('sDelivered')}</span>}
        <span style={{ color: log.counts.failed ? 'var(--cfca5a5)' : 'var(--c64748b)' }}>● {log.counts.failed} {t('sFailed')}</span>
        {log.counts.pending > 0 && <span style={{ color: 'var(--cfcd34d)' }}>● {log.counts.pending} {t('sPending')}</span>}
      </div>
      {rows.length === 0 ? (
        <div style={{ ...line, color: 'var(--c64748b)' }}>{onlyFailed ? t('emptyFailed') : t('empty')}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 520 }}>
            <thead>
              <tr style={{ color: 'var(--c94a3b8)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                <th style={th}>{t('when')}</th><th style={th}>{t('to')}</th><th style={th}>{t('result')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--c1f2937)', verticalAlign: 'top' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--ccbd5e1)' }}>{fmtInTz(r.at, { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td style={td}>
                    <div style={{ color: 'var(--ce2e8f0)', fontWeight: 600 }}>{r.to}</div>
                    <div style={{ color: 'var(--c64748b)', fontSize: 12, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.preview}>{r.preview}</div>
                  </td>
                  <td style={td}>
                    <span style={{ color: tone(r.status), fontWeight: 600 }}>
                      {r.status === 'FAILED' ? t('sFailed') : r.status === 'PENDING' ? t('sPending') : r.deliveredAt ? t('sDelivered') : t('sSent')}
                    </span>
                    {r.status !== 'FAILED' && r.provider === 'mock' && <div style={{ color: 'var(--cfcd34d)', fontSize: 11.5 }}>⚠ {t('mock')}</div>}
                    {r.status === 'FAILED' && r.error && <div style={{ color: 'var(--cfca5a5)', fontSize: 11.5, maxWidth: 320, lineHeight: 1.4 }}>{r.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > shown.length && (
            <button type="button" onClick={() => setShowAll(true)} style={{ marginTop: 8, background: 'transparent', border: '1px solid var(--c334155)', color: 'var(--ce2e8f0)', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' }}>
              {t('showAll')} ({rows.length})
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const card: CSSProperties = { background: 'var(--c111827)', border: '1px solid var(--c1f2937)', borderRadius: 14, padding: 20, marginTop: 16 };
const manageBtn: CSSProperties = { display: 'inline-block', marginTop: 10, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 12.5, cursor: 'pointer', textDecoration: 'none', font: 'inherit' };
const head: CSSProperties = { fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 6 };
const line: CSSProperties = { fontSize: 13.5, color: 'var(--ccbd5e1)', lineHeight: 1.6 };
const th: CSSProperties = { textAlign: 'left', padding: '6px 8px 6px 0', fontWeight: 600 };
const td: CSSProperties = { padding: '8px 8px 8px 0' };
