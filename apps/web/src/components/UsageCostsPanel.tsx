'use client';

import { useCallback, useEffect, useState, CSSProperties } from 'react';
import { fmtInTz } from '../lib/datetime';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { useLang } from '../lib/i18n';
import { uiLocale } from '../lib/datetime';

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
  /** `wording` tells the screen WHICH sentence to print — see api billing/usage-rates.ts. */
  sms: { included: number; used: number; overage: number; overageCentsPer: number; overageCents: number; wording?: 'priced' | 'free' | 'unset' | 'unlimited' };
  /** The AI chatbot, once the salon is on a chat plan. Absent on an older server. */
  chat?: {
    enabled: boolean; included: number; used: number; overage: number;
    overageCentsPer: number; overageCents: number; monthlyCents: number;
    wording?: 'priced' | 'free' | 'unset' | 'unlimited';
    /** The chat line is priced in the salon's MARKET currency, which can
     *  differ from the subscription's. Absent on an older server. */
    currency?: string;
    /** 'basic' | 'standard' | 'pro', or null for a negotiated deal. */
    tierId?: string | null;
    /** Replies left before overage starts; null when there is no allowance. */
    remaining?: number | null;
  };
  totals: { fixedCents: number; overageCents: number; grandTotalCents: number; projectedGrandTotalCents: number };
}

/**
 * The stored amount, written out.
 *
 * It divided by 100 unconditionally, which is right for the dollar and wrong
 * for the đồng: the đồng has no subunit, so the stored number IS the amount
 * and a 390,000₫ chatbot plan printed as "3.900 ₫" — a hundredth of the real
 * price, on the invoice screen, to the person paying it. Ask the currency how
 * many decimals it has instead of assuming two. Same rule as lib/money.ts.
 */
const money = (c: number, cur = 'USD') => {
  const nf = new Intl.NumberFormat(uiLocale(), { style: 'currency', currency: cur });
  const digits = nf.resolvedOptions().maximumFractionDigits ?? 2;
  const n = c || 0;
  return nf.format(digits === 0 ? Math.round(n) : n / 10 ** digits);
};

type Lg = 'en' | 'vi';
const T = {
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
  // One WHOLE sentence per state. The old template substituted a rate into
  // "is charged {rate}", and when no rate was set it printed the word "free" —
  // telling the salon in writing that going over costs nothing. A salon quotes
  // that sentence back when the invoice arrives, and it is right to.
  howSms: {
    en: 'SMS — each message beyond your {sms} included is charged {rate}. Messages within the allowance are free.',
    vi: 'SMS — mỗi tin vượt quá {sms} tin trong gói tính {rate}. Tin trong hạn mức không mất phí.',
  },
  howSmsFree: {
    en: 'SMS — your plan includes {sms}, and we do not charge you for going over.',
    vi: 'SMS — gói của bạn có sẵn {sms} tin, và phần vượt bên mình không tính tiền.',
  },
  howSmsUnset: {
    en: 'SMS — your plan includes {sms}. No price has been agreed for going over yet, so nothing over the allowance is being charged; we will tell you before that changes.',
    vi: 'SMS — gói của bạn có sẵn {sms} tin. Phần vượt hiện chưa có đơn giá nên chưa tính tiền; bên mình sẽ báo trước nếu có thay đổi.',
  },
  howMin: {
    en: 'AI Hotline — each minute beyond your {min} included is charged {rate}. Minutes within the allowance are free.',
    vi: 'AI Hotline — mỗi phút vượt quá {min} phút trong gói tính {rate}. Phút trong hạn mức không mất phí.',
  },
  howChat: {
    en: 'AI Chatbot — each reply beyond your {chat} included is charged {rate}. Replies within the allowance are free. Only replies the robot sent are counted; anything your staff typed is not.',
    vi: 'Chatbot AI — mỗi tin trả lời vượt quá {chat} tin trong gói tính {rate}. Tin trong hạn mức không mất phí. Chỉ tính tin do robot trả lời; tin nhân viên tự nhắn không tính.',
  },
  howBill: {
    en: 'Usage charges add up through the month and are billed together with your plan fee at month end — we email you an invoice with a payment link.',
    vi: 'Phí phát sinh được cộng dồn trong tháng và chốt cùng phí gói vào cuối tháng — chúng tôi gởi email hoá đơn kèm link thanh toán.',
  },
  chat: { en: 'AI Chatbot replies', vi: 'Tin chatbot AI trả lời' },
  tierBasic: { en: 'Basic', vi: 'Cơ bản' },
  tierStandard: { en: 'Standard', vi: 'Tiêu chuẩn' },
  tierPro: { en: 'Pro', vi: 'Cao cấp' },
  tierCustom: { en: 'Agreed plan', vi: 'Gói thoả thuận' },
  left: { en: 'left this month', vi: 'còn lại tháng này' },
  chatSub: { en: 'AI Chatbot (subscription)', vi: 'Chatbot AI (thuê bao)' },
  chatOff: { en: 'AI Chatbot is not enabled', vi: 'Chatbot AI chưa bật' },
  notPriced: { en: 'not priced yet', vi: 'chưa có đơn giá' },
  noCharge: { en: 'not charged', vi: 'không tính phí' },
  perReply: { en: ' / reply', vi: ' / tin' },
  perSms: { en: ' / SMS', vi: ' / SMS' },
  perMin: { en: ' / min', vi: ' / phút' },
  free: { en: 'free', vi: 'miễn phí' },
  unlimited: { en: 'unlimited', vi: 'không giới hạn' },
  loading: { en: 'Loading…', vi: 'Đang tải…' },
  none: { en: 'No plan is assigned yet. Please contact Lumio support.', vi: 'Chưa có gói nào được gán. Vui lòng liên hệ Lumio để được hỗ trợ.' },
};

/** Itemized month-to-date cost breakdown. Rendered inside the Billing page. */
export function UsageCostsPanel() {
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

  if (sum === undefined) return <p style={{ color: 'var(--c94a3b8)' }}>{t('loading')}</p>;
  if (!sum || !sum.plan) return <p style={{ color: 'var(--c94a3b8)', maxWidth: 620 }}>{t('none')}</p>;

  const cur = sum.currency || 'USD';
  const month = (() => {
    try { return fmtInTz(sum.periodStart, { month: 'long', year: 'numeric' }); }
    catch { return ''; }
  })();
  const daysLeft = Math.max(0, sum.daysInMonth - sum.daysElapsed);

  // A rate of zero and a rate nobody has set are DIFFERENT, and only the
  // server knows which this is (see api billing/usage-rates.ts). An older
  // server that sends no `wording` is read as the safe case: say nothing is
  // charged, never that overage is free for ever.
  const smsWording = sum.sms.wording ?? (sum.sms.overageCentsPer > 0 ? 'priced' : 'unset');
  const rateLabel = (cents: number, unit: string, wording: string, curOverride?: string) =>
    wording === 'priced' && cents > 0 ? money(cents, curOverride ?? cur) + unit
      : wording === 'free' ? t('noCharge')
        : t('notPriced');
  const smsRate = rateLabel(sum.sms.overageCentsPer, t('perSms'), smsWording);
  const minRate = rateLabel(sum.hotline.overageCentsPerMin, t('perMin'), sum.hotline.overageCentsPerMin > 0 ? 'priced' : 'unset');
  const fill = (s: string, m: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => m[k] ?? '');

  const chatWording = sum.chat?.wording ?? ((sum.chat?.overageCentsPer ?? 0) > 0 ? 'priced' : 'unset');
  // The chatbot's own currency when the server sends one; the invoice's
  // otherwise, which is what every older server means.
  const chatCur = sum.chat?.currency || cur;
  const chatRate = rateLabel(sum.chat?.overageCentsPer ?? 0, t('perReply'), chatWording, chatCur);
  const tierName = sum.chat?.tierId === 'basic' ? t('tierBasic')
    : sum.chat?.tierId === 'standard' ? t('tierStandard')
      : sum.chat?.tierId === 'pro' ? t('tierPro')
        : t('tierCustom');
  const chatIncLabel = (sum.chat?.included ?? 0) > 0 ? String(sum.chat!.included) : t('unlimited');
  const smsIncLabel = sum.sms.included > 0 ? String(sum.sms.included) : t('unlimited');
  const minIncLabel = sum.hotline.includedMinutes > 0 ? String(sum.hotline.includedMinutes) : t('unlimited');

  return (
    <section className="stmt" style={{ maxWidth: 780, color: 'var(--ce2e8f0)' }}>
      <style>{`
        @media print {
          aside, header { display: none !important; }
          main { padding: 0 !important; }
          .stmt .noprint { display: none !important; }
          .stmt .card { background: #fff !important; color: var(--c0f172a) !important; border: 1px solid var(--ce2e8f0) !important; box-shadow: none !important; }
          .stmt .muted { color: var(--c475569) !important; }
          .stmt .hero { background: #f1f5ff !important; color: var(--c0f172a) !important; border: 1px solid var(--cc7d2fe) !important; }
          .stmt .heavy { color: #4f46e5 !important; }
        }
      `}</style>

      <div className="noprint" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <p className="muted" style={{ color: 'var(--c94a3b8)', margin: 0, fontSize: 13.5, maxWidth: 540 }}>{t('subtitle')}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={btnGhost}>↻ {t('refresh')}</button>
          <button onClick={() => window.print()} style={btnGhost}>🖨 {t('print')}</button>
        </div>
      </div>

      {/* HERO — projected month-end total */}
      <div className="hero card" style={hero}>
        <div style={{ fontSize: 13, color: 'var(--cc7d2fe)', fontWeight: 600 }} className="muted">{t('estTotal')}</div>
        <div className="heavy" style={{ fontSize: 44, fontWeight: 900, lineHeight: 1.05, margin: '4px 0 6px' }}>
          {money(sum.totals.projectedGrandTotalCents, cur)}
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--ccbd5e1)' }} className="muted">
          {t('soFar')}: <strong style={{ color: 'var(--ce2e8f0)' }} className="heavy">{money(sum.totals.grandTotalCents, cur)}</strong>
          {' · '}{daysLeft} {t('daysLeft')} ({month})
        </div>
        <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 8 }} className="muted">{t('estNote')}</div>
      </div>

      {/* ITEMIZED STATEMENT */}
      <div className="card" style={card}>
        <div style={{ fontSize: 13, color: 'var(--c94a3b8)', marginBottom: 2 }} className="muted">{t('billFor')}</div>
        <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 14 }}>{month}</div>

        <div style={sectionHead}>{t('fixed')}</div>
        <Row label={`${t('plan')}${sum.plan.name ? ` — ${sum.plan.name}` : ''}`} amount={`${money(sum.plan.monthlyCents, cur)}${t('perMo')}`} />
        {sum.hotline.enabled && sum.hotline.monthlyCents > 0 && (
          <Row label={t('hotlineSub')} amount={`${money(sum.hotline.monthlyCents, cur)}${t('perMo')}`} />
        )}
        {!!sum.chat?.enabled && sum.chat.monthlyCents > 0 && (
          <Row label={t('chatSub')} amount={`${money(sum.chat.monthlyCents, chatCur)}${t('perMo')}`} />
        )}
        <Row label={t('subFixed')} amount={money(sum.totals.fixedCents, cur)} subtotal />

        <div style={{ ...sectionHead, marginTop: 20 }}>{t('overageTitle')}</div>

        <UsageRow
          label={t('sms')}
          detail={`${sum.sms.used} ${t('used')} / ${smsIncLabel} ${t('included')}`}
          over={sum.sms.overage}
          overText={`${sum.sms.overage} ${t('over')} × ${smsRate}`}
          amount={money(sum.sms.overageCents, cur)}
          within={t('within')}
        />

        {sum.hotline.enabled ? (
          <UsageRow
            label={t('aiMin')}
            detail={`${sum.hotline.usedMinutes} ${t('used')} / ${minIncLabel} ${t('included')} · ${sum.hotline.aiCalls} calls`}
            over={sum.hotline.overageMinutes}
  overText={`${sum.hotline.overageMinutes} ${t('over')} × ${minRate}`}
            amount={money(sum.hotline.overageCents, cur)}
            within={t('within')}
          />
        ) : (
          <div style={{ ...rowWrap, color: 'var(--c64748b)', fontSize: 13.5 }} className="muted">{t('hotOff')}</div>
        )}

        {/* The chatbot. Absent entirely on an older server, and shown as "not
            enabled" for a salon that has not bought it — never as a zero row,
            which reads as "you are paying for something you do not have". */}
        {sum.chat ? (sum.chat.enabled ? (
          <UsageRow
            label={`${t('chat')} · ${tierName}`}
            detail={typeof sum.chat.remaining === 'number'
              ? `${sum.chat.used} ${t('used')} / ${chatIncLabel} ${t('included')} · ${sum.chat.remaining} ${t('left')}`
              : `${sum.chat.used} ${t('used')} / ${chatIncLabel} ${t('included')}`}
            over={sum.chat.overage}
            overText={`${sum.chat.overage} ${t('over')} × ${chatRate}`}
            amount={money(sum.chat.overageCents, chatCur)}
            within={t('within')}
          />
        ) : (
          <div style={{ ...rowWrap, color: 'var(--c64748b)', fontSize: 13.5 }} className="muted">{t('chatOff')}</div>
        )) : null}

        <Row label={t('subOver')} amount={money(sum.totals.overageCents, cur)} subtotal />

        <div style={{ borderTop: '2px solid var(--c334155)', marginTop: 14, paddingTop: 12 }}>
          <Row label={t('grandNow')} amount={money(sum.totals.grandTotalCents, cur)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 }}>
            <span style={{ fontSize: 15.5, fontWeight: 800 }}>{t('grandProj')}</span>
            <span className="heavy" style={{ fontSize: 26, fontWeight: 900, color: 'var(--c818cf8)' }}>{money(sum.totals.projectedGrandTotalCents, cur)}</span>
          </div>
        </div>
      </div>

      {/* HOW IT'S CALCULATED */}
      <div className="card" style={{ ...card, background: 'var(--c0f172a)' }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>💡 {t('howTitle')}</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5, color: 'var(--ccbd5e1)' }} className="muted">
          <li>{fill(t('howPlan'), { sms: smsIncLabel, min: minIncLabel })}</li>
          <li>{fill(t(smsWording === 'free' ? 'howSmsFree' : smsWording === 'unset' ? 'howSmsUnset' : 'howSms'), { sms: smsIncLabel, rate: smsRate })}</li>
          {sum.hotline.enabled && <li>{fill(t('howMin'), { min: minIncLabel, rate: minRate })}</li>}
          {sum.chat?.enabled && <li>{fill(t('howChat'), { chat: chatIncLabel, rate: chatRate })}</li>}
          <li>{t('howBill')}</li>
        </ul>
      </div>
    </section>
  );
}

function Row({ label, amount, subtotal }: { label: string; amount: string; subtotal?: boolean }) {
  return (
    <div style={{ ...rowWrap, borderTop: subtotal ? '1px solid var(--c334155)' : 'none', marginTop: subtotal ? 8 : 0, paddingTop: subtotal ? 10 : 8 }}>
      <span style={{ fontSize: 14.5, color: subtotal ? 'var(--ce2e8f0)' : 'var(--ccbd5e1)', fontWeight: subtotal ? 700 : 500 }} className={subtotal ? '' : 'muted'}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: subtotal ? 800 : 600 }}>{amount}</span>
    </div>
  );
}

function UsageRow({ label, detail, over, overText, amount, within }: { label: string; detail: string; over: number; overText: string; amount: string; within: string }) {
  return (
    <div style={{ ...rowWrap, alignItems: 'flex-start', paddingTop: 10 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14.5, color: 'var(--ce2e8f0)', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 2 }} className="muted">{detail}</div>
        {over > 0 && <div style={{ fontSize: 12.5, color: 'var(--cfca5a5)', marginTop: 2 }}>{overText}</div>}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: 10 }}>
        {over > 0
          ? <span style={{ fontSize: 15, fontWeight: 700 }}>{amount}</span>
          : <span style={{ fontSize: 12.5, color: 'var(--c4ade80)' }}>{within}</span>}
      </div>
    </div>
  );
}

const card: CSSProperties = { background: 'var(--c111827)', border: '1px solid var(--c1f2937)', borderRadius: 14, padding: 20, marginTop: 16 };
const hero: CSSProperties = { background: 'linear-gradient(150deg, var(--c1e1b4b), var(--c111827))', border: '1px solid var(--c3730a3)', borderRadius: 16, padding: '20px 22px', marginTop: 4 };
const sectionHead: CSSProperties = { fontSize: 12, color: 'var(--c818cf8)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 };
const rowWrap: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 0' };
const btnGhost: CSSProperties = { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' };
