'use client';

import { useCallback, useEffect, useState, CSSProperties } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { useLang } from '../../../lib/i18n';

interface Summary {
  periodStart: string;
  currency: string;
  daysElapsed: number;
  daysInMonth: number;
  plan: { name: string | null; monthlyCents: number };
  hotline: {
    enabled: boolean; monthlyCents: number;
    includedMinutes: number; usedMinutes: number; overageMinutes: number;
    overageCentsPerMin: number; overageCents: number; aiCalls: number;
  };
  sms: { included: number; used: number; overage: number; overageCentsPer: number; overageCents: number };
  totals: { fixedCents: number; overageCents: number; grandTotalCents: number; projectedGrandTotalCents: number };
}

const money = (c: number, cur = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format((c || 0) / 100);

type Lg = 'en' | 'vi';
const T = {
  title: { en: 'Usage & costs', vi: 'Chi phí sử dụng' },
  subtitle: {
    en: 'Exactly what you pay this month — your fixed plan fee plus any usage overage (SMS + AI Hotline). Updates in real time.',
    vi: 'Chính xác số tiền bạn phải trả tháng này — phí gói cố định cộng phí phát sinh (SMS + AI Hotline). Cập nhật realtime.',
  },
  print: { en: 'Print / Save', vi: 'In / Lưu' },
  refresh: { en: 'Refresh', vi: 'Làm mới' },
  estTotal: { en: 'Estimated month-end total', vi: 'Dự kiến phải trả cuối tháng' },
  soFar: { en: 'Charged so far today', vi: 'Tạm tính đến hôm nay' },
  daysLeft: { en: 'days left', vi: 'ngày còn lại' },
  estNote: {
    en: 'This is a projection from your usage so far. The final amount is confirmed and billed at month end.',
    vi: 'Đây là con số dự phóng theo mức dùng hiện tại. Số tiền cuối cùng được chốt và tính vào cuối tháng.',
  },
  billFor: { en: 'Statement for', vi: 'Hoá đơn tháng' },
  fixed: { en: '1 · Fixed monthly fees', vi: '1 · Phí cố định hàng tháng' },
  plan: { en: 'Software plan', vi: 'Gói phần mềm' },
  hotlineSub: { en: 'AI Hotline (subscription)', vi: 'AI Hotline (thuê bao)' },
  perMo: { en: '/mo', vi: '/tháng' },
  overageTitle: { en: '2 · Usage charges — only the part over your allowance', vi: '2 · Phí phát sinh — chỉ tính phần vượt hạn mức' },
  sms: { en: 'SMS text messages', vi: 'Tin nhắn SMS' },
  aiMin: { en: 'AI Hotline minutes', vi: 'Phút gọi AI Hotline' },
  used: { en: 'used', vi: 'đã dùng' },
  included: { en: 'included', vi: 'trong gói' },
  over: { en: 'over', vi: 'vượt' },
  within: { en: 'Within plan — no extra charge', vi: 'Trong hạn mức — không phát sinh' },
  hotOff: { en: 'AI Hotline is not enabled', vi: 'AI Hotline chưa bật' },
  subFixed: { en: 'Subtotal — fixed', vi: 'Tạm tính — cố định' },
  subOver: { en: 'Subtotal — usage', vi: 'Tạm tính — phát sinh' },
  grandNow: { en: 'Total so far this month', vi: 'Tổng tạm tính tháng này' },
  grandProj: { en: 'Projected month-end total', vi: 'Dự kiến tổng cuối tháng' },
  howTitle: { en: 'How your charges are calculated', vi: 'Cách tính chi phí của bạn' },
  howPlan: {
    en: 'Your plan is a fixed monthly fee that already includes {sms} SMS and {min} AI Hotline minutes each month.',
    vi: 'Gói của bạn là phí cố định mỗi tháng, đã bao gồm sẵn {sms} SMS và {min} phút AI Hotline mỗi tháng.',
  },
  howSms: {
    en: 'SMS — each message beyond your {sms} included is charged {rate}. Messages within the allowance are free.',
    vi: 'SMS — mỗi tin vượt quá {sms} tin miễn phí tính {rate}. Tin trong hạn mức là miễn phí.',
  },
  howMin: {
    en: 'AI Hotline — each minute beyond your {min} included is charged {rate}. Minutes within the allowance are free.',
    vi: 'AI Hotline — mỗi phút vượt quá {min} phút miễn phí tính {rate}. Phút trong hạn mức là miễn phí.',
  },
  howBill: {
    en: 'Usage charges add up through the month and are billed together with your plan fee at month end.',
    vi: 'Phí phát sinh được cộng dồn trong tháng và chốt cùng phí gói vào cuối tháng.',
  },
  perSms: { en: ' / SMS', vi: ' / SMS' },
  perMin: { en: ' / min', vi: ' / phút' },
  free: { en: 'free', vi: 'miễn phí' },
  unlimited: { en: 'unlimited', vi: 'không giới hạn' },
  loading: { en: 'Loading…', vi: 'Đang tải…' },
  none: { en: 'No plan is assigned yet. Please contact Lumio support.', vi: 'Chưa có gói nào được gán. Vui lòng liên hệ Lumio để được hỗ trợ.' },
};

export default function UsageCostsPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const g = (lang === 'vi' ? 'vi' : 'en') as Lg;
  const t = (k: keyof typeof T) => T[k][g];
  const [sum, setSum] = useState<Summary | null | undefined>(undefined);

  const load = useCallback(async () => {
    if (!token) return;
    try { setSum(await apiFetch<Summary>('/billing/usage-summary', { token })); }
    catch { setSum(null); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (sum === undefined) return <p style={{ color: '#94a3b8' }}>{t('loading')}</p>;
  if (!sum || !sum.plan) return <p style={{ color: '#94a3b8', maxWidth: 620 }}>{t('none')}</p>;

  const cur = sum.currency || 'USD';
  const month = (() => {
    try { return new Date(sum.periodStart).toLocaleDateString(g === 'vi' ? 'vi-VN' : 'en-US', { month: 'long', year: 'numeric' }); }
    catch { return ''; }
  })();
  const daysLeft = Math.max(0, sum.daysInMonth - sum.daysElapsed);

  const smsRate = sum.sms.overageCentsPer > 0 ? money(sum.sms.overageCentsPer, cur) + t('perSms') : t('free');
  const minRate = sum.hotline.overageCentsPerMin > 0 ? money(sum.hotline.overageCentsPerMin, cur) + t('perMin') : t('free');
  const fill = (s: string, m: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => m[k] ?? '');

  const smsIncLabel = sum.sms.included > 0 ? String(sum.sms.included) : t('unlimited');
  const minIncLabel = sum.hotline.includedMinutes > 0 ? String(sum.hotline.includedMinutes) : t('unlimited');

  return (
    <section className="stmt" style={{ maxWidth: 780, color: '#e2e8f0' }}>
      <style>{`
        @media print {
          aside, header { display: none !important; }
          main { padding: 0 !important; }
          .stmt .noprint { display: none !important; }
          .stmt .card { background: #fff !important; color: #0f172a !important; border: 1px solid #e2e8f0 !important; box-shadow: none !important; }
          .stmt .muted { color: #475569 !important; }
          .stmt .hero { background: #f1f5ff !important; color: #0f172a !important; border: 1px solid #c7d2fe !important; }
          .stmt .heavy { color: #4f46e5 !important; }
        }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>🧮 {t('title')}</h1>
          <p className="muted" style={{ color: '#94a3b8', margin: 0, fontSize: 13.5, maxWidth: 560 }}>{t('subtitle')}</p>
        </div>
        <div className="noprint" style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={btnGhost}>↻ {t('refresh')}</button>
          <button onClick={() => window.print()} style={btnGhost}>🖨 {t('print')}</button>
        </div>
      </div>

      {/* HERO — projected month-end total */}
      <div className="hero card" style={hero}>
        <div style={{ fontSize: 13, color: '#c7d2fe', fontWeight: 600 }} className="muted">{t('estTotal')}</div>
        <div className="heavy" style={{ fontSize: 46, fontWeight: 900, lineHeight: 1.05, margin: '4px 0 6px' }}>
          {money(sum.totals.projectedGrandTotalCents, cur)}
        </div>
        <div style={{ fontSize: 13.5, color: '#cbd5e1' }} className="muted">
          {t('soFar')}: <strong style={{ color: '#e2e8f0' }} className="heavy">{money(sum.totals.grandTotalCents, cur)}</strong>
          {' · '}{daysLeft} {t('daysLeft')} ({month})
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }} className="muted">{t('estNote')}</div>
      </div>

      {/* ITEMIZED STATEMENT */}
      <div className="card" style={card}>
        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 2 }} className="muted">{t('billFor')}</div>
        <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 14 }}>{month}</div>

        {/* Section 1 — fixed */}
        <div style={sectionHead}>{t('fixed')}</div>
        <Row label={`${t('plan')}${sum.plan.name ? ` — ${sum.plan.name}` : ''}`} amount={`${money(sum.plan.monthlyCents, cur)}${t('perMo')}`} />
        {sum.hotline.enabled && sum.hotline.monthlyCents > 0 && (
          <Row label={t('hotlineSub')} amount={`${money(sum.hotline.monthlyCents, cur)}${t('perMo')}`} />
        )}
        <Row label={t('subFixed')} amount={money(sum.totals.fixedCents, cur)} subtotal />

        {/* Section 2 — usage overage */}
        <div style={{ ...sectionHead, marginTop: 20 }}>{t('overageTitle')}</div>

        <UsageRow
          label={t('sms')}
          detail={`${sum.sms.used} ${t('used')} / ${smsIncLabel} ${t('included')}`}
          over={sum.sms.overage}
          overText={`${sum.sms.overage} ${t('over')} × ${sum.sms.overageCentsPer > 0 ? money(sum.sms.overageCentsPer, cur) : t('free')}`}
          amount={money(sum.sms.overageCents, cur)}
          within={t('within')}
        />

        {sum.hotline.enabled ? (
          <UsageRow
            label={t('aiMin')}
            detail={`${sum.hotline.usedMinutes} ${t('used')} / ${minIncLabel} ${t('included')} · ${sum.hotline.aiCalls} calls`}
            over={sum.hotline.overageMinutes}
            overText={`${sum.hotline.overageMinutes} ${t('over')} × ${sum.hotline.overageCentsPerMin > 0 ? money(sum.hotline.overageCentsPerMin, cur) : t('free')}`}
            amount={money(sum.hotline.overageCents, cur)}
            within={t('within')}
          />
        ) : (
          <div style={{ ...rowWrap, color: '#64748b', fontSize: 13.5 }} className="muted">{t('hotOff')}</div>
        )}

        <Row label={t('subOver')} amount={money(sum.totals.overageCents, cur)} subtotal />

        {/* Grand totals */}
        <div style={{ borderTop: '2px solid #334155', marginTop: 14, paddingTop: 12 }}>
          <Row label={t('grandNow')} amount={money(sum.totals.grandTotalCents, cur)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 }}>
            <span style={{ fontSize: 15.5, fontWeight: 800 }}>{t('grandProj')}</span>
            <span className="heavy" style={{ fontSize: 26, fontWeight: 900, color: '#818cf8' }}>{money(sum.totals.projectedGrandTotalCents, cur)}</span>
          </div>
        </div>
      </div>

      {/* HOW IT'S CALCULATED */}
      <div className="card" style={{ ...card, background: '#0f172a' }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>💡 {t('howTitle')}</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5, color: '#cbd5e1' }} className="muted">
          <li>{fill(t('howPlan'), { sms: smsIncLabel, min: minIncLabel })}</li>
          <li>{fill(t('howSms'), { sms: smsIncLabel, rate: smsRate })}</li>
          {sum.hotline.enabled && <li>{fill(t('howMin'), { min: minIncLabel, rate: minRate })}</li>}
          <li>{t('howBill')}</li>
        </ul>
      </div>
    </section>
  );
}

function Row({ label, amount, subtotal }: { label: string; amount: string; subtotal?: boolean }) {
  return (
    <div style={{ ...rowWrap, borderTop: subtotal ? '1px solid #334155' : 'none', marginTop: subtotal ? 8 : 0, paddingTop: subtotal ? 10 : 8 }}>
      <span style={{ fontSize: 14.5, color: subtotal ? '#e2e8f0' : '#cbd5e1', fontWeight: subtotal ? 700 : 500 }} className={subtotal ? '' : 'muted'}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: subtotal ? 800 : 600 }}>{amount}</span>
    </div>
  );
}

function UsageRow({ label, detail, over, overText, amount, within }: { label: string; detail: string; over: number; overText: string; amount: string; within: string }) {
  return (
    <div style={{ ...rowWrap, alignItems: 'flex-start', paddingTop: 10 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14.5, color: '#e2e8f0', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }} className="muted">{detail}</div>
        {over > 0 && <div style={{ fontSize: 12.5, color: '#fca5a5', marginTop: 2 }}>{overText}</div>}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: 10 }}>
        {over > 0
          ? <span style={{ fontSize: 15, fontWeight: 700 }}>{amount}</span>
          : <span style={{ fontSize: 12.5, color: '#4ade80' }}>{within}</span>}
      </div>
    </div>
  );
}

const card: CSSProperties = { background: '#111827', border: '1px solid #1f2937', borderRadius: 14, padding: 20, marginTop: 16 };
const hero: CSSProperties = { background: 'linear-gradient(150deg, #1e1b4b, #111827)', border: '1px solid #3730a3', borderRadius: 16, padding: '20px 22px', marginTop: 16 };
const sectionHead: CSSProperties = { fontSize: 12, color: '#818cf8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 };
const rowWrap: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 0' };
const btnGhost: CSSProperties = { padding: '8px 12px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e2e8f0', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' };
